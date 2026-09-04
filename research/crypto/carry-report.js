import fs from 'node:fs';
import path from 'node:path';

const summaryPath = process.argv[2];
if (!summaryPath) throw new Error('Usage: node research/crypto/carry-report.js <summary.json> [output-dir]');
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
if (summary.experimentId !== 'funding-carry-v1' || summary.paperOnly !== true || summary.livePromotionAllowed !== false) {
  throw new Error('Unexpected or non-research carry summary');
}
if (!Array.isArray(summary.dailyDiagnostics) || !summary.dailyDiagnostics.length) {
  throw new Error('Carry summary does not contain dailyDiagnostics');
}
const outputDir = path.resolve(process.argv[3] ?? path.dirname(summaryPath));
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'REPORT.md');
if (fs.existsSync(reportPath)) throw new Error(`Refusing to overwrite existing carry report: ${reportPath}`);

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function pct(value) {
  return finite(value) === null ? 'n/a' : `${(Number(value) * 100).toFixed(2)}%`;
}
function num(value, digits = 2) {
  return finite(value) === null ? 'n/a' : Number(value).toFixed(digits);
}
function usd(value) {
  return finite(value) === null ? 'n/a' : `$${Number(value).toFixed(2)}`;
}
function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
function minFinite(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.min(...usable) : null;
}
function maxFinite(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.max(...usable) : null;
}

function lineChart(title, seriesByName, { percent = false, zeroLine = false } = {}) {
  const width = 1100;
  const height = 560;
  const margin = { left: 90, right: 35, top: 60, bottom: 75 };
  const series = Object.entries(seriesByName).filter(([, points]) => points.length);
  const all = series.flatMap(([, points]) => points).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
  if (!all.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="40" y="50" font-family="system-ui,sans-serif" font-size="20">No data: ${esc(title)}</text></svg>`;
  const minT = Math.min(...all.map((point) => point.time));
  const maxT = Math.max(...all.map((point) => point.time));
  let minV = Math.min(...all.map((point) => point.value));
  let maxV = Math.max(...all.map((point) => point.value));
  if (zeroLine) { minV = Math.min(minV, 0); maxV = Math.max(maxV, 0); }
  if (Math.abs(maxV - minV) < 1e-12) { minV -= 0.5; maxV += 0.5; }
  const x = (time) => margin.left + ((time - minT) / Math.max(1, maxT - minT)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (1 - (value - minV) / (maxV - minV)) * (height - margin.top - margin.bottom);
  const palette = ['#111827', '#2563eb', '#059669', '#dc2626'];
  const yTicks = Array.from({ length: 6 }, (_, i) => minV + (maxV - minV) * i / 5).map((value) => {
    const yy = y(value);
    const label = percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
    return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"/><text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" font-size="12" font-family="system-ui,sans-serif">${label}</text>`;
  }).join('');
  const lines = series.map(([name, points], index) => {
    const usable = points.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
    const d = usable.map((point, i) => `${i ? 'L' : 'M'} ${x(point.time).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${palette[index % palette.length]}" stroke-width="2"/><text x="${margin.left + index * 230}" y="${height - 28}" font-family="system-ui,sans-serif" font-size="13" fill="${palette[index % palette.length]}">${esc(name)}</text>`;
  }).join('');
  const zero = zeroLine && minV <= 0 && maxV >= 0
    ? `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}" stroke="#6b7280" stroke-dasharray="5 5"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="${margin.left}" y="34" font-family="system-ui,sans-serif" font-size="22" font-weight="700">${esc(title)}</text>${yTicks}${zero}${lines}</svg>`;
}

