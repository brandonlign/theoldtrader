"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./crypto-analytics.module.css";

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(finite(value));
}

function percent(value) {
  return `${(finite(value) * 100).toFixed(1)}%`;
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function lineGeometry(points, width = 760, height = 220, pad = 18) {
  if (!points.length) return { path: "", min: 0, max: 0, zeroY: height / 2 };
  const values = points.map((item) => finite(item.value));
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (Math.abs(max - min) < 1e-9) {
    min -= 1;
    max += 1;
  }
  const x = (index) => pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (value) => pad + ((max - value) / (max - min)) * (height - pad * 2);
  const path = points.map((item, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(item.value).toFixed(2)}`).join(" ");
  return { path, min, max, zeroY: y(0) };
}

function realizedPath(executions) {
  const sells = [...executions]
    .filter((item) => item.side === "SELL")
    .sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));
  let cumulative = 0;
  return sells.map((item) => {
    cumulative += finite(item.realizedPnl);
    return { label: shortDate(item.executedAt), value: cumulative };
  });
}

function equityPath(crypto) {
  const history = crypto?.history ?? [];
  if (history.length >= 2) {
    const startingCash = finite(crypto?.portfolio?.startingCash, 10_000);
    return history.map((item) => ({
      label: shortDate(item.finishedAt ?? item.startedAt),
      value: finite(item.equity) - startingCash
    }));
  }
  return realizedPath(crypto?.executions ?? []);
}

function PnlLineChart({ points }) {
  const geometry = lineGeometry(points);
  const latest = points.at(-1)?.value ?? 0;
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeading}>
        <div><span>Net performance</span><strong>Cumulative crypto P&amp;L</strong></div>
        <b className={latest >= 0 ? styles.positive : styles.negative}>{money(latest)}</b>
      </div>
      {points.length ? (
        <>
          <svg className={styles.lineChart} viewBox="0 0 760 220" role="img" aria-label="Cumulative crypto paper trading profit and loss">
            <line x1="18" x2="742" y1={geometry.zeroY} y2={geometry.zeroY} className={styles.zeroLine} />
            <path d={geometry.path} className={latest >= 0 ? styles.linePositive : styles.lineNegative} />
          </svg>
          <div className={styles.axisRow}><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
        </>
      ) : <div className={styles.empty}>No closed crypto trades yet.</div>}
    </div>
  );
}

function TradeBars({ executions }) {
  const trades = executions.filter((item) => item.side === "SELL").slice(0, 14).reverse();
  const maxAbs = Math.max(1, ...trades.map((item) => Math.abs(finite(item.realizedPnl))));
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeading}>
        <div><span>Closed trades</span><strong>Per-trade realized P&amp;L</strong></div>
        <b>{trades.length}</b>
      </div>
      {trades.length ? <div className={styles.barPlot}>
        <div className={styles.barZero} />
        {trades.map((trade) => {
          const pnl = finite(trade.realizedPnl);
          const height = Math.max(4, Math.abs(pnl) / maxAbs * 86);
          return <div className={styles.barColumn} key={trade.id} title={`${trade.productId}: ${money(pnl)}`}>
            <span className={pnl >= 0 ? styles.barUp : styles.barDown} style={{ height: `${height}px` }} />
            <small>{trade.productId.replace("-USD", "")}</small>
          </div>;
        })}
      </div> : <div className={styles.empty}>No realized trades to plot.</div>}
    </div>
  );
}

function FeeDrag({ executions, performance }) {
  const realized = finite(performance?.realizedPnl);
  const fees = finite(performance?.totalFees, executions.reduce((sum, item) => sum + finite(item.fee), 0));
  const denominator = Math.max(1, Math.abs(realized) + fees);
  const feeShare = Math.min(1, fees / denominator);
  return (
    <div className={styles.feeCard}>
      <div className={styles.chartHeading}>
        <div><span>Friction</span><strong>Fee drag</strong></div>
        <b>{money(fees)}</b>
      </div>
      <div className={styles.feeTrack}>
        <span style={{ width: `${feeShare * 100}%` }} />
      </div>
      <div className={styles.feeLegend}><span>Recorded fees</span><span>{(feeShare * 100).toFixed(0)}% of fees + |realized P&amp;L|</span></div>
      <p>The new strategy blocks entries whose directional edge is too small relative to this modeled round-trip friction.</p>
    </div>
  );
}

export default function CryptoAnalytics() {
  const [crypto, setCrypto] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/hosted?limit=100", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled) {
          setCrypto(payload.crypto ?? null);
          setError(payload.error ?? "");
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Analytics refresh failed");
      }
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const points = useMemo(() => equityPath(crypto), [crypto]);
  const performance = crypto?.performance ?? {};
  const closedTrades = finite(performance.closedTrades);
  const winRate = finite(performance.winRate);

  return (
    <section className={styles.shell} aria-label="Crypto analytics">
      <div className={styles.header}>
        <div><span>MoneyMog crypto analytics</span><h2>See exactly where the strategy makes or loses money.</h2></div>
        <div className={styles.metrics}>
          <article><span>Win rate</span><strong>{percent(winRate)}</strong><small>{closedTrades} closed trades</small></article>
          <article><span>Average close</span><strong>{money(performance.averageClosedPnl)}</strong><small>Net of modeled fees</small></article>
          <article><span>Best / worst</span><strong>{money(performance.bestTrade)}</strong><small>{money(performance.worstTrade)}</small></article>
        </div>
      </div>
      {error && <div className={styles.error}>Analytics feed degraded: {error}</div>}
      <div className={styles.grid}>
        <PnlLineChart points={points} />
        <TradeBars executions={crypto?.executions ?? []} />
        <FeeDrag executions={crypto?.executions ?? []} performance={performance} />
      </div>
    </section>
  );
}
