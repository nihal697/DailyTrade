import { useState, useEffect, useCallback, useRef } from 'react';
import { formatAssetPrice } from '../utils/formatPrice';
import {
  OPTION_UNDERLYINGS, fetchOptionExpiries, fetchOptionChain, bridgeConfigured,
  type ChainData, type ChainStrike,
} from '../services/optionChain';
import type { OptionUnderlying, OptionType } from '../types/trade';

export interface TradeLeg {
  underlying: OptionUnderlying;
  strike: number;
  optType: OptionType;
  expiry: string;
  lotSize: number;
  ltp: number | null;
  token?: string;
}

interface Props {
  onTradeLeg: (leg: TradeLeg) => void;
}

export function ChainView({ onTradeLeg }: Props) {
  const [underlying, setUnderlying] = useState<OptionUnderlying>('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>('');
  const [chain, setChain] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState('');

  const configured = bridgeConfigured();

  const load = useCallback(async () => {
    if (!configured) { setLoading(false); return; }
    const exps = await fetchOptionExpiries(underlying);
    if (exps.length) {
      setExpiries(exps);
      const exp = expiry && exps.includes(expiry) ? expiry : exps[0];
      setExpiry(exp);
      const c = await fetchOptionChain(underlying, exp);
      if (c) setChain(c);
    }
    setLoading(false);
  }, [underlying, expiry, configured]);

  useEffect(() => {
    setExpiry('');
    setChain(null);
    setLoading(true);
  }, [underlying]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  if (!configured) {
    return (
      <div className="col" style={{ padding: 24, gap: 12, alignItems: 'center', textAlign: 'center' }}>
        <span className="mono font-bold" style={{ fontSize: 14 }}>OPTIONS NEED A FEED</span>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Chains stream from your broker bridge. Set it in Accounts → About → Live Data first.
        </p>
      </div>
    );
  }

  const atm = chain?.spot != null && chain.strikes.length
    ? chain.strikes.reduce((a, b) => Math.abs(b.strike - chain.spot!) < Math.abs(a.strike - chain.spot!) ? b : a)
    : null;

  // Jump to the ATM row on underlying/expiry change — the list opens at the
  // top (deep OTM) otherwise, and those rows can never have ticks by design.
  const scrolledKey = useRef('');
  useEffect(() => {
    if (!chain || !atm) return;
    const key = `${underlying}|${expiry}`;
    if (scrolledKey.current === key) return;
    scrolledKey.current = key;
    requestAnimationFrame(() => {
      document.getElementById(`opt-row-${atm.strike}`)?.scrollIntoView({ block: 'center' });
    });
  }, [chain, atm, underlying, expiry]);

  const cell = (s: ChainStrike, side: 'ce' | 'pe') => {
    const leg = s[side];
    const optType = (side === 'ce' ? 'CE' : 'PE') as OptionType;
    const has = leg.ltp != null && leg.ltp > 0;
    return (
      <button
        key={side}
        onClick={() => {
          if (has) {
            setHint('');
            onTradeLeg({
              underlying, strike: s.strike, optType, expiry: chain!.expiry ?? '',
              lotSize: leg.lot_size || chain?.lot_size || 1, ltp: leg.ltp, token: leg.token,
            });
          } else {
            setHint('No live premium on this strike yet — taps work once its tick streams in.');
          }
        }}
        style={{
          flex: 1, padding: '9px 4px', cursor: has ? 'pointer' : 'default',
          background: has ? 'var(--bg-subtle)' : 'transparent',
          border: '1px solid var(--border-dim)', color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, opacity: has ? 1 : 0.35,
        }}
      >
        {has ? leg.ltp!.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
      </button>
    );
  };

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ borderBottom: '1px solid var(--border-dim)' }}>
        {OPTION_UNDERLYINGS.map(u => (
          <button
            key={u}
            onClick={() => setUnderlying(u)}
            className={`tab-btn${underlying === u ? ' active' : ''}`}
            style={{ flex: 1 }}
          >
            {u === 'BANKNIFTY' ? 'BANK' : u}
          </button>
        ))}
      </div>

      <div className="row between" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-dim)' }}>
        <select
          value={expiry}
          onChange={e => { setExpiry(e.target.value); setChain(null); }}
          style={{
            background: '#000', color: 'var(--text-primary)', border: '1px solid var(--border-mid)',
            fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 8px', borderRadius: 0,
          }}
        >
          {expiries.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {chain?.spot != null ? `SPOT ${formatAssetPrice(chain.spot, '^NSEI')}` : loading ? 'LOADING…' : ''}
          {chain && <span style={{ color: '#6ee7b7' }}> · ANGEL</span>}
        </span>
      </div>

      <div className="row" style={{ padding: '6px 8px', gap: 6, borderBottom: '1px solid var(--border-dim)' }}>
        <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-bull)' }}>CALLS</span>
        <span style={{ width: 76, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>STRIKE</span>
        <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-bear)' }}>PUTS</span>
      </div>
      {hint && (
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: '6px 12px' }}>
          {hint}
        </p>
      )}

      <div className="col" style={{ overflowY: 'auto', padding: '4px 8px 12px', gap: 4 }}>
        {chain?.strikes.map(s => {
          const isAtm = atm?.strike === s.strike;
          return (
            <div key={s.strike} id={`opt-row-${s.strike}`} className="row" style={{
              gap: 6, alignItems: 'center',
              background: isAtm ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: isAtm ? '1px solid var(--border-mid)' : '1px solid transparent',
              padding: isAtm ? 3 : 0,
            }}>
              {cell(s, 'ce')}
              <span style={{ width: 76, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: isAtm ? 700 : 400 }}>
                {s.strike.toLocaleString('en-US')}
              </span>
              {cell(s, 'pe')}
            </div>
          );
        })}
        {!loading && !chain?.strikes.length && (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 20 }}>
            No strikes yet — bridge still warming up or market closed.
          </p>
        )}
      </div>
    </div>
  );
}