const btcUnits = Number(summary.frozenPosition.btcUnits);
const collateral = Number(summary.frozenPosition.futuresCollateral);
const daily = summary.dailyDiagnostics.map((row) => {
  const time = Date.parse(row.timestamp);
  const perpMarkNotional = btcUnits * Number(row.perpMark);
  const grossNotional = Number(row.spotValue) + perpMarkNotional;
  const equityValue = Number(row.equity);
  const spotMinusMarkNotional = Number(row.spotValue) - perpMarkNotional;
  const marginUtilization = Number(row.futuresEquity) > 0 ? Number(row.maintenance) / Number(row.futuresEquity) : null;
  return {
    ...row,
    time,
    perpMarkNotional,
    grossNotional,
    grossExposurePctOfEquity: equityValue > 0 ? grossNotional / equityValue : null,
    spotMinusMarkNotional,
    absoluteSpotMarkNotionalMismatchPctOfEquity: equityValue > 0 ? Math.abs(spotMinusMarkNotional) / equityValue : null,
    perpMarkNotionalToFrozenCollateral: collateral > 0 ? perpMarkNotional / collateral : null,
    maintenanceToFuturesEquity: marginUtilization,
    futuresEquityToMaintenance: Number(row.maintenance) > 0 ? Number(row.futuresEquity) / Number(row.maintenance) : null
  };
});

let peak = summary.strategies.fundingCarry.startValue;
const drawdown = daily.map((row) => {
  peak = Math.max(peak, row.equity);
  return { time: row.time, value: row.equity / peak - 1 };
});
const equity = daily.map((row) => ({ time: row.time, value: row.equity }));
const funding = daily.map((row) => ({ time: row.time, value: row.cumulativeFundingPnl }));
const basis = {
  'contract - spot': daily.map((row) => ({ time: row.time, value: row.contractVsSpotPct })),
  'mark - spot': daily.map((row) => ({ time: row.time, value: row.markVsSpotPct })),
  'mark - contract': daily.map((row) => ({ time: row.time, value: row.markVsContractPct }))
};
const margin = daily.map((row) => ({ time: row.time, value: row.marginExcess }));
const exposure = {
  'gross notional / equity': daily.map((row) => ({ time: row.time, value: row.grossExposurePctOfEquity })),
  '|spot - mark notional| / equity': daily.map((row) => ({ time: row.time, value: row.absoluteSpotMarkNotionalMismatchPctOfEquity }))
};
const marginUtilization = daily.map((row) => ({ time: row.time, value: row.maintenanceToFuturesEquity }));

fs.writeFileSync(path.join(outputDir, 'equity-curve.svg'), lineChart('Funding carry daily marked equity (USD)', { 'funding carry': equity }, { zeroLine: false }));
fs.writeFileSync(path.join(outputDir, 'drawdown.svg'), lineChart('Funding carry drawdown', { drawdown }, { percent: true, zeroLine: true }));
fs.writeFileSync(path.join(outputDir, 'cumulative-funding.svg'), lineChart('Cumulative funding P&L (USD)', { funding }, { zeroLine: true }));
fs.writeFileSync(path.join(outputDir, 'basis.svg'), lineChart('Spot / contract / mark basis', basis, { percent: true, zeroLine: true }));
fs.writeFileSync(path.join(outputDir, 'margin-excess.svg'), lineChart('Futures equity minus maintenance requirement (USD)', { 'margin excess': margin }, { zeroLine: true }));
fs.writeFileSync(path.join(outputDir, 'gross-exposure.svg'), lineChart('Gross and residual notional exposure / equity', exposure, { percent: true, zeroLine: true }));
fs.writeFileSync(path.join(outputDir, 'margin-utilization.svg'), lineChart('Maintenance requirement / futures equity', { 'margin utilization': marginUtilization }, { percent: true, zeroLine: true }));

const dailyColumns = [
  'timestamp','equity','spotPrice','spotValue','perpExecutionReference','perpMark','perpMarkNotional','grossNotional',
  'grossExposurePctOfEquity','spotMinusMarkNotional','absoluteSpotMarkNotionalMismatchPctOfEquity','contractVsSpotPct','markVsSpotPct',
  'markVsContractPct','fundingRate','cumulativeFundingPnl','perpUnrealizedPnl','futuresEquity','maintenance','marginExcess',
  'perpMarkNotionalToFrozenCollateral','maintenanceToFuturesEquity','futuresEquityToMaintenance'
];
const dailyCsv = [dailyColumns.join(',')];
for (const row of daily) dailyCsv.push(dailyColumns.map((column) => csvCell(row[column])).join(','));
fs.writeFileSync(path.join(outputDir, 'daily-diagnostics.csv'), `${dailyCsv.join('\n')}\n`);

