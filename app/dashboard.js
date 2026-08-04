"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function money(value, digits = 2) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(Number.isFinite(parsed) ? parsed : 0);
}
function number(value, digits = 2) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "0";
}
function time(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
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

const EMPTY = {
  configured: false,
  portfolio: { startingCash: 10000, cash: 10000, realizedPnl: 0, positions: [], openPositionValue: 0 },
  executions: [], opportunities: [], decisions: [], signals: [], performance: [],
  health: { status: "PAUSED", simulationEnabled: false }
};

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/hosted?limit=40", { cache: "no-store" });
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

  const portfolio = snapshot.portfolio ?? EMPTY.portfolio;
  const positions = portfolio.positions ?? [];
  const health = snapshot.health ?? EMPTY.health;
  const status = String(health.health ?? health.status ?? "PAUSED").toUpperCase();
  const selected = (snapshot.decisions ?? []).filter((item) => item.selected);
  const rejected = (snapshot.decisions ?? []).filter((item) => !item.selected);
  const totalEquity = Number(portfolio.cash ?? 0) + Number(portfolio.openPositionValue ?? 0);
  const returnPct = Number(portfolio.startingCash ?? 0) > 0
    ? ((totalEquity + Number(portfolio.realizedPnl ?? 0) - Number(portfolio.startingCash)) / Number(portfolio.startingCash)) * 100
    : 0;
  const performanceByStrategy = useMemo(() => new Map((snapshot.performance ?? []).map((item) => [item.strategy, item])), [snapshot.performance]);

  return (
    <main className="hosted-shell">
      <header className="hosted-topbar">
        <a href="#top" className="hosted-brand"><span>MM</span><div><strong>MoneyMog</strong><small>hosted paper desk</small></div></a>
        <div className={`hosted-status status-${status.toLowerCase()}`}><i />{status}</div>
      </header>

      <section className="hosted-hero" id="top">
        <div>
          <p className="hosted-kicker">Shared Cloudflare paper portfolio</p>
          <h1>Structural edge first.<br />Directional risk last.</h1>
          <p>One conservative paper account across binary arbitrage, stable multi-outcome arbitrage, and qualified whale-copy research. The dashboard reads the same D1 state the Worker updates.</p>
        </div>
        <div className="hosted-run-card">
          <span>Last Worker cycle</span>
          <strong>{time(health.finishedAt ?? health.startedAt)}</strong>
          <small>{health.simulationEnabled ? `${health.opportunities ?? 0} found · ${health.selected ?? 0} selected · ${health.executions ?? 0} simulated` : "Paper simulation is explicitly paused"}</small>
          <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh shared state"}</button>
        </div>
      </section>

      {error && <div className="hosted-alert">Worker connection is degraded: {error}</div>}
      {!snapshot.configured && <div className="hosted-alert neutral">Cloudflare is not connected yet. The dashboard will show the shared portfolio after the Worker URL and API token are added in Vercel.</div>}

      <section className="hosted-metrics">
        <article><span>Paper balance</span><strong>{money(portfolio.cash)}</strong><small>Shared D1 cash</small></article>
        <article><span>Realized paper P&amp;L</span><strong className={Number(portfolio.realizedPnl) >= 0 ? "gain" : "loss"}>{money(portfolio.realizedPnl)}</strong><small>{number(returnPct, 2)}% account return</small></article>
        <article><span>Open exposure</span><strong>{money(portfolio.openPositionValue)}</strong><small>{positions.length} positions</small></article>
        <article><span>Hero selections</span><strong>{selected.length}</strong><small>{rejected.length} recent rejections</small></article>
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
          </tbody></table></div> : <div className="hosted-empty"><strong>No simulated executions</strong><p>Enable the Worker only after the D1 schema and secrets are configured.</p></div>}
        </article>

        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Worker</p><h2>Health</h2></div><span className={`health-word status-${status.toLowerCase()}`}>{status}</span></div>
          <dl className="health-list">
            <div><dt>Simulation</dt><dd>{health.simulationEnabled ? "Active" : "Paused"}</dd></div>
            <div><dt>Run ID</dt><dd>{short(health.runId) || "None"}</dd></div>
            <div><dt>Errors</dt><dd>{Number(health.errorCount ?? 0)}</dd></div>
            <div><dt>Last started</dt><dd>{time(health.startedAt)}</dd></div>
          </dl>
        </article>
      </section>

      <section className="hosted-grid">
        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Hero allocator</p><h2>Recent decisions</h2></div></div>
          <div className="decision-list">
            {(snapshot.decisions ?? []).slice(0, 14).map((item) => <div key={item.id} className={item.selected ? "accepted" : "rejected"}><div><strong>{item.selected ? "Selected" : "Rejected"}</strong><span>{label(item.strategy)} · {short(item.marketKey)}</span></div><small>{(item.reasons ?? []).join(" · ") || "No reason recorded"}</small><b>{item.selected ? money(item.allocatedCapital) : "—"}</b></div>)}
            {!(snapshot.decisions ?? []).length && <div className="hosted-empty"><strong>No allocator decisions</strong><p>Every detected opportunity will be recorded here, including rejections.</p></div>}
          </div>
        </article>

        <article className="hosted-panel">
          <div className="hosted-heading"><div><p>Whale research</p><h2>Signals and rejection reasons</h2></div></div>
          <div className="decision-list">
            {(snapshot.signals ?? []).slice(0, 14).map((item) => <div key={item.id} className={item.decision === "COPY_CANDIDATE" ? "accepted" : "rejected"}><div><strong>{item.decision}</strong><span>{item.walletName || short(item.wallet)} · {item.category}</span></div><small>{item.title || item.outcome || short(item.conditionId)}{item.reasons?.length ? ` · ${item.reasons.join(" · ")}` : ""}</small><b>{money(item.estimatedCost)}</b></div>)}
            {!(snapshot.signals ?? []).length && <div className="hosted-empty"><strong>No whale signals</strong><p>Wallet batches are deliberately small and only new public trades are evaluated.</p></div>}
          </div>
        </article>
      </section>

      <footer className="hosted-footer">Paper-only research. No wallet keys, signing code, or real order submission exist in this system.</footer>
    </main>
  );
}
