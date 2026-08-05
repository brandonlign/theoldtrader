"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function money(value, digits = 2) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

function number(value, digits = 2) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "0";
}

function percent(value, digits = 2) {
  return `${number(Number(value ?? 0) * 100, digits)}%`;
}

function time(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function label(strategy) {
  if (strategy === "BINARY_COMPLETE_SET") return "Binary complete set";
  if (strategy === "MULTI_OUTCOME_COMPLETE_SET") return "Multi-outcome set";
  if (strategy === "WHALE_COPY") return "Conservative whale";
  return strategy || "Unknown";
}

function short(value) {
  const text = String(value ?? "");
  return text.length > 18 ? `${text.slice(0, 9)}…${text.slice(-6)}` : text;
}

function statusOf(health) {
  return String(health?.health ?? health?.status ?? "PAUSED").toUpperCase();
}

function worstStatus(...statuses) {
  const order = { UNHEALTHY: 4, DEGRADED: 3, PAUSED: 2, HEALTHY: 1 };
  return statuses.reduce((worst, status) => (order[status] ?? 0) > (order[worst] ?? 0) ? status : worst, "HEALTHY");
}

function skipLines(skips = {}) {
  return Object.entries(skips)
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${count} ${reason.replaceAll("-", " ")}`);
}

const EMPTY_PORTFOLIO = {
  startingCash: 10000,
  cash: 10000,
  realizedPnl: 0,
  positions: [],
  openPositionValue: 0,
  equity: 10000
};

const EMPTY = {
  configured: false,
  portfolio: EMPTY_PORTFOLIO,
  executions: [],
  opportunities: [],
  decisions: [],
  signals: [],
  performance: [],
  health: { status: "PAUSED", simulationEnabled: false },
  crypto: {
    portfolio: EMPTY_PORTFOLIO,
    signals: [],
    executions: [],
    health: { status: "PAUSED", simulationEnabled: false }
  }
};

function MetricStrip({ items }) {
  return (
    <section className="hosted-metrics">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong className={item.tone ?? ""}>{item.value}</strong>
          <small>{item.note}</small>
        </article>
      ))}
    </section>
  );
}

function HealthPanel({ title, health, rows = [] }) {
  const status = statusOf(health);
  return (
    <article className="hosted-panel">
      <div className="hosted-heading">
        <div><p>Worker</p><h2>{title}</h2></div>
        <span className={`health-word status-${status.toLowerCase()}`}>{status}</span>
      </div>
      <dl className="health-list">
        <div><dt>Simulation</dt><dd>{health?.simulationEnabled ? "Active" : "Paused"}</dd></div>
        <div><dt>Run ID</dt><dd>{short(health?.runId) || "None"}</dd></div>
        <div><dt>Errors</dt><dd>{Number(health?.errorCount ?? 0)}</dd></div>
        <div><dt>Last started</dt><dd>{time(health?.startedAt)}</dd></div>
        {rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
      </dl>
    </article>
  );
}

function PolymarketDesk({ snapshot }) {
  const portfolio = snapshot.portfolio ?? EMPTY_PORTFOLIO;
  const positions = portfolio.positions ?? [];
  const health = snapshot.health ?? EMPTY.health;
  const selected = (snapshot.decisions ?? []).filter((item) => item.selected);
  const rejected = (snapshot.decisions ?? []).filter((item) => !item.selected);
  const totalEquity = Number(portfolio.cash ?? 0) + Number(portfolio.openPositionValue ?? 0);
  const returnPct = Number(portfolio.startingCash ?? 0) > 0
    ? ((totalEquity + Number(portfolio.realizedPnl ?? 0) - Number(portfolio.startingCash)) / Number(portfolio.startingCash)) * 100
    : 0;
  const performanceByStrategy = new Map((snapshot.performance ?? []).map((item) => [item.strategy, item]));
  const scans = health.summary?.scans ?? {};
  const binarySkips = skipLines(scans.binarySkipped);
  const multiSkips = skipLines(scans.multiSkipped);

  return (
    <>
      <MetricStrip items={[
        { label: "Paper balance", value: money(portfolio.cash), note: "Polymarket D1 cash" },
        { label: "Realized paper P&L", value: money(portfolio.realizedPnl), note: `${number(returnPct, 2)}% account return`, tone: Number(portfolio.realizedPnl) >= 0 ? "gain" : "loss" },
        { label: "Open exposure", value: money(portfolio.openPositionValue), note: `${positions.length} positions` },
        { label: "Hero selections", value: selected.length, note: `${rejected.length} recent rejections` }
      ]} />

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>Scanner</p><h2>What it actually checked</h2></div><span>{Number(scans.binaryMarkets ?? 0) + Number(scans.multiEvents ?? 0)}</span></div>
          <div className="scan-grid">
            <div><span>Binary markets</span><strong>{Number(scans.binaryMarkets ?? 0)}</strong><small>{Number(scans.binaryBooks ?? 0)} live books loaded</small></div>
            <div><span>Multi-outcome events</span><strong>{Number(scans.multiEvents ?? 0)}</strong><small>{Number(scans.multiValidated ?? 0)} passed structure checks</small></div>
            <div><span>Opportunities found</span><strong>{Number(health.opportunities ?? 0)}</strong><small>{Number(health.selected ?? 0)} selected by Hero</small></div>
          </div>
          <div className="skip-ledger">
            <div><strong>Binary rejection reasons</strong><p>{binarySkips.join(" · ") || "No binary rejection details recorded."}</p></div>
            <div><strong>Multi-outcome rejection reasons</strong><p>{multiSkips.join(" · ") || "No multi-outcome rejection details recorded."}</p></div>
          </div>
        </article>
        <HealthPanel title="Polymarket health" health={health} rows={[
          ["Last finished", time(health.finishedAt)],
          ["Executions", Number(health.executions ?? 0)]
        ]} />
      </section>

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>Portfolio</p><h2>Open positions</h2></div><span>{positions.length}</span></div>
          {positions.length ? <div className="hosted-table-wrap"><table><thead><tr><th>Strategy</th><th>Market / token</th><th>Side</th><th>Shares</th><th>Cost basis</th></tr></thead><tbody>
            {positions.map((item) => <tr key={`${item.strategy}:${item.marketKey}:${item.tokenId}`}><td>{label(item.strategy)}</td><td><strong>{short(item.marketKey)}</strong><small>{short(item.tokenId)}</small></td><td>{item.side}</td><td>{number(item.shares, 4)}</td><td>{money(item.costBasis)}</td></tr>)}
          </tbody></table></div> : <div className="hosted-empty"><strong>No open exposure</strong><p>The Hero allocator has not accepted a fill that leaves inventory.</p></div>}
        </article>
        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Performance</p><h2>By strategy</h2></div></div>
          <div className="strategy-performance">
            {["BINARY_COMPLETE_SET", "MULTI_OUTCOME_COMPLETE_SET", "WHALE_COPY"].map((strategy) => {
              const item = performanceByStrategy.get(strategy) ?? {};
              return <div key={strategy}><span>{label(strategy)}</span><strong>{money(item.realizedPnl)}</strong><small>{Number(item.appliedExecutions ?? 0)} applied / {Number(item.executions ?? 0)} attempts</small></div>;
            })}
          </div>
        </article>
      </section>

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>Execution ledger</p><h2>Recent paper executions</h2></div><span>{snapshot.executions?.length ?? 0}</span></div>
          {(snapshot.executions ?? []).length ? <div className="hosted-table-wrap"><table><thead><tr><th>Time</th><th>Strategy</th><th>Status</th><th>Capital</th><th>Cash delta</th><th>Realized</th></tr></thead><tbody>
            {snapshot.executions.map((item) => <tr key={item.id}><td>{time(item.executedAt)}</td><td>{label(item.strategy)}</td><td><span className={`execution-status execution-${String(item.status).toLowerCase()}`}>{item.status}</span></td><td>{money(item.capitalRequired)}</td><td>{money(item.cashDelta)}</td><td>{money(item.realizedPnl)}</td></tr>)}
          </tbody></table></div> : <div className="hosted-empty"><strong>No simulated executions</strong><p>The scanner is active, but it has not found an executable structural edge.</p></div>}
        </article>
        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Allocation</p><h2>Recent decisions</h2></div></div>
          <div className="decision-list">
            {(snapshot.decisions ?? []).slice(0, 14).map((item) => <div key={item.id} className={item.selected ? "accepted" : "rejected"}><div><strong>{item.selected ? "Selected" : "Rejected"}</strong><span>{label(item.strategy)} · {short(item.marketKey)}</span></div><small>{(item.reasons ?? []).join(" · ") || "No reason recorded"}</small><b>{item.selected ? money(item.allocatedCapital) : "—"}</b></div>)}
            {!(snapshot.decisions ?? []).length && <div className="hosted-empty"><strong>No allocator decisions</strong><p>No market survived the scanner far enough to reach Hero.</p></div>}
          </div>
        </article>
      </section>

      <section className="hosted-grid equal-grid">
        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Whale research</p><h2>Signals and rejection reasons</h2></div></div>
          <div className="decision-list">
            {(snapshot.signals ?? []).slice(0, 14).map((item) => <div key={item.id} className={item.decision === "COPY_CANDIDATE" ? "accepted" : "rejected"}><div><strong>{item.decision}</strong><span>{item.walletName || short(item.wallet)} · {item.category}</span></div><small>{item.title || item.outcome || short(item.conditionId)}{item.reasons?.length ? ` · ${item.reasons.join(" · ")}` : ""}</small><b>{money(item.estimatedCost)}</b></div>)}
            {!(snapshot.signals ?? []).length && <div className="hosted-empty"><strong>Whale monitor disabled</strong><p>The current worker is not checking any qualified wallets.</p></div>}
          </div>
        </article>
        <article className="hosted-panel desk-note">
          <div className="hosted-heading"><div><p>Desk purpose</p><h2>Prediction-market research</h2></div></div>
          <div className="note-copy"><p>This desk remains narrowly focused on complete-set pricing errors and conservative public-wallet research. It does not place real Polymarket orders.</p></div>
        </article>
      </section>
    </>
  );
}

function CryptoDesk({ cryptoDesk }) {
  const portfolio = cryptoDesk?.portfolio ?? EMPTY_PORTFOLIO;
  const positions = portfolio.positions ?? [];
  const signals = cryptoDesk?.signals ?? [];
  const executions = cryptoDesk?.executions ?? [];
  const health = cryptoDesk?.health ?? EMPTY.crypto.health;
  const equity = Number(portfolio.equity ?? (Number(portfolio.cash ?? 0) + Number(portfolio.openPositionValue ?? 0)));
  const returnPct = Number(portfolio.startingCash ?? 0) > 0
    ? (equity - Number(portfolio.startingCash)) / Number(portfolio.startingCash)
    : 0;
  const latestByProduct = useMemo(() => {
    const map = new Map();
    for (const signal of signals) if (!map.has(signal.productId)) map.set(signal.productId, signal);
    return [...map.values()];
  }, [signals]);
  const config = health.summary?.config ?? {};

  return (
    <>
      <MetricStrip items={[
        { label: "Crypto equity", value: money(equity), note: `${percent(returnPct)} total return` },
        { label: "Available cash", value: money(portfolio.cash), note: "Separate crypto paper balance" },
        { label: "Open exposure", value: money(portfolio.openPositionValue), note: `${positions.length} live positions` },
        { label: "Realized paper P&L", value: money(portfolio.realizedPnl), note: `${executions.length} recent trades`, tone: Number(portfolio.realizedPnl) >= 0 ? "gain" : "loss" }
      ]} />

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>24/7 market feed</p><h2>Latest model signals</h2></div><span>{latestByProduct.length}</span></div>
          {latestByProduct.length ? <div className="signal-cards">
            {latestByProduct.map((signal) => (
              <div key={signal.productId} className={`signal-card signal-${String(signal.action).toLowerCase()}`}>
                <div><strong>{signal.productId}</strong><span>{signal.action}</span></div>
                <b>{money(signal.price)}</b>
                <dl>
                  <div><dt>Score</dt><dd>{number(signal.score, 0)}</dd></div>
                  <div><dt>Fast / slow</dt><dd>{money(signal.metrics?.emaFast)} / {money(signal.metrics?.emaSlow)}</dd></div>
                  <div><dt>RSI</dt><dd>{number(signal.metrics?.rsi, 1)}</dd></div>
                  <div><dt>Momentum</dt><dd>{percent(signal.metrics?.momentum)}</dd></div>
                </dl>
                <small>{(signal.reasons ?? []).slice(0, 4).join(" · ") || "No explanation recorded"}</small>
              </div>
            ))}
          </div> : <div className="hosted-empty"><strong>Crypto worker not populated yet</strong><p>After the updated worker runs once, BTC, ETH, and SOL signals will appear here even when the action is HOLD.</p></div>}
        </article>
        <HealthPanel title="Crypto health" health={health} rows={[
          ["Products checked", Number(health.productsChecked ?? 0)],
          ["Signals", `${Number(health.buySignals ?? 0)} buy · ${Number(health.sellSignals ?? 0)} sell · ${Number(health.holdSignals ?? 0)} hold`]
        ]} />
      </section>

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>Portfolio</p><h2>Crypto positions</h2></div><span>{positions.length}</span></div>
          {positions.length ? <div className="hosted-table-wrap"><table><thead><tr><th>Asset</th><th>Units</th><th>Average cost</th><th>Last price</th><th>Market value</th><th>Unrealized</th></tr></thead><tbody>
            {positions.map((item) => {
              const unrealized = Number(item.marketValue ?? 0) - Number(item.units ?? 0) * Number(item.averageCost ?? 0);
              return <tr key={item.productId}><td><strong>{item.productId}</strong><small>Opened {time(item.openedAt)}</small></td><td>{number(item.units, 6)}</td><td>{money(item.averageCost)}</td><td>{money(item.lastPrice)}</td><td>{money(item.marketValue)}</td><td className={unrealized >= 0 ? "gain" : "loss"}>{money(unrealized)}</td></tr>;
            })}
          </tbody></table></div> : <div className="hosted-empty"><strong>No crypto positions</strong><p>The model has not produced a qualified entry, or it has already exited.</p></div>}
        </article>
        <article className="hosted-panel desk-note">
          <div className="hosted-heading"><div><p>Algorithm</p><h2>Trend + momentum</h2></div></div>
          <div className="note-copy">
            <p>The engine buys only when the fast trend, slow trend, momentum, RSI, volume, volatility, and breakout checks broadly agree.</p>
            <ul>
              <li>5-minute Coinbase candles</li>
              <li>{number(Number(config.positionPct ?? 0.2) * 100, 0)}% target size per entry</li>
              <li>{number(Number(config.maxExposurePct ?? 0.6) * 100, 0)}% maximum total exposure</li>
              <li>{number(config.feeBps ?? 60, 0)} bps fees + {number(config.slippageBps ?? 5, 0)} bps slippage</li>
              <li>Hard stop, trailing stop, take-profit, and trend-reversal exits</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="hosted-grid">
        <article className="hosted-panel wide">
          <div className="hosted-heading"><div><p>Trade ledger</p><h2>Recent crypto paper trades</h2></div><span>{executions.length}</span></div>
          {executions.length ? <div className="hosted-table-wrap"><table><thead><tr><th>Time</th><th>Asset</th><th>Side</th><th>Units</th><th>Fill</th><th>Notional</th><th>Fee</th><th>Realized</th></tr></thead><tbody>
            {executions.map((item) => <tr key={item.id}><td>{time(item.executedAt)}</td><td>{item.productId}</td><td><span className={`execution-status execution-${String(item.side).toLowerCase()}`}>{item.side}</span></td><td>{number(item.units, 6)}</td><td>{money(item.fillPrice)}</td><td>{money(item.notional)}</td><td>{money(item.fee)}</td><td className={Number(item.realizedPnl) >= 0 ? "gain" : "loss"}>{money(item.realizedPnl)}</td></tr>)}
          </tbody></table></div> : <div className="hosted-empty"><strong>No crypto trades yet</strong><p>Unlike the Polymarket desk, every HOLD signal is still logged above so you can see that the engine is alive.</p></div>}
        </article>
        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Signal history</p><h2>Recent decisions</h2></div></div>
          <div className="decision-list">
            {signals.slice(0, 18).map((signal) => <div key={signal.id} className={signal.action === "BUY" ? "accepted" : signal.action === "SELL" ? "exit" : "neutral-decision"}><div><strong>{signal.action}</strong><span>{signal.productId} · score {number(signal.score, 0)}</span></div><small>{(signal.reasons ?? []).join(" · ")}</small><b>{money(signal.price)}</b></div>)}
            {!signals.length && <div className="hosted-empty"><strong>No decisions recorded</strong><p>The updated worker has not completed its first crypto cycle.</p></div>}
          </div>
        </article>
      </section>
    </>
  );
}

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [activeDesk, setActiveDesk] = useState("crypto");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/hosted?limit=50", { cache: "no-store" });
      const payload = await response.json();
      setSnapshot(payload);
      setError(payload.error ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashboard refresh failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const polymarketHealth = snapshot.health ?? EMPTY.health;
  const cryptoHealth = snapshot.crypto?.health ?? EMPTY.crypto.health;
  const overallStatus = worstStatus(statusOf(polymarketHealth), statusOf(cryptoHealth));
  const activeHealth = activeDesk === "crypto" ? cryptoHealth : polymarketHealth;
  const activeSummary = activeDesk === "crypto"
    ? `${Number(activeHealth.productsChecked ?? 0)} products checked · ${Number(activeHealth.executions ?? 0)} trades`
    : `${Number(activeHealth.opportunities ?? 0)} found · ${Number(activeHealth.selected ?? 0)} selected · ${Number(activeHealth.executions ?? 0)} simulated`;

  return (
    <main className="hosted-shell">
      <header className="hosted-topbar">
        <a href="#top" className="hosted-brand"><span>MM</span><div><strong>MoneyMog</strong><small>two paper-trading desks</small></div></a>
        <div className={`hosted-status status-${overallStatus.toLowerCase()}`}><i />{overallStatus}</div>
      </header>

      <nav className="desk-tabs" aria-label="MoneyMog desks">
        <button className={activeDesk === "crypto" ? "active" : ""} onClick={() => setActiveDesk("crypto")}><span>24/7</span>Crypto trading</button>
        <button className={activeDesk === "polymarket" ? "active" : ""} onClick={() => setActiveDesk("polymarket")}><span>Prediction markets</span>Polymarket</button>
      </nav>

      <section className="hosted-hero compact-hero" id="top">
        <div>
          <p className="hosted-kicker">{activeDesk === "crypto" ? "Continuous crypto paper desk" : "Prediction-market paper desk"}</p>
          <h1>{activeDesk === "crypto" ? <>Trade the market.<br />Not the noise.</> : <>Structural edge.<br />No forced trades.</>}</h1>
          <p>{activeDesk === "crypto"
            ? "A separate 24/7 portfolio for BTC, ETH, and SOL. The model combines trend, momentum, volume, volatility, and explicit risk exits before simulating any trade."
            : "The original Polymarket research engine remains isolated in its own section, with scan counts and rejection reasons now visible even when it finds no trade."}</p>
        </div>
        <div className="hosted-run-card">
          <span>Last {activeDesk === "crypto" ? "crypto" : "Polymarket"} cycle</span>
          <strong>{time(activeHealth.finishedAt ?? activeHealth.startedAt)}</strong>
          <small>{activeHealth.simulationEnabled ? activeSummary : "Paper simulation is paused"}</small>
          <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh shared state"}</button>
        </div>
      </section>

      {error && <div className="hosted-alert">Worker connection is degraded: {error}</div>}
      {!snapshot.configured && <div className="hosted-alert neutral">Cloudflare is not connected yet. Add the Worker URL and API token in Vercel to load both desks.</div>}
      {snapshot.configured && !snapshot.crypto && <div className="hosted-alert neutral">The Vercel dashboard has updated, but the Cloudflare Worker still needs the crypto deployment.</div>}

      {activeDesk === "crypto"
        ? <CryptoDesk cryptoDesk={snapshot.crypto} />
        : <PolymarketDesk snapshot={snapshot} />}

      <footer className="hosted-footer">Paper-only research. No exchange keys, wallet keys, signing code, or real order submission exist in either desk.</footer>
    </main>
  );
}
