export type DirectId = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

export interface BrokerField {
  key: string;
  label: string;
  secret?: boolean;
  hint?: string;
}

export interface LtpTick {
  price: number;
  ts: string;
}

/** One broker's on-device integration. No secrets ever leave secure storage. */
export interface BrokerDef {
  id: string;
  label: string;
  feedLabel: string;
  fields: BrokerField[];
  getCreds(): Promise<Record<string, string> | null>;
  saveCreds(values: Record<string, string>): Promise<void>;
  clearCreds(): Promise<void>;
  /** Full login + one live quote. Returns plain-words result for the UI. */
  testLogin(values: Record<string, string>): Promise<string>;
  /** 5s-cached LTPs for the 3 indices. Null when unconfigured/offline. */
  fetchLTPs(): Promise<Partial<Record<DirectId, LtpTick>> | null>;
}
