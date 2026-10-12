import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { BrokerDef, DirectId, LtpTick } from './types';

// On-device DhanHQ: static token, no expiry, no TOTP dance.
// Index IDs verified against Dhan's live instrument master:
// Nifty 50 = IDX_I 13, Bank Nifty = IDX_I 25, Sensex (BSE) = IDX_I 51.

const K = { token: 'dt_dhan_token', clientId: 'dt_dhan_client' };

const INSTRUMENTS: Record<string, DirectId> = { '13': 'NIFTY', '25': 'BANKNIFTY', '51': 'SENSEX' };
const IDS = Object.keys(INSTRUMENTS);

let cache: { ts: number; data: Record<DirectId, LtpTick> } | null = null;
const TTL_MS = 5000;

async function creds(): Promise<{ token: string; clientId: string } | null> {
  try {
    const token = String((await SecureStorage.get(K.token)) ?? '');
    const clientId = String((await SecureStorage.get(K.clientId)) ?? '');
    if (!token || !clientId) return null;
    return { token, clientId };
  } catch {
    return null;
  }
}

async function quote(token: string, clientId: string) {
  const res = await fetch('https://api.dhan.co/v2/marketfeed/ltp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'access-token': token,
      'client-id': clientId,
    },
    body: JSON.stringify({ IDX_I: IDS }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function fetchDhanLTPs(): Promise<Record<DirectId, LtpTick> | null> {
  const c = await creds();
  if (!c) return null;
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;
  const j = await quote(c.token, c.clientId).catch(() => null);
  const rows = j?.data?.IDX_I;
  if (!rows) return cache?.data ?? null;
  const out = {} as Record<DirectId, LtpTick>;
  const now = new Date().toISOString();
  for (const [id, node] of Object.entries(rows)) {
    const px = (node as any)?.last_price;
    const sid = INSTRUMENTS[id];
    if (sid && typeof px === 'number' && px > 0) out[sid] = { price: px, ts: now };
  }
  if (!Object.keys(out).length) return cache?.data ?? null;
  cache = { ts: Date.now(), data: out };
  return out;
}

export const dhanBroker: BrokerDef = {
  id: 'dhan',
  label: 'Dhan',
  feedLabel: 'DHAN',
  fields: [
    { key: 'token', label: 'Access token', hint: 'Dhan web/app → API access (never expires)' },
    { key: 'clientId', label: 'Client ID', hint: 'Your Dhan client ID' },
  ],
  async getCreds() {
    const c = await creds();
    return c ? { token: c.token, clientId: c.clientId } : null;
  },
  async saveCreds(v) {
    await Promise.all([
      SecureStorage.set(K.token, (v.token ?? '').trim()),
      SecureStorage.set(K.clientId, (v.clientId ?? '').trim()),
    ]);
    cache = null;
  },
  async clearCreds() {
    await Promise.all([SecureStorage.remove(K.token), SecureStorage.remove(K.clientId)].map(p => p.catch(() => undefined)));
    cache = null;
  },
  async testLogin(v) {
    if (!v.token?.trim() || !v.clientId?.trim()) return 'Enter the access token and client ID first.';
    await Promise.all([
      SecureStorage.set(K.token, v.token.trim()),
      SecureStorage.set(K.clientId, v.clientId.trim()),
    ]);
    cache = null;
    try {
      const out = await fetchDhanLTPs();
      if (out && Object.keys(out).length) return 'Dhan login OK — live LTP flowing.';
      return 'Token accepted but no LTP yet (market may be closed).';
    } catch (e: any) {
      return `Dhan login failed: ${e?.message ?? e}`;
    }
  },
  fetchLTPs: fetchDhanLTPs,
};