const strategyColumns = ['strategy','netReturn','annualizedReturn','sharpe','sortino','maxDrawdown','calmar','fees','feeDrag','startValue','endValue','elapsedDays'];
const strategyCsv = [strategyColumns.join(',')];
for (const [name, metrics] of Object.entries(summary.strategies)) {
  strategyCsv.push(strategyColumns.map((column) => csvCell(column === 'strategy' ? name : metrics[column])).join(','));
}
fs.writeFileSync(path.join(outputDir, 'comparison-metrics.csv'), `${strategyCsv.join('\n')}\n`);

const riskSummary = {
  equalBtcUnitHedge: true,
  residualBtcDeltaUnitsByConstruction: 0,
  initialCapitalCommittedPct: summary.frozenPosition.initialCapitalCommittedPct,
  averageGrossExposurePctOfEquity: mean(daily.map((row) => row.grossExposurePctOfEquity)),
  maximumGrossExposurePctOfEquity: maxFinite(daily.map((row) => row.grossExposurePctOfEquity)),
  averageAbsoluteSpotMarkNotionalMismatchPctOfEquity: mean(daily.map((row) => row.absoluteSpotMarkNotionalMismatchPctOfEquity)),
  maximumAbsoluteSpotMarkNotionalMismatchPctOfEquity: maxFinite(daily.map((row) => row.absoluteSpotMarkNotionalMismatchPctOfEquity)),
  maximumPerpMarkNotionalToFrozenCollateral: maxFinite(daily.map((row) => row.perpMarkNotionalToFrozenCollateral)),
  maximumMaintenanceToFuturesEquity: maxFinite(daily.map((row) => row.maintenanceToFuturesEquity)),
  minimumFuturesEquityToMaintenance: minFinite(daily.map((row) => row.futuresEquityToMaintenance)),
  minimumMarginExcessUsd: minFinite(daily.map((row) => row.marginExcess)),
  historicalMarginBreach: summary.margin.breached,
  note: 'Equal BTC units remove first-order BTC-unit delta by construction. The reported spot-minus-mark dollar-notional mismatch is a basis/valuation diagnostic, not a claim of residual BTC units.'
};
fs.writeFileSync(path.join(outputDir, 'risk-summary.json'), `${JSON.stringify(riskSummary, null, 2)}\n`);

