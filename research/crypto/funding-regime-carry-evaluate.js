#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.length < 5) throw new Error('usage: funding-regime-carry-evaluate.js <manifest> <development|final> <ada.csv> <doge.csv> <out> [--confirm-final YES]');
const [manifestPath, mode, adaPath, dogePath, outPath] = args;
if (!['development', 'final'].includes(mode)) throw new Error('mode must be development or final');
if (mode === 'final' && !(args[5] === '--confirm-final' && args[6] === 'YES')) throw new Error('final requires --confirm-final YES');
if (mode === 'development' && args.includes('--confirm-final')) throw new Error('final flag forbidden in development');
if (fs.existsSync(outPath)) throw new Error(`refusing to overwrite ${outPath}`);

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (m.experimentId !== 'funding-regime-carry-v1' || m.trialNumber !== 19 || m.status !== 'FROZEN_PRE_DEVELOPMENT') throw new Error('wrong Trial 19 manifest');
if (JSON.stringify(m.assetSelection.symbols) !== JSON.stringify(['ADAUSDT', 'DOGEUSDT'])) throw new Error('Trial 19 asset drift');
const window = mode === 'development' ? m.developmentWindow : m.finalHoldout;
const startMs = Date.parse(window.startInclusive);
const endMs = Date.parse(window.endExclusive);
const eightHours = 8 * 60 * 60 * 1000;
const expectedRows = (endMs - startMs) / eightHours;
if (!Number.isInteger(expectedRows)) throw new Error('window is not an exact 8h grid');

const mean = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
function stdev(v) { if (v.length < 2) return 0; const mu = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1)); }
function dailyLast(series) { const by = new Map(); for (const p of series) by.set(Math.floor(p.time / 86400000), p); return [...by.values()].sort((a, b) => a.time - b.time); }
function metrics(series, startValue, fees, firstTimestamp) {
  const daily = dailyLast(series);
  let previous = startValue, peak = startValue, maxDrawdown = 0;
  const returns = [];
  for (const p of daily) {
    returns.push(p.equity / previous - 1);
    previous = p.equity;
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.min(maxDrawdown, p.equity / peak - 1);
  }
  const endValue = daily.at(-1)?.equity ?? startValue;
  const elapsedDays = Math.max(1, ((daily.at(-1)?.time ?? firstTimestamp) - firstTimestamp) / 86400000);
  const annualizedReturn = (endValue / startValue) ** (365 / elapsedDays) - 1;
  const sd = stdev(returns);
  const downside = returns.filter((x) => x < 0);
  const downsideSd = stdev(downside);
  return {
    netReturn: endValue / startValue - 1,
    annualizedReturn,
    sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
    sortino: downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null,
    fees,
    feeDrag: fees / startValue,
    startValue,
    endValue,
    elapsedDays,
  };
}
function fill(price, side, cost) {
  const adverse = cost.slippageBpsPerSide + cost.spreadBpsRoundTrip / 2;
  return price * (1 + (side === 'buy' ? 1 : -1) * adverse / 10000);
}
function parseCsv(file) {
  const raw = fs.readFileSync(file);
  const lines = raw.toString('utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((x) => x.trim());
  const required = ['timestamp', 'raw_funding_timestamp', 'funding_timestamp_skew_ms', 'spot_price', 'perp_exec_price', 'perp_mark_price', 'funding_rate'];
  for (const c of required) if (!header.includes(c)) throw new Error(`${file}: missing ${c}`);
  const ix = Object.fromEntries(header.map((x, i) => [x, i]));
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(',');
    const row = {
      timestamp: Date.parse(cells[ix.timestamp]),
      rawFundingTimestamp: Date.parse(cells[ix.raw_funding_timestamp]),
      skewMs: Number(cells[ix.funding_timestamp_skew_ms]),
      spot: Number(cells[ix.spot_price]),
      perpExec: Number(cells[ix.perp_exec_price]),
      perpMark: Number(cells[ix.perp_mark_price]),
      funding: Number(cells[ix.funding_rate]),
    };
    if (![row.timestamp, row.rawFundingTimestamp, row.skewMs, row.spot, row.perpExec, row.perpMark, row.funding].every(Number.isFinite)) throw new Error(`${file}: invalid row`);
    if (row.spot <= 0 || row.perpExec <= 0 || row.perpMark <= 0) throw new Error(`${file}: nonpositive price`);
    return row;
  }).filter((r) => r.timestamp >= startMs && r.timestamp < endMs).sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length !== expectedRows) throw new Error(`${file}: expected ${expectedRows} rows, got ${rows.length}`);
  if (rows[0].timestamp !== startMs || rows.at(-1).timestamp !== endMs - eightHours) throw new Error(`${file}: endpoint mismatch`);
  for (let i = 1; i < rows.length; i++) if (rows[i].timestamp - rows[i - 1].timestamp !== eightHours) throw new Error(`${file}: irregular grid`);
  const maxSkew = Math.max(...rows.map((r) => Math.abs(r.skewMs)));
  if (maxSkew > m.dataRequirements.fundingTimestampNormalizationMaximumAbsoluteSkewMs) throw new Error(`${file}: funding timestamp skew breach`);
  return { rows, sha256: crypto.createHash('sha256').update(raw).digest('hex'), maxSkew };
}

