import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { formatAssetPrice } from '../utils/formatPrice';
import { makeOptionSymbol, fetchOptionDayRange, type DayRange } from '../services/optionChain';
import type { TradeLeg } from './ChainView';

interface Props {
  leg: TradeLeg;
  onBuy: (lots: number, price: number,
          type: 'market' | 'limit', limitPrice?: number) => string | null;
  onClose: () => void;
}

export function OptionTicket({ leg, onBuy, onClose }: Props) {
  const [lots, setLots] = useState(1);
  const [tab, setTab] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState(leg.ltp != null && leg.ltp > 0 ? String(leg.ltp) : '');
  const [error, setError] = useState('');
  const [dayRange, setDayRange] = useState<DayRange | 'loading' | null>('loading');

  useEffect(() => {
    let live = true;
    fetchOptionDayRange(leg.underlying, leg.token).then(d => { if (live) setDayRange(d); });
    return () => { live = false; };
  }, [leg.underlying, leg.token]);

  const symbol = makeOptionSymbol(leg.underlying, leg.strike, leg.optType, leg.expiry);
  const units = lots * leg.lotSize;
  const refPrice = tab === 'market'
    ? (leg.ltp ?? 0)
    : (parseFloat(limitPrice) || 0);
  const cost = refPrice * units;
  const canSubmit = units > 0 && refPrice > 0;

  const submit = () => {
    const err = onBuy(lots, tab === 'market' ? (leg.ltp ?? 0) : refPrice,
                      tab, tab === 'limit' ? refPrice : undefined);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="col gap-1">
            <span className="mono font-bold" style={{ fontSize: 15 }}>{symbol}</span>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>
              {leg.optType} · Strike {leg.strike.toLocaleString('en-US')} · Exp {leg.expiry} · Lot {leg.lotSize}
            </span>
          </div>
          <button className="btn btn-ghost" style={{ padding: '6px 8px' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="row between" style={{ padding: '8px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-dim)', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>PREMIUM</span>
          <span className="num font-bold" style={{ fontSize: 16 }}>
            {leg.ltp != null && leg.ltp > 0 ? formatAssetPrice(leg.ltp, 'OPT') : '—'}
          </span>
        </div>

        <div className="tab-bar" style={{ marginBottom: 12 }}>
          {(['market', 'limit'] as const).map(t => (
            <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t.toUpperCase()} ORDER
            </button>
          ))}
        </div>

        <div className="row between" style={{ marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>LOTS</span>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => setLots(Math.max(1, lots - 1))}>−</button>
            <span className="mono font-bold" style={{ fontSize: 16, minWidth: 32, textAlign: 'center' }}>{lots}</span>
            <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => setLots(Math.min(100, lots + 1))}>+</button>
          </div>
        </div>

        {tab === 'limit' && (
          <div className="col gap-1" style={{ marginBottom: 12 }}>
            <label style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>LIMIT PREMIUM</label>
            <input
              className="input" type="number" min="0" step="0.05" value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)} placeholder="0.00"
            />
          </div>
        )}

        <div className="row between" style={{ padding: '8px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-dim)', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            COST · {lots} LOT{lots > 1 ? 'S' : ''} × {units} QTY
          </span>
          <span className="num font-bold" style={{ fontSize: 14 }}>{formatAssetPrice(cost, 'OPT')}</span>
        </div>

        <div className="row between" style={{ padding: '8px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-dim)', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>DAY RANGE · VOL</span>
          <span className="num font-bold" style={{ fontSize: 12 }}>
            {dayRange === 'loading' ? '…' : dayRange
              ? `${formatAssetPrice(dayRange.low, 'OPT')} – ${formatAssetPrice(dayRange.high, 'OPT')} · ${dayRange.volume.toLocaleString('en-US')}`
              : '—'}
          </span>
        </div>

        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          Long {leg.optType} only in v1 — exit via Portfolio, auto-settled at expiry (ITM → intrinsic, OTM → zero).
        </p>

        {error && (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--color-bear)', marginBottom: 8 }}>{error}</p>
        )}

        <button
          className="btn btn-bull"
          style={{ width: '100%', padding: '12px', fontSize: 13 }}
          disabled={!canSubmit}
          onClick={submit}
        >
          BUY {lots} LOT{lots > 1 ? 'S' : ''} {tab === 'market' ? 'AT MARKET' : 'LIMIT'}
        </button>
      </div>
    </div>
  );
}