const carry = summary.strategies.fundingCarry;
const hold = summary.strategies.btcSpotBuyHold15;
const cash = summary.strategies.cash;
const stressLines = Object.entries(summary.margin.gapStress).map(([gap, values]) =>
  `- +${(Number(gap) * 100).toFixed(0)}% perpetual-mark gap: ${values.breached ? '**BREACH**' : 'no breach'}; minimum excess margin ${usd(values.minimumExcessMargin)}`
).join('\n');
const report = `# TheOldTrader funding-carry-v1 robustness report\n\n` +
`**Classification:** historical development/robustness evidence only; not pristine validation  \n` +
`**Live trading enabled:** no  \n` +
`**Input SHA-256:** \`${summary.input.sha256}\`  \n` +
`**Exact 8-hour grid:** ${summary.input.rows}/${summary.input.expectedRows} rows; verified=${summary.input.exactEightHourGridVerified}  \n` +
`**Historical margin breach:** ${summary.margin.breached ? '**YES — candidate fails frozen margin requirement**' : 'no'}\n\n` +
`## Strategy comparison\n\n` +
`| Strategy | Net return | Annualized | Sharpe | Sortino | Max DD | Fees | End value |\n|---|---:|---:|---:|---:|---:|---:|---:|\n` +
`| funding carry | ${pct(carry.netReturn)} | ${pct(carry.annualizedReturn)} | ${num(carry.sharpe)} | ${num(carry.sortino)} | ${pct(carry.maxDrawdown)} | ${usd(carry.fees)} | ${usd(carry.endValue)} |\n` +
`| BTC spot buy-and-hold 15% | ${pct(hold.netReturn)} | ${pct(hold.annualizedReturn)} | ${num(hold.sharpe)} | ${num(hold.sortino)} | ${pct(hold.maxDrawdown)} | ${usd(hold.fees)} | ${usd(hold.endValue)} |\n` +
`| cash | ${pct(cash.netReturn)} | ${pct(cash.annualizedReturn)} | ${num(cash.sharpe)} | ${num(cash.sortino)} | ${pct(cash.maxDrawdown)} | ${usd(cash.fees)} | ${usd(cash.endValue)} |\n\n` +
`## P&L decomposition\n\n` +
`- Funding P&L: ${usd(summary.pnlDecomposition.fundingPnl)}\n` +
`- Spot leg after fees: ${usd(summary.pnlDecomposition.spotLegPnlAfterFees)}\n` +
`- Perpetual leg after fees: ${usd(summary.pnlDecomposition.perpetualLegPnlAfterFees)}\n` +
`- Price hedge P&L after fees: ${usd(summary.pnlDecomposition.priceHedgePnlAfterFees)}\n` +
`- Total modeled fees: ${usd(summary.pnlDecomposition.totalFees)}\n\n` +
`## Exposure and capital diagnostics\n\n` +
`- Equal BTC units / residual BTC-unit delta: yes / 0 by construction\n` +
`- Initial committed capital: ${pct(riskSummary.initialCapitalCommittedPct)} of starting equity\n` +
`- Average gross spot + mark notional / equity: ${pct(riskSummary.averageGrossExposurePctOfEquity)}\n` +
`- Maximum gross spot + mark notional / equity: ${pct(riskSummary.maximumGrossExposurePctOfEquity)}\n` +
`- Average |spot - mark notional| / equity: ${pct(riskSummary.averageAbsoluteSpotMarkNotionalMismatchPctOfEquity)}\n` +
`- Maximum |spot - mark notional| / equity: ${pct(riskSummary.maximumAbsoluteSpotMarkNotionalMismatchPctOfEquity)}\n` +
`- Maximum perp mark notional / frozen collateral: ${num(riskSummary.maximumPerpMarkNotionalToFrozenCollateral)}x\n` +
`- Maximum maintenance / futures equity: ${pct(riskSummary.maximumMaintenanceToFuturesEquity)}\n` +
`- Minimum futures equity / maintenance: ${num(riskSummary.minimumFuturesEquityToMaintenance)}x\n` +
`- Minimum margin excess: ${usd(riskSummary.minimumMarginExcessUsd)}\n\n` +
`## Entry / basis diagnostics\n\n` +
`- BTC units: ${num(summary.frozenPosition.btcUnits, 8)}\n` +
`- Spot entry notional: ${usd(summary.frozenPosition.spotEntryNotional)}\n` +
`- Perpetual entry notional: ${usd(summary.frozenPosition.perpEntryNotional)} (${pct(summary.frozenPosition.perpEntryNotionalPctOfStartingEquity)} of starting equity)\n` +
`- Entry contract-vs-spot basis: ${pct(summary.basisDiagnostics.entryContractVsSpotPct)}\n` +
`- Exit contract-vs-spot basis: ${pct(summary.basisDiagnostics.exitContractVsSpotPct)}\n` +
`- Entry mark-vs-contract: ${pct(summary.basisDiagnostics.entryMarkVsContractPct)}\n` +
`- Exit mark-vs-contract: ${pct(summary.basisDiagnostics.exitMarkVsContractPct)}\n\n` +
`## Margin stress\n\n${stressLines}\n\n` +
`## Interpretation constraint\n\n${summary.interpretationConstraint}\n\n` +
`A failed frozen Trial 2 stays failed. Funding thresholds, sign filters, leverage/allocation changes, entry-date selection, or rebalancing cannot be introduced under this trial after the result is observed. Any such successor requires a new trial number.\n`;
fs.writeFileSync(reportPath, report);

console.log(JSON.stringify({
  outputDir,
  files: [
    'REPORT.md','comparison-metrics.csv','daily-diagnostics.csv','risk-summary.json','equity-curve.svg','drawdown.svg',
    'cumulative-funding.svg','basis.svg','margin-excess.svg','gross-exposure.svg','margin-utilization.svg'
  ]
}, null, 2));