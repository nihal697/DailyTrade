import { getBridgeUrl } from './marketData';
import type { OptionUnderlying, OptionType } from '../types/trade';

export const OPTION_UNDERLYINGS: OptionUnderlying[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

export const UNDERLYING_YAHOO: Record<OptionUnderlying, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  SENSEX: '^BSESN',
};

const UNDERLYING_EXCHANGE: Record<OptionUnderlying, string> = {
  NIFTY: 'NFO',
  BANKNIFTY: 'NFO',
  SENSEX: 'BFO',
};

export interface DayRange {
  high: number;
  low: number;
  volume: number;
}

/** Today's range for one contract, from Angel history via the bridge. */
export async function fetchOptionDayRange(underlying: OptionUnderlying,
                                          token?: string): Promise<DayRange | null> {
  if (!token) return null;
  const base = getBridgeUrl();
  if (!base) return null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  try {
    const res = await fetch(
      `${base}/history?exchange=${UNDERLYING_EXCHANGE[underlying]}&token=${token}` +
      `&interval=ONE_DAY&frm=${day}%2000:00&to=${day}%2023:59`,
      { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const j = await res.json();
    const rows = Array.isArray(j?.candles) ? j.candles : [];
    const today = rows[rows.length - 1];
    if (!today) return null;
    return { high: today.high, low: today.low, volume: today.volume ?? 0 };
  } catch {
    return null;
  }
}

export interface ChainLeg {
  token?: string;
  ltp: number | null;
  lot_size: number;
  iv?: number | null;
  delta?: number | null;
  oi?: number | null;
}

export interface ChainStrike {
  strike: number;
  ce: ChainLeg;
  pe: ChainLeg;
}

export interface ChainData {
  underlying: OptionUnderlying;
  expiry: string | null;
  spot: number | null;
  lot_size: number;
  strikes: ChainStrike[];
  source?: string;
}

/** "NIFTY 22600 CE 13OCT" — readable, unique, doubles as the position symbol. */
export function makeOptionSymbol(underlying: OptionUnderlying, strike: number,
                                 optType: OptionType, expiry: string): string {
  const [y, m, d] = expiry.split('-');
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(m) - 1] ?? '';
  return `${underlying} ${strike} ${optType} ${d}${mon}`;
}

const chainCache = new Map<string, { ts: number; data: ChainData }>();
const CHAIN_TTL_MS = 10_000;

async function bridgeGet(path: string): Promise<any | null> {
  const base = getBridgeUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function bridgeConfigured(): boolean {
  return getBridgeUrl().length > 0;
}

export async function fetchOptionExpiries(underlying: OptionUnderlying): Promise<string[]> {
  const j = await bridgeGet(`/optionchain/expiries?underlying=${underlying}`);
  return Array.isArray(j?.expiries) ? j.expiries as string[] : [];
}

export async function fetchOptionChain(underlying: OptionUnderlying,
                                       expiry?: string): Promise<ChainData | null> {
  const key = `${underlying}|${expiry ?? 'nearest'}`;
  const cached = chainCache.get(key);
  if (cached && Date.now() - cached.ts < CHAIN_TTL_MS) return cached.data;
  const q = `/optionchain?underlying=${underlying}` + (expiry ? `&expiry=${expiry}` : '');
  const j = await bridgeGet(q);
  if (!j || j.error || !Array.isArray(j.strikes)) return cached?.data ?? null;
  const data = j as ChainData;
  chainCache.set(key, { ts: Date.now(), data });
  return data;
}
