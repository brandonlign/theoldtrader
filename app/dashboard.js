"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_SETTINGS = {
  maxMarkets: 120,
  maxMultiOutcomeEvents: 30,
  maxShares: 1000,
  minNetProfitUsd: 0.05,
  minRoiBps: 5,
  safetyBufferBps: 10
};

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
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) : "0";
}

function percent(value, digits = 1) {
  return `${number(Number(value ?? 0) * 100, digits)}%`;
}

function timeLabel(value) {
  if (!value) return "Not scanned";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function directionLabel(item) {
  if (item.routeLabel) return item.routeLabel;
  if (item.direction === "BUY_ALL_YES") return "Buy every outcome";
  return item.direction === "BUY_AND_MERGE" ? "Buy both → merge" : "Split → sell both";
}

function strategyLabel(item) {
  return item.strategy === "MULTI_OUTCOME_COMPLETE_SET" ? `${item.outcomeCount} outcomes` : "Binary set";
}

function shortenWallet(wallet) {
  if (!wallet) return "Unknown";
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function StrategyMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="strategy-mark">
      <path d="M6 8.5h20M6 16h20M6 23.5h12" />
      <circle cx="24" cy="23.5" r="2.5" />
    </svg>
  );
}

export default function Dashboard() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [whaleRanking, setWhaleRanking] = useState(null);
  const [rankingWhales, setRankingWhales] = useState(false);
  const [whaleError, setWhaleError] = useState("");
  const [workerStatus, setWorkerStatus] = useState({ configured: false, enabled: false });
  const [whaleSignals, setWhaleSignals] = useState([]);

  const opportunities = result?.opportunities ?? [];
  const rankedWallets = whaleRanking?.recommended ?? [];
  const totalEdge = useMemo(
    () => opportunities.reduce((sum, item) => sum + Number(item.netProfit ?? 0), 0),
    [opportunities]
  );
  const healthLabel = workerStatus.health?.status
    ? workerStatus.health.status.toLowerCase()
    : workerStatus.enabled
      ? "observing"
      : "paused";

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/whales/status", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/whales/signals?limit=8", { cache: "no-store" }).then((response) => response.json())
    ]).then(([status, signals]) => {
      if (cancelled) return;
      setWorkerStatus(status);
      setWhaleSignals(signals.signals ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function runScan() {
    setScanning(true);
    setError("");
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The scan failed.");
      setResult(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "The scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function rankPublicWallets() {
    setRankingWhales(true);
    setWhaleError("");
    try {
      const response = await fetch("/api/whales/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendedCount: 10 })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Wallet ranking failed.");
      setWhaleRanking(payload);
    } catch (rankingError) {
      setWhaleError(rankingError instanceof Error ? rankingError.message : "Wallet ranking failed.");
    } finally {
      setRankingWhales(false);
    }
  }

  function updateSetting(name, value) {
    setSettings((current) => ({ ...current, [name]: value }));
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MoneyMog home">
          <span className="brand-stamp">MM</span>
          <span>
            <strong>MoneyMog</strong>
            <small>paper trading desk</small>
          </span>
        </a>
        <nav className="desk-nav" aria-label="Dashboard sections">
          <a href="#arbitrage">Arbitrage</a>
          <a href="#whales">Whales</a>
        </nav>
        <div className="mode-pill"><span /> Paper mode · paused</div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Prediction-market research desk</p>
          <h1>Find the gap.<br />Follow the signal.</h1>
          <p className="hero-copy">
            Scan binary and multi-outcome complete sets, then rank consistently skilled public wallets.
            Everything remains read-only until the paper simulation is deliberately enabled.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={runScan} disabled={scanning}>
            {scanning ? "Scanning markets…" : "Run market scan"}
          </button>
          <button className="text-button" onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? "Close settings" : "Scan settings"}
          </button>
          <p>No wallet, private key, simulated fill, or real order is active.</p>
        </div>
      </section>

      {showSettings && (
        <section className="settings-sheet" aria-label="Scan settings">
          <label>
            <span>Binary markets</span>
            <input type="number" min="25" max="250" value={settings.maxMarkets}
              onChange={(event) => updateSetting("maxMarkets", event.target.value)} />
          </label>
          <label>
            <span>Multi-outcome events</span>
            <input type="number" min="1" max="60" value={settings.maxMultiOutcomeEvents}
              onChange={(event) => updateSetting("maxMultiOutcomeEvents", event.target.value)} />
          </label>
          <label>
            <span>Maximum shares</span>
            <input type="number" min="1" step="1" value={settings.maxShares}
              onChange={(event) => updateSetting("maxShares", event.target.value)} />
          </label>
          <label>
            <span>Minimum net profit</span>
            <div className="input-prefix"><i>$</i><input type="number" min="0" step="0.01" value={settings.minNetProfitUsd}
              onChange={(event) => updateSetting("minNetProfitUsd", event.target.value)} /></div>
          </label>
          <label>
            <span>Minimum ROI</span>
            <div className="input-suffix"><input type="number" min="0" step="1" value={settings.minRoiBps}
              onChange={(event) => updateSetting("minRoiBps", event.target.value)} /><i>bps</i></div>
          </label>
          <label>
            <span>Safety buffer</span>
            <div className="input-suffix"><input type="number" min="0" step="1" value={settings.safetyBufferBps}
              onChange={(event) => updateSetting("safetyBufferBps", event.target.value)} /><i>bps</i></div>
          </label>
        </section>
      )}

      {error && <div className="error-note" role="alert">{error}</div>}

      <section className="metric-grid" aria-label="Paper account overview">
        <article className="metric-card">
          <span>Paper balance</span>
          <strong>{money(10000)}</strong>
          <small>Simulation not started</small>
        </article>
        <article className="metric-card">
          <span>Qualified gaps</span>
          <strong>{opportunities.length}</strong>
          <small>{result
            ? `${result.binaryMarketsDiscovered ?? 0} binary · ${result.multiOutcomeEventsDiscovered ?? 0} events`
            : "Awaiting first scan"}</small>
        </article>
        <article className="metric-card">
          <span>Ranked whales</span>
          <strong>{rankedWallets.length}</strong>
          <small>{whaleRanking ? `${whaleRanking.candidatesEvaluated} candidates tested` : "Not ranked yet"}</small>
        </article>
        <article className="metric-card">
          <span>Monitor health</span>
          <strong className="metric-time">{healthLabel}</strong>
          <small>{workerStatus.configured ? `${workerStatus.configuredWallets ?? 0} wallets configured` : "Free worker not connected"}</small>
        </article>
      </section>

      <section className="desk-grid" id="arbitrage">
        <article className="ledger-card opportunity-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Opportunity ledger</p>
              <h2>Executable complete sets</h2>
            </div>
            <span className="count-stamp">{opportunities.length} found</span>
          </div>

          {opportunities.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Route</th>
                    <th>Size</th>
                    <th>Net edge</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.question}</strong>
                        <span>{strategyLabel(item)} · {item.slug || item.conditionId}</span>
                      </td>
                      <td><span className="route-tag">{directionLabel(item)}</span></td>
                      <td>{number(item.shares, 0)}</td>
                      <td className="positive">{money(item.netProfit, 3)}</td>
                      <td>{number(Number(item.roiBps) / 100, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-ledger">
              <div className="empty-lines" aria-hidden="true"><span /><span /><span /></div>
              <h3>{result ? "No qualified gaps in this scan" : "Your ledger is blank"}</h3>
              <p>{result
                ? "The books checked did not clear your fee, depth, ROI, and safety thresholds."
                : "Run a read-only market scan to populate opportunities. The simulation stays paused."}</p>
            </div>
          )}
        </article>

        <aside className="side-stack">
          <article className="ledger-card strategy-card">
            <div className="strategy-title"><StrategyMark /><span>Research engines</span></div>
            <h2>Three independent edges</h2>
            <p>Binary complete sets, stable multi-outcome sets, and skill-weighted whale signals are tested separately.</p>
            <dl>
              <div><dt>Execution</dt><dd>Disabled</dd></div>
              <div><dt>Wallet</dt><dd>Not connected</dd></div>
              <div><dt>Simulation</dt><dd>Paused</dd></div>
            </dl>
          </article>

          <article className="ledger-card audit-card">
            <p className="eyebrow">Scan audit</p>
            <h2>What was filtered</h2>
            {result ? (
              <ul>
                {Object.entries(result.skipped ?? {}).map(([reason, count]) => (
                  <li key={reason}><span>{reason.replaceAll("-", " ")}</span><strong>{count}</strong></li>
                ))}
                <li><span>binary books loaded</span><strong>{result.marketsWithBooks}</strong></li>
                <li><span>stable events validated</span><strong>{result.multiOutcomeEventsValidated ?? 0}</strong></li>
              </ul>
            ) : (
              <p className="muted-copy">Filter counts will appear after the first scan.</p>
            )}
          </article>
        </aside>
      </section>

      <section className="whale-desk" id="whales">
        <article className="ledger-card whale-rank-card">
          <div className="section-heading whale-heading">
            <div>
              <p className="eyebrow">Whale watch</p>
              <h2>Skill-weighted public wallets</h2>
            </div>
            <button className="ink-button" onClick={rankPublicWallets} disabled={rankingWhales}>
              {rankingWhales ? "Testing histories…" : "Rank public wallets"}
            </button>
          </div>

          {whaleError && <div className="inline-error" role="alert">{whaleError}</div>}

          {rankedWallets.length > 0 ? (
            <div className="table-wrap">
              <table className="whale-table">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Score</th>
                    <th>Resolved</th>
                    <th>Historical ROI</th>
                    <th>Forward ROI</th>
                    <th>Specialties</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedWallets.map((wallet) => {
                    const forward = wallet.walkForward?.OVERALL;
                    return (
                      <tr key={wallet.wallet}>
                        <td>
                          <strong>{wallet.userName || shortenWallet(wallet.wallet)}</strong>
                          <span>{shortenWallet(wallet.wallet)}</span>
                        </td>
                        <td><span className="score-stamp">{number(wallet.score, 0)}</span></td>
                        <td>{number(wallet.sampleSize, 0)}</td>
                        <td className={wallet.roi > 0 ? "positive" : ""}>{percent(wallet.roi)}</td>
                        <td className={forward?.forwardRoi > 0 ? "positive" : ""}>{forward ? percent(forward.forwardRoi) : "—"}</td>
                        <td><span className="category-line">{(wallet.categories ?? []).join(" · ") || "Overall"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-ledger whale-empty">
              <div className="empty-lines" aria-hidden="true"><span /><span /><span /></div>
              <h3>No wallets selected yet</h3>
              <p>MoneyMog tests whether a wallet kept winning after it would historically have qualified, rather than trusting a leaderboard snapshot.</p>
            </div>
          )}
        </article>

        <aside className="side-stack whale-side">
          <article className="ledger-card strategy-card">
            <p className="eyebrow">Free monitor</p>
            <h2>{workerStatus.configured ? healthLabel : "Not connected yet"}</h2>
            <p>
              The repository includes a free Cloudflare Worker + D1 monitor. It records coverage, API errors, source lag, runtime, and persistent-state health.
            </p>
            <dl>
              <div><dt>Hosting</dt><dd>Cloudflare free</dd></div>
              <div><dt>Simulation</dt><dd>Paused</dd></div>
              <div><dt>Real money</dt><dd>Unavailable</dd></div>
            </dl>
          </article>

          <article className="ledger-card signal-card">
            <p className="eyebrow">Recent observations</p>
            <h2>Copy decisions</h2>
            {whaleSignals.length > 0 ? (
              <ul className="signal-list">
                {whaleSignals.slice(0, 6).map((signal) => (
                  <li key={signal.id}>
                    <div>
                      <strong>{signal.title || signal.slug || "Market signal"}</strong>
                      <span>{signal.walletName || shortenWallet(signal.wallet)} · {signal.outcome}</span>
                    </div>
                    <em className={signal.decision === "COPY_CANDIDATE" ? "candidate" : "rejected"}>
                      {signal.decision === "COPY_CANDIDATE" ? "candidate" : "rejected"}
                    </em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No monitoring has started, so there are no copied or rejected signals.</p>
            )}
          </article>
        </aside>
      </section>

      <footer>
        <span>MoneyMog / paper desk</span>
        <span>Read-only research · simulation paused</span>
      </footer>
    </main>
  );
}