const cost = {
  spot: { feeBpsPerSide: m.costModel.spotFeeBpsPerSide, slippageBpsPerSide: m.costModel.spotSlippageBpsPerSide, spreadBpsRoundTrip: m.costModel.spotSpreadBpsRoundTrip },
  perp: { feeBpsPerSide: m.costModel.perpetualFeeBpsPerSide, slippageBpsPerSide: m.costModel.perpetualSlippageBpsPerSide, spreadBpsRoundTrip: m.costModel.perpetualSpreadBpsRoundTrip },
};

function simulateSleeve(symbol, parsed) {
  const rows = parsed.rows;
  const startValue = m.portfolio.sleeveStartingEquity;
  const spotNotional = startValue * m.portfolio.spotNotionalPctOfSleeveWhenActive;
  const collateral = startValue * m.portfolio.futuresCollateralReservePctOfSleeveWhenActive;
  const lookback = m.signal.lookbackFundingBoundaries;
  const minState = m.signal.minimumStateBoundaries;
  const entryThreshold = m.signal.entryAnnualizedTrailingFundingThreshold;
  const exitThreshold = m.signal.exitAnnualizedTrailingFundingThreshold;
  const ann = m.signal.annualizationFactor;
  let cash = startValue;
  let active = false;
  let units = 0;
  let spotEntryFill = 0;
  let perpEntryFill = 0;
  let fundingPnl = 0;
  let lastTransitionIndex = -1e12;
  let fees = 0;
  let totalFundingPnl = 0;
  let realizedPriceHedgePnl = 0;
  let marginBreach = null;
  const gapStress = Object.fromEntries(m.marginStress.additionalGapStressPct.map((g) => [String(g), { breached: false, minimumExcessMargin: Infinity }]));
  const trades = [];
  const series = [];
  let currentTrade = null;
  let activeBoundaryCount = 0;
  let signalEligibleBoundaries = 0;

  function markEquity(row) {
    if (!active) return cash;
    const spotValue = units * row.spot;
    const perpUnrealized = units * (perpEntryFill - row.perpMark);
    const futuresEquity = collateral + perpUnrealized + fundingPnl;
    return cash + spotValue + futuresEquity;
  }
  function checkMargin(row) {
    const perpUnrealized = units * (perpEntryFill - row.perpMark);
    const futuresEquity = collateral + perpUnrealized + fundingPnl;
    const maintenance = units * row.perpMark * m.marginStress.maintenanceMarginPctOfPerpetualNotional;
    if (!marginBreach && futuresEquity < maintenance) marginBreach = { timestamp: new Date(row.timestamp).toISOString(), futuresEquity, maintenance, perpMark: row.perpMark };
    for (const gap of m.marginStress.additionalGapStressPct) {
      const stressedMark = row.perpMark * (1 + gap);
      const stressedPnl = units * (perpEntryFill - stressedMark);
      const stressedEquity = collateral + stressedPnl + fundingPnl;
      const stressedMaintenance = units * stressedMark * m.marginStress.maintenanceMarginPctOfPerpetualNotional;
      const excess = stressedEquity - stressedMaintenance;
      const s = gapStress[String(gap)];
      s.minimumExcessMargin = Math.min(s.minimumExcessMargin, excess);
      if (excess < 0) s.breached = true;
    }
  }
  function enter(row, i, signal) {
    spotEntryFill = fill(row.spot, 'buy', cost.spot);
    units = spotNotional / spotEntryFill;
    const spotFee = spotNotional * cost.spot.feeBpsPerSide / 10000;
    perpEntryFill = fill(row.perpExec, 'sell', cost.perp);
    const perpNotional = units * perpEntryFill;
    const perpFee = perpNotional * cost.perp.feeBpsPerSide / 10000;
    const required = spotNotional + spotFee + collateral + perpFee;
    if (cash < required) throw new Error(`${symbol}: insufficient cash to enter frozen position`);
    cash -= required;
    fees += spotFee + perpFee;
    fundingPnl = 0;
    active = true;
    lastTransitionIndex = i;
    currentTrade = {
      entryTimestamp: new Date(row.timestamp).toISOString(),
      entryIndex: i,
      entrySignalAnnualizedFunding: signal,
      units,
      spotEntryFill,
      perpEntryFill,
      entryFees: spotFee + perpFee,
      forcedExit: false,
    };
  }
  function exit(row, i, signal, forced = false) {
    const spotExitFill = fill(row.spot, 'sell', cost.spot);
    const spotGross = units * spotExitFill;
    const spotFee = spotGross * cost.spot.feeBpsPerSide / 10000;
    const perpExitFill = fill(row.perpExec, 'buy', cost.perp);
    const perpExitNotional = units * perpExitFill;
    const perpFee = perpExitNotional * cost.perp.feeBpsPerSide / 10000;
    const realizedPerp = units * (perpEntryFill - perpExitFill);
    const spotPnlAfterFees = spotGross - spotFee - spotNotional - currentTrade.entryFees * 0 + 0;
    cash += (spotGross - spotFee) + collateral + realizedPerp + fundingPnl - perpFee;
    fees += spotFee + perpFee;
    totalFundingPnl += fundingPnl;
    const entrySpotCost = spotNotional;
    const entrySpotFee = currentTrade.entryFees - (units * perpEntryFill * cost.perp.feeBpsPerSide / 10000);
    const spotLegPnlAfterFees = spotGross - spotFee - entrySpotCost - entrySpotFee;
    const entryPerpFee = units * perpEntryFill * cost.perp.feeBpsPerSide / 10000;
    const perpLegPnlAfterFees = realizedPerp - entryPerpFee - perpFee;
    realizedPriceHedgePnl += spotLegPnlAfterFees + perpLegPnlAfterFees;
    trades.push({
      ...currentTrade,
      exitTimestamp: new Date(row.timestamp).toISOString(),
      exitIndex: i,
      exitSignalAnnualizedFunding: signal,
      forcedExit: forced,
      holdingBoundaries: i - currentTrade.entryIndex,
      fundingPnl,
      spotLegPnlAfterFees,
      perpLegPnlAfterFees,
      netTradePnl: fundingPnl + spotLegPnlAfterFees + perpLegPnlAfterFees,
      exitFees: spotFee + perpFee,
    });
    active = false;
    units = 0;
    spotEntryFill = 0;
    perpEntryFill = 0;
    fundingPnl = 0;
    currentTrade = null;
    lastTransitionIndex = i;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let signal = null;
    if (i >= lookback) {
      signal = mean(rows.slice(i - lookback, i).map((r) => r.funding)) * ann;
      signalEligibleBoundaries++;
    }
    if (active) {
      fundingPnl += units * row.perpMark * row.funding;
      activeBoundaryCount++;
      checkMargin(row);
      if (signal !== null && i - lastTransitionIndex >= minState && signal <= exitThreshold) exit(row, i, signal, false);
    } else if (signal !== null && i - lastTransitionIndex >= minState && signal >= entryThreshold) {
      enter(row, i, signal);
      checkMargin(row);
    }
    series.push({ time: row.timestamp, equity: markEquity(row), signalAnnualizedFunding: signal, active });
  }
  const last = rows.at(-1);
  if (active) {
    const finalSignal = rows.length >= lookback ? mean(rows.slice(rows.length - lookback).map((r) => r.funding)) * ann : null;
    exit(last, rows.length - 1, finalSignal, true);
  }
  series.push({ time: last.timestamp + 1, equity: cash, active: false, finalExit: true });
  for (const s of Object.values(gapStress)) if (!Number.isFinite(s.minimumExcessMargin)) s.minimumExcessMargin = null;
  return {
    symbol,
    input: { sha256: parsed.sha256, rows: rows.length, maxAbsoluteFundingTimestampSkewMs: parsed.maxSkew, firstTimestamp: new Date(rows[0].timestamp).toISOString(), lastTimestamp: new Date(last.timestamp).toISOString() },
    metrics: metrics(series, startValue, fees, rows[0].timestamp),
    diagnostics: {
      completedRoundTrips: trades.length,
      activeBoundaryCount,
      signalEligibleBoundaries,
      activeFractionOfEligibleBoundaries: signalEligibleBoundaries ? activeBoundaryCount / signalEligibleBoundaries : 0,
      totalFundingPnl,
      realizedPriceHedgePnl,
      totalFees: fees,
      marginBreach,
      gapStress,
    },
    trades,
    series,
  };
}

