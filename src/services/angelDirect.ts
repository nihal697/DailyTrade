import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { totpNow } from './totp';

// On-device Angel One SmartAPI: login + LTP polling with zero server.
// Credentials live ONLY in Keystore-encrypted secure storage (Android).
// NOTE: in a desktop browser this plugin falls back to plaintext localStorage,
// so enter broker secrets only in the installed APK, never the web preview.

const K = {
  apiKey: 'dt_angel_api_key',
  client: 'dt_angel_client',
  pin: 'dt_angel_pin',
  totp: 'dt_angel_totp',
  jwt: 'dt_angel_jwt',
};

export interface DirectCreds {
  apiKey: string;
  client: string;
  pin: string;
  totp: string;
}

const ROOT = 'https://apiconnect.angelone.in';
const TOKENS = {
  NIFTY: { exchange: 'NSE', token: '99926000' },
  BANKNIFTY: { exchange: 'NSE', token: '99926009' },
  SENSEX: { exchange: 'BSE', token: '99919000' },
} as const;

export type DirectId = keyof typeof TOKENS;

function baseHeaders(apiKey: string, jwt?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': apiKey,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

export async function getDirectCreds(): Promise<DirectCreds | null> {
  try {
    const raw = await Promise.all([
      SecureStorage.get(K.apiKey), SecureStorage.get(K.client),
      SecureStorage.get(K.pin), SecureStorage.get(K.totp),
    ]);
    const [apiKey, client, pin, totp] = raw.map(v => (v == null ? '' : String(v)));
    if (!apiKey || !client || !pin || !totp) return null;
    return { apiKey, client, pin, totp };
  } catch {
    return null;
  }
}

export async function saveDirectCreds(c: DirectCreds): Promise<void> {
  await Promise.all([
    SecureStorage.set(K.apiKey, c.apiKey.trim()),
    SecureStorage.set(K.client, c.client.trim()),
    SecureStorage.set(K.pin, c.pin.trim()),
    SecureStorage.set(K.totp, c.totp.trim().replace(/\s+/g, '')),
  ]);
  await SecureStorage.remove(K.jwt).catch(() => undefined); // new creds invalidate old token
}

export async function clearDirectCreds(): Promise<void> {
  await Promise.all(Object.values(K).map(k => SecureStorage.remove(k).catch(() => undefined)));
}

async function fullLogin(c: DirectCreds): Promise<string> {
  const login = await (
    await fetch(`${ROOT}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      method: 'POST',
      headers: baseHeaders(c.apiKey),
      body: JSON.stringify({ clientcode: c.client, password: c.pin, totp: totpNow(c.totp) }),
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  if (!login?.status) throw new Error(`login rejected: ${login?.message ?? 'unknown'}`);
  const rt = login.data?.refreshToken;
  if (!rt) throw new Error('login gave no refresh token');
  const mint = await (
    await fetch(`${ROOT}/rest/auth/angelbroking/jwt/v1/generateTokens`, {
      method: 'POST',
      headers: baseHeaders(c.apiKey),
      body: JSON.stringify({ refreshToken: rt }),
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  const jwt = mint?.data?.jwtToken;
  if (!mint?.status || !jwt) throw new Error('token mint rejected — try again');
  await SecureStorage.set(K.jwt, jwt);
  return jwt;
}

async function storedJwt(): Promise<string | null> {
  try {
    const v = await SecureStorage.get(K.jwt);
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}

/** Full login flow, for the SAVE & TEST button. Returns a plain-words result. */
export async function testDirectLogin(c: DirectCreds): Promise<string> {
  try {
    await saveDirectCreds(c);
    await fullLogin(c);
    const ltp = await fetchDirectLTPs();
    if (ltp && Object.keys(ltp).length) return 'Angel login OK — live LTP flowing.';
    return 'Login OK, but no LTP yet (market may be closed).';
  } catch (e: any) {
    return `Login failed: ${e?.message ?? e}`;
  }
}

let directCache: { ts: number; data: Record<DirectId, { price: number; ts: string }> } | null = null;
const DIRECT_TTL_MS = 5000;

/** LTP for the 3 indices straight from Angel. Null when unconfigured/offline. */
export async function fetchDirectLTPs(): Promise<Record<DirectId, { price: number; ts: string }> | null> {
  const creds = await getDirectCreds();
  if (!creds) return null;
  if (directCache && Date.now() - directCache.ts < DIRECT_TTL_MS) return directCache.data;
  const attempt = async (jwt: string | null) => {
    const body = {
      mode: 'LTP',
      exchangeTokens: {
        NSE: [TOKENS.NIFTY.token, TOKENS.BANKNIFTY.token],
        BSE: [TOKENS.SENSEX.token],
      },
    };
    const res = await fetch(`${ROOT}/rest/secure/angelbroking/market/v1/quote/`, {
      method: 'POST',
      headers: baseHeaders(creds.apiKey, jwt ?? undefined),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401) return 'UNAUTHORIZED';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  };
  try {
    let jwt = await storedJwt();
    if (!jwt) jwt = await fullLogin(creds);
    let j = await attempt(jwt);
    if (j === 'UNAUTHORIZED') {
      jwt = await fullLogin(creds); // single re-login, then give up loudly
      j = await attempt(jwt);
      if (j === 'UNAUTHORIZED') throw new Error('token rejected even after fresh login');
    }
    const out = {} as Record<DirectId, { price: number; ts: string }>;
    const now = new Date().toISOString();
    for (const row of j?.data?.fetched ?? []) {
      const found = (Object.keys(TOKENS) as DirectId[]).find(
        id => TOKENS[id].token === String(row.symbolToken) && TOKENS[id].exchange === row.exchange
      );
      if (found && typeof row.ltp === 'number' && row.ltp > 0) {
        out[found] = { price: row.ltp, ts: now };
      }
    }
    if (!Object.keys(out).length) return directCache?.data ?? null;
    directCache = { ts: Date.now(), data: out };
    return out;
  } catch {
    return directCache?.data ?? null;
  }
}
