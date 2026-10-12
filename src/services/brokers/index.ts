import type { BrokerDef } from './types';
import { angelBroker } from './angel';
import { dhanBroker } from './dhan';

export const BROKERS: BrokerDef[] = [angelBroker, dhanBroker];

const ACTIVE_KEY = 'dt_broker';

export function getBroker(id: string): BrokerDef | undefined {
  return BROKERS.find(b => b.id === id);
}

export function getActiveBrokerId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || 'angel';
  } catch {
    return 'angel';
  }
}

export function setActiveBrokerId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch { /* ignore */ }
}

export async function getActiveBroker(): Promise<BrokerDef> {
  const def = getBroker(getActiveBrokerId()) ?? angelBroker;
  // fall back to whichever broker actually has credentials
  if (await def.getCreds()) return def;
  for (const b of BROKERS) {
    if (b.id !== def.id && (await b.getCreds())) return b;
  }
  return def;
}
