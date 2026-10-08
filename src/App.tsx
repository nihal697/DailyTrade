import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import './index.css';

import { useTradingEngine } from './hooks/useTradingEngine';
import { Header }          from './components/Header';
import { BottomNav, type Tab } from './components/BottomNav';
import { TradingViewChart } from './components/TradingViewChart';
import { Watchlist }        from './components/Watchlist';
import { TradeModal }       from './components/TradeModal';
import { PositionsList }    from './components/PositionsList';
import { PortfolioChart }   from './components/PortfolioChart';
import { PortfolioBreakdown } from './components/PortfolioBreakdown';
import { AssetDetail }      from './components/AssetDetail';
import { ChainView, type TradeLeg } from './components/ChainView';
import { OptionTicket }    from './components/OptionTicket';
import { AccountModal }     from './components/AccountModal';
import { ExportModal }      from './components/ExportModal';
import { ImportModal }      from './components/ImportModal';
import { ToastContainer, type ToastMessage } from './components/Toast';

import { ASSETS, ASSET_MAP } from './data/assets';
import type { Asset, Timeframe } from './types/market';
import { formatCurrency, type AppState } from './services/storage';
import { checkAndAutoRestore } from './services/backupService';
import {
  fetchBinanceCandles, fetchCandles, fetchYahooQuote, isMarketOpen,
  subscribeLiveQuote, subscribeAllQuotes, startSyntheticTicks,
  toUSD, fromUSD, refreshUsdInr,
} from './services/marketData';
import { fetchOptionChain, makeOptionSymbol, UNDERLYING_YAHOO } from './services/optionChain';
import type { Candle } from './types/market';
import { Info, Download } from 'lucide-react';
import { formatAssetPrice } from './utils/formatPrice';

const DEFAULT_ASSET = ASSETS[0]; // BTC

