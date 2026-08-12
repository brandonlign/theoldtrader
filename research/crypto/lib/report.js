import fs from 'node:fs';
import path from 'node:path';
import { drawdownSeries, rollingSharpe } from './core.js';

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function fmtPct(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : Number(value).toFixed(digits);
}

function fmtUsd(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `$${Number(value).toFixed(2)}`;
}

function normalizeSeries(series) {
  const base = series[0]?.value ?? 1;
  return series.map((point) => ({ ...point, value: base > 0 ? point.value / base : 1 }));
}

function lineChart(title, seriesByName, { percent = false, zeroLine = false } = {}) {
  const width = 1100;
  const height = 560;
  const margin = { left: 80, right: 30, top: 55, bottom: 70 };
  const all = Object.values(seriesByName).flat();
  if (!all.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="560"></svg>';
  const minT = Math.min(...all.map((p) => p.time));
  const maxT = Math.max(...all.map((p) => p.time));
  let minV = Math.min(...all.map((p) => p.value));
  let maxV = Math.max(...all.map((p) => p.value));
  if (zeroLine) { minV = Math.min(minV, 0); maxV = Math.max(maxV, 0); }
  if (Math.abs(maxV - minV) < 1e-9) { minV -= 0.5; maxV += 0.5; }
  const x = (t) => margin.left + ((t - minT) / Math.max(1, maxT - minT)) * (width - margin.left - margin.right);
  const y = (v) => margin.top + (1 - (v - minV) / (maxV - minV)) * (height - margin.top - margin.bottom);
  const palette = ['#111827', '#2563eb', '#059669', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];
  const lines = Object.entries(seriesByName).map(([name, points], idx) => {
    const d = points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.time).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${palette[idx % palette.length]}" stroke-width="2"/><text x="${margin.left + (idx % 3) * 300}" y="${height - 30 - Math.floor(idx / 3) * 20}" font-size="14" fill="${palette[idx % palette.length]}">${esc(name)}</text>`;
  }).join('\n');
  const ticks = Array.from({ length: 6 }, (_, i) => minV + (maxV - minV) * i / 5).map((v) => {
    const yy = y(v);
    const label = percent ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);
    return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"/><text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" font-size="12">${label}</text>`;
  }).join('\n');
  const zero = zeroLine && minV <= 0 && maxV >= 0 ? `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}" stroke="#6b7280" stroke-dasharray="5 5"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="white"/>
<text x="${margin.left}" y="32" font-size="22" font-family="system-ui,sans-serif" font-weight="700">${esc(title)}</text>
<g font-family="system-ui,sans-serif">${ticks}${zero}${lines}</g>
</svg>`;
}

function barChart(title, values, { percent = false } = {}) {
  const width = 1000, height = 520, left = 90, right = 30, top = 60, bottom = 100;
  const entries = Object.entries(values);
  const maxAbs = Math.max(1e-9, ...entries.map(([, v]) => Math.abs(v)));
  const half = (height - top - bottom) / 2;
  const zeroY = top + half;
  const barW = Math.max(20, (width - left - right) / Math.max(1, entries.length) * 0.62);
  const step = (width - left - right) / Math.max(1, entries.length);
  const bars = entries.map(([name, value], idx) => {
    const h = Math.abs(value) / maxAbs * (half - 20);
    const x = left + idx * step + (step - barW) / 2;
    const y = value >= 0 ? zeroY - h : zeroY;
    const label = percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="#374151"/><text x="${x + barW / 2}" y="${value >= 0 ? y - 8 : y + h + 16}" text-anchor="middle" font-size="12">${label}</text><text transform="translate(${x + barW / 2},${height - bottom + 22}) rotate(35)" text-anchor="start" font-size="12">${esc(name)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="${left}" y="32" font-size="22" font-family="system-ui,sans-serif" font-weight="700">${esc(title)}</text><line x1="${left}" x2="${width - right}" y1="${zeroY}" y2="${zeroY}" stroke="#6b7280"/><g font-family="system-ui,sans-serif">${bars}</g></svg>`;
}

