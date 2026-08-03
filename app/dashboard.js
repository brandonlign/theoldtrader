"use client";

import { useMemo, useState } from "react";

const DEFAULT_SETTINGS = {
  maxMarkets: 120,
  maxShares: 1000,
  minNetProfitUsd: 0.05,
  minRoiBps: 5,
  safetyBufferBps: 10
};

function money(value, digits = 2) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(number) ? number : 0);
}

function number(value, digits = 2) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) : "0";
}

function timeLabel(value) {
  if (!value) return "Not scanned";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function directionLabel(direction) {
  return direction === "BUY_AND_MERGE" ? "Buy both → merge" : "Split → sell both";
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

  const opportunities = result?.opportunities ?? [];
  const totalEdge = useMemo(
    () => opportunities.reduce((sum, item) => sum + Number(item.netProfit ?? 0), 0),
    [opportunities]
  );

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
        <div className="mode-pill"><span /> Paper mode · paused</div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Structural arbitrage monitor</p>
          <h1>Find the gap.<br />Risk nothing yet.</h1>
          <p className="hero-copy">
            Scan Polymarket order books for complete-set pricing errors. Review the
            executable edge before a single simulated dollar moves.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={runScan} disabled={scanning}>
            {scanning ? "Scanning markets…" : "Run market scan"}
          </button>
          <button className="text-button" onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? "Close settings" : "Scan settings"}
          </button>
          <p>Read-only. No paper trades or real orders are placed.</p>
        </div>
      </section>

      {showSettings && (
        <section className="settings-sheet" aria-label="Scan settings">
          <label>
            <span>Markets checked</span>
            <input type="number" min="25" max="250" value={settings.maxMarkets}
              onChange={(event) => updateSetting("maxMarkets", event.target.value)} />
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
          <small>{result ? `${result.marketsDiscovered} markets reviewed` : "Awaiting first scan"}</small>
        </article>
        <article className="metric-card">
          <span>Modeled net edge</span>
          <strong>{money(totalEdge)}</strong>
          <small>Across the current scan only</small>
        </article>
        <article className="metric-card">
          <span>Last scan</span>
          <strong className="metric-time">{timeLabel(result?.scannedAt)}</strong>
          <small>{scanning ? "Working…" : "Manual scans only"}</small>
        </article>
      </section>

      <section className="desk-grid">
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
                        <span>{item.slug || item.conditionId}</span>
                      </td>
                      <td><span className="route-tag">{directionLabel(item.direction)}</span></td>
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
            <div className="strategy-title"><StrategyMark /><span>Active strategy</span></div>
            <h2>Complete-set arbitrage</h2>
            <p>Buy YES + NO below $1, or split $1 and sell both above $1, after fees and depth.</p>
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
                <li><span>markets with books</span><strong>{result.marketsWithBooks}</strong></li>
              </ul>
            ) : (
              <p className="muted-copy">Filter counts will appear after the first scan.</p>
            )}
          </article>
        </aside>
      </section>

      <footer>
        <span>MoneyMog / paper desk</span>
        <span>Read-only structural-arbitrage research</span>
      </footer>
    </main>
  );
}