export default function App() {
  // Toast notifications state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = useCallback((title: string, message?: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-3), { id, title, message, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const engine = useTradingEngine(addToast);
  const [tab, setTab] = useState<Tab>('trade');
  const [selectedAsset, setSelectedAsset] = useState<Asset>(DEFAULT_ASSET);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [ticketLeg, setTicketLeg] = useState<TradeLeg | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [accountModalView, setAccountModalView] = useState<'list' | 'create' | 'about'>('list');

  // Check for auto-restore after app update / fresh webview state
  useEffect(() => {
    checkAndAutoRestore().then(({ restored, restoredState }) => {
      if (restored && restoredState) {
        engine.replaceState(restoredState);
        addToast(
          'Portfolio Restored',
          'Successfully auto-restored your accounts from device backup (Documents/DailyTrade).',
          'success'
        );
      }
    });
  }, [engine.replaceState, addToast]);

  // Favorites state persisted in localStorage
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dailytrade_favorites');
      return saved ? JSON.parse(saved) : ['BTCUSDT', 'AAPL', 'RELIANCE.NS', 'GC=F'];
    } catch {
      return ['BTCUSDT', 'AAPL', 'RELIANCE.NS', 'GC=F'];
    }
  });

  const toggleFavorite = (symbol: string) => {
    setFavorites(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      try {
        localStorage.setItem('dailytrade_favorites', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // PWA Install prompt handler
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      addToast('DailyTrade Installed', 'App installed on your device!', 'success');
      setInstallPrompt(null);
    }
  };

  // Merge incoming price updates into shared prices map
  const handlePricesUpdate = useCallback((update: Record<string, number>) => {
    setPrices(prev => ({ ...prev, ...update }));
  }, []);

  // Load historical candles whenever asset or timeframe changes
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setCandles([]);
    const isCrypto = selectedAsset.class === 'crypto';
    const loadCandles = isCrypto
      ? fetchBinanceCandles(selectedAsset.quoteSymbol, timeframe, controller.signal)
      : fetchCandles(selectedAsset.quoteSymbol, timeframe, controller.signal);

    loadCandles.then(data => {
      setCandles(data);
      setLoading(false);
    }).catch(() => {
      // Aborted — do nothing, a new fetch is already in flight
    });

    return () => controller.abort();
  }, [selectedAsset, timeframe]);

  // Always-on crypto price stream at App level (not torn down on tab switch)
  useEffect(() => {
    const unsub = subscribeAllQuotes((q) => {
      handlePricesUpdate({ [q.symbol]: q.price });
    });
    return unsub;
  }, [handlePricesUpdate]);

  // FX rate for the engine (engine math is USD-true; display stays native)
  useEffect(() => {
    refreshUsdInr();
    const id = setInterval(refreshUsdInr, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Engine always eats USD; display keeps native quotes.
  const pricesUSD = useMemo(
    () => Object.fromEntries(Object.entries(prices).map(([s, p]) => [s, toUSD(p, s)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prices]
  );

  // Subscribe live price for selected asset
  useEffect(() => {
    const isCrypto = selectedAsset.class === 'crypto';
    let stopSynthetic: (() => void) | null = null;

    if (isCrypto) {
      // Binance live WebSocket for crypto
      const unsub = subscribeLiveQuote(selectedAsset.symbol, (q) => {
        setLivePrice(q.price);
        handlePricesUpdate({ [selectedAsset.symbol]: q.price });
      });
      return unsub;
    } else {
      let cancelled = false;
      const existingPrice = prices[selectedAsset.symbol];
      if (existingPrice) {
        setLivePrice(existingPrice);
      }

      fetchYahooQuote(selectedAsset.quoteSymbol).then(q => {
        if (cancelled) return;
        const targetPrice = q?.price ?? existingPrice ?? 100;
        setLivePrice(targetPrice);
        handlePricesUpdate({ [selectedAsset.symbol]: targetPrice });
        // Synthetic ticks bridge gaps between real ticks — they must never
        // invent movement in a closed market (or limit orders would fill on
        // fabricated prices). Ticks run only on proven-open state.
        if (!isMarketOpen(selectedAsset.quoteSymbol)) return;
        stopSynthetic = startSyntheticTicks(selectedAsset.symbol, targetPrice, (price) => {
          if (cancelled) return;
          setLivePrice(price);
          handlePricesUpdate({ [selectedAsset.symbol]: price });
          engine.checkLimitOrders({ [selectedAsset.symbol]: toUSD(price, selectedAsset.symbol) });
        }, 1200);
      });

      return () => {
        cancelled = true;
        stopSynthetic?.();
      };
    }
  }, [selectedAsset, handlePricesUpdate]);

  // Check limit orders on every crypto price update too
  useEffect(() => {
    if (!livePrice || !selectedAsset) return;
    engine.checkLimitOrders({ [selectedAsset.symbol]: toUSD(livePrice, selectedAsset.symbol) });
  }, [livePrice, selectedAsset]);

  // ── Option contract live prices (bridge chain polling) ──────────────────
  // Feeds held contracts into the same prices map, so MTM, limit orders,
  // SL/TP and equity all work with zero engine changes.
  useEffect(() => {
    const optPositions = engine.positions.filter(p => p.opt);
    if (!optPositions.length) return;
    let cancelled = false;
    const poll = async () => {
      const byKey = new Map<string, typeof optPositions>();
      for (const p of optPositions) {
        const k = `${p.opt!.underlying}|${p.opt!.expiry}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(p);
      }
      const updates: Record<string, number> = {};
      for (const group of byKey.values()) {
        if (cancelled) return;
        const chain = await fetchOptionChain(group[0].opt!.underlying, group[0].opt!.expiry).catch(() => null);
        if (!chain || cancelled) continue;
        const byToken = new Map<string, number>();
        for (const s of chain.strikes) {
          if (s.ce.ltp != null) byToken.set(String(s.ce.token), s.ce.ltp);
          if (s.pe.ltp != null) byToken.set(String(s.pe.token), s.pe.ltp);
        }
        for (const p of group) {
          const px = byToken.get(p.opt!.token);
          if (px != null) updates[makeOptionSymbol(p.opt!.underlying, p.opt!.strike, p.opt!.optType, p.opt!.expiry)] = px;
        }
      }
      if (cancelled) return;
      if (Object.keys(updates).length) {
        handlePricesUpdate(updates);
        engine.checkLimitOrders(
          Object.fromEntries(Object.entries(updates).map(([s, v]) => [s, toUSD(v, s)]))
        );
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.positions.map(p => p.id).join(',')]);

  // ── Expired option settlement (European cash-settled at expiry close) ───
  useEffect(() => {
    let cancelled = false;
    const settle = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const expired = engine.positions.filter(p => p.opt && p.opt.expiry < today);
      if (!expired.length) return;
      const byUnderlying = new Map<string, typeof expired>();
      for (const p of expired) {
        const u = p.opt!.underlying;
        if (!byUnderlying.has(u)) byUnderlying.set(u, []);
        byUnderlying.get(u)!.push(p);
      }
      for (const [u, group] of byUnderlying) {
        if (cancelled) return;
        let closes: { time: number; close: number }[] = [];
        try {
          closes = await fetchCandles(UNDERLYING_YAHOO[u as keyof typeof UNDERLYING_YAHOO], '1D');
        } catch { continue; }
        for (const p of group) {
          if (cancelled) return;
          const day = closes
            .filter(c => new Date(c.time * 1000).toISOString().slice(0, 10) <= p.opt!.expiry)
            .sort((a, b) => b.time - a.time)[0];
          if (!day) continue; // no expiry-day data yet — try next run
          const intrinsic = p.opt!.optType === 'CE'
            ? Math.max(0, day.close - p.opt!.strike)
            : Math.max(0, p.opt!.strike - day.close);
          engine.settleOptionExpiry(p.id, toUSD(intrinsic, UNDERLYING_YAHOO[u as keyof typeof UNDERLYING_YAHOO]));
        }
      }
    };
    settle();
    const id = setInterval(settle, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.positions.map(p => p.id).join(',')]);

  // Record equity snapshot every 30 seconds
  const equityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    equityTimerRef.current = setInterval(() => {
      engine.recordEquity(pricesUSD);
    }, 30_000);
    return () => clearInterval(equityTimerRef.current!);
  }, [pricesUSD, engine.recordEquity]);

  const totalEquityUSD = engine.calcEquity(pricesUSD);
  const unrPnLUSD = engine.calcUnrealisedPnL(pricesUSD);
  const curPrice = livePrice ?? prices[selectedAsset.symbol] ?? 0;

  const handleSelectAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setTab('trade');
  };

  // ── Option buy (long CE/PE only in v1; exit via Portfolio, auto-settle at expiry)
  const handleBuyOption = (leg: TradeLeg, lots: number, price: number,
                           type: 'market' | 'limit', limitPrice?: number): string | null => {
    const symbol = makeOptionSymbol(leg.underlying, leg.strike, leg.optType, leg.expiry);
    const qty = lots * leg.lotSize;
    const opt = {
      underlying: leg.underlying, strike: leg.strike, optType: leg.optType,
      expiry: leg.expiry, lotSize: leg.lotSize, lots, token: leg.token ?? '',
    };
    if (type === 'market') {
      if (!(price > 0)) return 'No live premium yet — wait for a tick.';
      return engine.marketBuy(symbol, qty, toUSD(price, symbol), undefined, undefined, opt);
    }
    if (!(limitPrice && limitPrice > 0)) return 'Enter a limit premium.';
    return engine.placeLimitOrder(symbol, 'buy', qty, toUSD(limitPrice, symbol), opt);
  };

  const handleImport = (s: AppState) => {
    engine.replaceState(s);
    addToast('Portfolio Restored', 'Accounts and trading data loaded.', 'success');
  };

  return (
    <div className="app-shell">
      {/* ── Toast Notifications ───────────────────────────────── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Optional PWA Install Bar ─────────────────────────── */}
      {installPrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(90deg, #1e1b4b, #0f172a)',
          borderBottom: '1px solid rgba(99, 102, 241, 0.4)',
          padding: '6px 14px', zIndex: 100,
        }}>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <Download size={13} color="#a5b4fc" />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: '#e0e7ff', fontWeight: 600 }}>
              Install DailyTrade APK/App on your device
            </span>
          </div>
          <button
            onClick={handleInstallClick}
            style={{
              background: '#4f46e5', border: 'none', color: '#fff',
              fontSize: 10, fontWeight: 700, padding: '4px 10px',
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
            }}
          >
            INSTALL NOW
          </button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <Header
        account={engine.activeAccount}
        totalEquityUSD={totalEquityUSD}
        unrPnLUSD={unrPnLUSD}
        onOpenAccountModal={() => { setAccountModalView('list'); setShowAccountModal(true); }}
        onQuickTopUp={(amt) => engine.topUpAccount(amt)}
      />

      {/* ── Main Content ────────────────────────────────────────── */}
      <main className="app-content">
        {/* TRADE TAB */}
        {tab === 'trade' && (
          <div className="col" style={{ height: '100%' }}>
            <TradingViewChart
              symbol={selectedAsset.symbol.replace('.NS','').replace('USDT','')}
              name={selectedAsset.name}
              assetClass={selectedAsset.class}
              candles={candles}
              livePrice={livePrice}
              entryPrice={engine.positions.find(p => p.symbol === selectedAsset.symbol)?.entryPriceUSD}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              loading={loading}
              onBack={() => setTab('markets')}
            />

            {/* Asset info + Details + Trade button */}
            <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-dim)', background: 'var(--bg-card)' }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <div className="col" style={{ gap: 3 }}>
                  {/* Asset class chip + name */}
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {selectedAsset.class} ·
                    </span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {selectedAsset.name}
                    </span>
                  </div>

                  {/* Price — mono for numbers */}
                  <div className="row gap-2" style={{ alignItems: 'center', marginTop: 2 }}>
                    {curPrice > 0 ? (
                      <span className="price" style={{ fontSize: 22 }}>
                        {formatAssetPrice(curPrice, selectedAsset.symbol)}
                      </span>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)' }}>Fetching price…</span>
                    )}
                    <div className="live-dot" />
                  </div>
                </div>

                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '11px 14px', letterSpacing: '0.04em' }}
                    onClick={() => setDetailAsset(selectedAsset)}
                    title="View 52-week stats, P/E, volume & live news"
                  >
                    STATS / NEWS
                  </button>
                  <button
                    className="btn btn-bull"
                    style={{ fontSize: 13, fontWeight: 700, padding: '11px 22px', letterSpacing: '0.05em' }}
                    onClick={() => setShowTradeModal(true)}
                    disabled={!curPrice}
                  >
                    TRADE
                  </button>
                </div>
              </div>

              {/* Open positions for this asset */}
              {engine.positions.filter(p => p.symbol === selectedAsset.symbol).map(pos => {
                const cur = prices[pos.symbol] ?? pos.entryPriceUSD;
                const pnl = (cur - pos.entryPriceUSD) * pos.quantity;
                const isUp = pnl >= 0;
                return (
                  <div key={pos.id} className="row between" style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border-dim)', marginTop: 8 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      LONG {pos.quantity.toFixed(pos.quantity < 1 ? 6 : 4)} @ {formatAssetPrice(fromUSD(pos.entryPriceUSD, pos.symbol), pos.symbol)}
                    </span>
                    <div className="row gap-2">
                      <span className="num font-bold" style={{ fontSize: 12, color: isUp ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                        {isUp ? '+' : ''}{formatCurrency(pnl, engine.activeAccount.currency, true)}
                      </span>
                      <button
                        className="btn btn-bear"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => engine.closePosition(pos.id, toUSD(cur, pos.symbol))}
                      >
                        CLOSE
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MARKETS TAB */}
        {tab === 'markets' && (
          <Watchlist
            onSelectAsset={handleSelectAsset}
            selectedSymbol={selectedAsset.symbol}
            prices={prices}
            onPricesUpdate={handlePricesUpdate}
            onOpenDetail={(asset) => setDetailAsset(asset)}
          />
        )}

        {/* OPTIONS TAB */}
        {tab === 'options' && (
          <ChainView onTradeLeg={setTicketLeg} />
        )}

        {/* PORTFOLIO TAB */}
        {tab === 'portfolio' && (
          <div className="col" style={{ height: '100%', overflowY: 'auto' }}>
            <PortfolioChart
              history={engine.state.equityHistory[engine.state.activeAccountId] ?? []}
              account={engine.activeAccount}
              totalEquityUSD={totalEquityUSD}
            />
            <PortfolioBreakdown
              positions={engine.positions}
              prices={prices}
              account={engine.activeAccount}
              totalEquityUSD={totalEquityUSD}
            />
            <PositionsList
              positions={engine.positions}
              orders={engine.orders}
              history={engine.history}
              prices={prices}
              account={engine.activeAccount}
              onClosePosition={(id, price) => {
            const pos = engine.positions.find(pp => pp.id === id);
            engine.closePosition(id, pos ? toUSD(price, pos.symbol) : price);
          }}
              onCancelOrder={engine.cancelOrder}
              onOpenAbout={() => { setAccountModalView('about'); setShowAccountModal(true); }}
            />
          </div>
        )}
      </main>

      {/* ── Bottom Navigation ───────────────────────────────────── */}
      <BottomNav
        active={tab}
        onChange={(newTab) => {
          if (newTab === 'accounts') {
            setAccountModalView('list');
            setShowAccountModal(true);
          } else {
            setTab(newTab);
          }
        }}
        openPositions={engine.positions.length}
      />

      {/* ── Trade Modal ─────────────────────────────────────────── */}
      {showTradeModal && curPrice > 0 && (
        <TradeModal
          asset={selectedAsset}
          currentPrice={curPrice}
          account={engine.activeAccount}
          positionQty={engine.positions.find(p => p.symbol === selectedAsset.symbol)?.quantity}
          onMarketBuy={(qty, sl, tp) => engine.marketBuy(selectedAsset.symbol, qty, toUSD(curPrice, selectedAsset.symbol), sl == null ? sl : toUSD(sl, selectedAsset.symbol), tp == null ? tp : toUSD(tp, selectedAsset.symbol))}
          onLimitOrder={(side, qty, price) => engine.placeLimitOrder(selectedAsset.symbol, side, qty, toUSD(price, selectedAsset.symbol))}
          onClose={() => setShowTradeModal(false)}
        />
      )}

      {/* ── Option Ticket Modal ─────────────────────────────────────────── */}
      {ticketLeg && (
        <OptionTicket
          leg={ticketLeg}
          onBuy={(lots, price, type, limitPrice) =>
            handleBuyOption(ticketLeg, lots, price, type, limitPrice)}
          onClose={() => setTicketLeg(null)}
        />
      )}

      {/* ── Asset Detail Sheet / Modal ──────────────────────────── */}
      {detailAsset && (
        <AssetDetail
          asset={detailAsset}
          currentPrice={prices[detailAsset.symbol] ?? (detailAsset.symbol === selectedAsset.symbol ? curPrice : 0)}
          isFavourite={favorites.includes(detailAsset.symbol)}
          onToggleFavourite={() => toggleFavorite(detailAsset.symbol)}
          onGoToChart={() => {
            setSelectedAsset(detailAsset);
            setDetailAsset(null);
            setTab('trade');
          }}
          onClose={() => setDetailAsset(null)}
        />
      )}

      {/* ── Account Modal ───────────────────────────────────────── */}
      {showAccountModal && (
        <AccountModal
          accounts={engine.state.accounts}
          activeAccountId={engine.state.activeAccountId}
          state={engine.state}
          initialView={accountModalView}
          onSwitch={(id) => { engine.switchAccount(id); setLivePrice(null); }}
          onCreate={engine.createAccount}
          onTopUp={engine.topUpAccount}
          onReset={engine.resetAccount}
          onDelete={engine.deleteAccount}
          onUpdateCurrency={engine.updateAccountCurrency}
          onImport={handleImport}
          onOpenExport={() => setShowExportModal(true)}
          onOpenImport={() => setShowImportModal(true)}
          onClose={() => setShowAccountModal(false)}
        />
      )}

      {/* ── Export Modal ────────────────────────────────────────── */}
      {showExportModal && (
        <ExportModal
          state={engine.state}
          onSuccess={(path) => {
            addToast('Backup Exported', `Saved to ${path}`, 'success');
          }}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* ── Import Modal ────────────────────────────────────────── */}
      {showImportModal && (
        <ImportModal
          currentState={engine.state}
          onConfirmRestore={(restoredState, mode) => {
            engine.replaceState(restoredState);
            addToast(
              'Portfolio Restored',
              mode === 'merge' ? 'Accounts merged into your portfolio successfully!' : 'Portfolio overwritten with backup!',
              'success'
            );
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