export function writeReports(outDir, bundle) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(bundle.summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'predictions.json'), JSON.stringify(bundle.predictionDiagnostics, null, 2));

  const metricHeader = ['strategy','netReturn','annualizedReturn','sharpe','sortino','maxDrawdown','calmar','winRate','profitFactor','expectancyPerTrade','turnover','turnoverToAverageEquity','totalFees','feeDrag','averageExposure','closedTrades','orderCount'];
  const metricRows = Object.entries(bundle.summary.finalHoldout.strategies).map(([name, m]) => metricHeader.map((key) => key === 'strategy' ? name : (m[key] ?? '')).join(','));
  fs.writeFileSync(path.join(outDir, 'final-holdout-metrics.csv'), [metricHeader.join(','), ...metricRows].join('\n'));

  const foldRows = ['fold,start,end,candidateSharpe,candidateNetReturn,v2Sharpe,v2NetReturn'];
  bundle.summary.developmentFolds.forEach((fold, index) => foldRows.push([
    index + 1, fold.start, fold.end, fold.candidate.sharpe, fold.candidate.netReturn, fold.v2.sharpe, fold.v2.netReturn
  ].join(',')));
  fs.writeFileSync(path.join(outDir, 'development-folds.csv'), foldRows.join('\n'));

  const regimeRows = ['strategy,regime,days,netReturn,sharpe,positiveDayRate'];
  for (const [strategy, regimes] of Object.entries(bundle.summary.finalHoldout.regimes)) {
    for (const [regime, values] of Object.entries(regimes)) regimeRows.push([strategy, regime, values.days, values.netReturn, values.sharpe, values.positiveDayRate].join(','));
  }
  fs.writeFileSync(path.join(outDir, 'regime-performance.csv'), regimeRows.join('\n'));

  const equity = {};
  const drawdowns = {};
  const roll = {};
  const turnover = {};
  for (const [name, state] of Object.entries(bundle.states)) {
    equity[name] = normalizeSeries(state.equitySeries);
    drawdowns[name] = drawdownSeries(state.equitySeries);
    if (['ridge24_cost_gate', 'frozen_v2', 'trend30'].includes(name)) roll[name] = rollingSharpe(state.equitySeries, 30);
    turnover[name] = state.turnoverSeries.map((p) => ({ time: p.time, value: p.value }));
  }
  fs.writeFileSync(path.join(outDir, 'equity-curve.svg'), lineChart('Final holdout normalized equity', equity));
  fs.writeFileSync(path.join(outDir, 'drawdown.svg'), lineChart('Final holdout drawdown', drawdowns, { percent: true, zeroLine: true }));
  fs.writeFileSync(path.join(outDir, 'rolling-sharpe-30d.svg'), lineChart('30-day rolling Sharpe', roll, { zeroLine: true }));
  fs.writeFileSync(path.join(outDir, 'turnover.svg'), lineChart('Cumulative turnover (USD)', turnover));
  fs.writeFileSync(path.join(outDir, 'fee-drag.svg'), barChart('Fee drag / starting capital', Object.fromEntries(Object.entries(bundle.summary.finalHoldout.strategies).map(([n, m]) => [n, m.feeDrag])), { percent: true }));
  fs.writeFileSync(path.join(outDir, 'development-fold-sharpe.svg'), barChart('Development fold Sharpe — ridge24', Object.fromEntries(bundle.summary.developmentFolds.map((fold, i) => [`fold_${i + 1}`, fold.candidate.sharpe]))));

  const s = bundle.summary;
  const final = s.finalHoldout.strategies;
  const candidate = final.ridge24_cost_gate;
  const v2 = final.frozen_v2;
  const md = `# MoneyMog crypto research result — ${s.experimentId}\n\n` +
`**Status:** ${s.promotion.pass ? 'PASSES PREDECLARED RESEARCH GATE' : 'DOES NOT PASS PREDECLARED RESEARCH GATE'}  \n` +
`**Live trader changed:** no  \n` +
`**Exact data SHA-256:** \`${s.dataset.sha256}\`\n\n` +
`## Untouched final holdout\n\n` +
`| Strategy | Net return | Sharpe | Sortino | Max DD | Fees | Turnover/equity | Exposure | Closed trades |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n` +
Object.entries(final).map(([name, m]) => `| ${name} | ${fmtPct(m.netReturn)} | ${fmtNum(m.sharpe)} | ${fmtNum(m.sortino)} | ${fmtPct(m.maxDrawdown)} | ${fmtUsd(m.totalFees)} | ${fmtNum(m.turnoverToAverageEquity)}x | ${fmtPct(m.averageExposure)} | ${m.closedTrades} |`).join('\n') +
`\n\nPrimary comparison: ridge24 Sharpe ${fmtNum(candidate.sharpe)} vs frozen-v2 ${fmtNum(v2.sharpe)}; ridge24 net return ${fmtPct(candidate.netReturn)} vs frozen-v2 ${fmtPct(v2.netReturn)}.\n\n` +
`## Predeclared promotion checks\n\n` + s.promotion.checks.map((check) => `- ${check.pass ? 'PASS' : 'FAIL'} — ${check.name}: ${check.detail}`).join('\n') +
`\n\n## Cost stress\n\n` + Object.entries(s.spreadStress).map(([spread, m]) => `- ${spread} bps round-trip spread: net ${fmtPct(m.netReturn)}, Sharpe ${fmtNum(m.sharpe)}, fees ${fmtUsd(m.totalFees)}`).join('\n') +
`\n\n## Development folds\n\n` + s.developmentFolds.map((fold, i) => `- Fold ${i + 1} ${fold.start.slice(0,10)}→${fold.end.slice(0,10)}: ridge24 Sharpe ${fmtNum(fold.candidate.sharpe)}, net ${fmtPct(fold.candidate.netReturn)}; v2 Sharpe ${fmtNum(fold.v2.sharpe)}, net ${fmtPct(fold.v2.netReturn)}`).join('\n') +
`\n\n## Interpretation rule\n\nA failed frozen candidate stays failed. No post-holdout threshold, feature, horizon, or ridge-lambda rescue is permitted under this experiment ID. Any successor must be motivated independently, receive a new manifest, and increment the trial ledger before evaluation.\n`;
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), md);
}