const ada = simulateSleeve('ADAUSDT', parseCsv(adaPath));
const doge = simulateSleeve('DOGEUSDT', parseCsv(dogePath));
if (ada.series.length !== doge.series.length) throw new Error('sleeve series length mismatch');
const basketSeries = ada.series.map((p, i) => {
  const q = doge.series[i];
  if (p.time !== q.time) throw new Error(`basket timestamp mismatch at ${i}`);
  return { time: p.time, equity: p.equity + q.equity };
});
const totalFees = ada.metrics.fees + doge.metrics.fees;
const basket = metrics(basketSeries, m.portfolio.startingEquity, totalFees, basketSeries[0].time);
const result = {
  experimentId: m.experimentId,
  trialNumber: 19,
  mode,
  generatedAt: new Date().toISOString(),
  window,
  signal: m.signal,
  basket,
  completedRoundTrips: ada.diagnostics.completedRoundTrips + doge.diagnostics.completedRoundTrips,
  sleeves: { ADAUSDT: ada, DOGEUSDT: doge },
  paperOnly: true,
  realMoneyAllowed: false,
  antiRescueRule: m.antiRescueRule,
};
fs.mkdirSync(new URL('.', `file://${process.cwd()}/${outPath}`).pathname, { recursive: true });
fs.mkdirSync(outPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ experimentId: result.experimentId, trialNumber: 19, mode, basket, completedRoundTrips: result.completedRoundTrips, sleeveReturns: { ADAUSDT: ada.metrics.netReturn, DOGEUSDT: doge.metrics.netReturn } }, null, 2));
