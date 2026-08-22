#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.length < 7) throw new Error('usage: risk-capped-funding-regime-evaluate.js <manifest> <development|final> <link.csv> <bch.csv> <eos.csv> <uni.csv> <out> [--confirm-final YES]');
const [manifestPath, mode, linkPath, bchPath, eosPath, uniPath, outPath] = args;
if (!['development', 'final'].includes(mode)) throw new Error('mode must be development or final');
if (mode === 'final' && !(args[7] === '--confirm-final' && args[8] === 'YES')) throw new Error('final requires --confirm-final YES');
if (mode === 'development' && args.includes('--confirm-final')) throw new Error('final flag forbidden in development');
if (fs.existsSync(outPath)) throw new Error(`refusing overwrite ${outPath}`);

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (m.experimentId !== 'risk-capped-funding-regime-v1' || m.trialNumber !== 22 || m.status !== 'FROZEN_PRE_DEVELOPMENT') throw new Error('wrong Trial 22 manifest');
const symbols = ['LINKUSDT', 'BCHUSDT', 'EOSUSDT', 'UNIUSDT'];
if (JSON.stringify(m.assetSelection.symbols) !== JSON.stringify(symbols)) throw new Error('Trial 22 asset drift');
const files = { LINKUSDT: linkPath, BCHUSDT: bchPath, EOSUSDT: eosPath, UNIUSDT: uniPath };
const window = mode === 'development' ? m.developmentWindow : m.finalHoldout;
const startMs = Date.parse(window.startInclusive), endMs = Date.parse(window.endExclusive);
const eightHours = 8 * 60 * 60 * 1000;
const expectedRows = (endMs - startMs) / eightHours;
if (!Number.isInteger(expectedRows)) throw new Error('window is not exact 8h grid');

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
  const sd = stdev(returns), downside = returns.filter((x) => x < 0), downsideSd = stdev(downside);
  return {
    netReturn: endValue / startValue - 1,
    annualizedReturn,
    sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
    sortino: downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null,
    fees, feeDrag: fees / startValue, startValue, endValue, elapsedDays,
  };
}
function fill(price, side, feeModel) {
  const adverseBps = feeModel.slippageBpsPerSide + feeModel.spreadBpsRoundTrip / 2;
  return price * (1 + (side === 'buy' ? 1 : -1) * adverseBps / 10000);
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
    if (![row.timestamp, row.rawFundingTimestamp, row.skewMs, row.spot, row.perpExec, row.perpMark, row.funding].every(Number.isFinite)) throw new Error(`${file}: invalid numeric row`);
    if (row.spot <= 0 || row.perpExec <= 0 || row.perpMark <= 0) throw new Error(`${file}: nonpositive price`);
    return row;
  }).filter((r) => r.timestamp >= startMs && r.timestamp < endMs).sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length !== expectedRows) throw new Error(`${file}: expected ${expectedRows} rows got ${rows.length}`);
  if (rows[0].timestamp !== startMs || rows.at(-1).timestamp !== endMs - eightHours) throw new Error(`${file}: endpoint mismatch`);
  for (let i = 1; i < rows.length; i++) if (rows[i].timestamp - rows[i - 1].timestamp !== eightHours) throw new Error(`${file}: irregular 8h grid`);
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
  const initialEquity = m.portfolio.sleeveStartingEquity;
  const lookback = m.signal.lookbackFundingBoundaries;
  const minState = m.signal.minimumStateBoundaries;
  const entryThreshold = m.signal.entryAnnualizedTrailingFundingThreshold;
  const exitThreshold = m.signal.exitAnnualizedTrailingFundingThreshold;
  const annualization = m.signal.annualizationFactor;
  const maxAnchorAge = m.riskControl.maximumActiveBoundariesBeforeReanchor;
  const maxMarkNotionalRatio = m.riskControl.maximumPerpetualMarkNotionalPctOfCurrentSleeveEquityBeforeReanchor;

  let cash = initialEquity;
  let active = false;
  let units = 0, spotEntryFill = 0, perpEntryFill = 0, collateral = 0, fundingPnl = 0;
  let lastSignalTransitionIndex = -1e12, anchorIndex = null;
  let totalFees = 0, totalFundingPnl = 0, totalPriceHedgePnlAfterFees = 0;
  let realizedMarginBreach = null;
  let currentTrade = null;
  let signalEligibleBoundaries = 0, activeBoundaryCount = 0, reanchorCount = 0;
  const trades = [], series = [];
  const gapStress = Object.fromEntries(m.marginStress.additionalGapStressPct.map((g) => [String(g), { breached: false, minimumExcessMargin: Infinity, minimumExcessTimestamp: null }]));

  function currentFuturesEquity(row) {
    if (!active) return 0;
    return collateral + units * (perpEntryFill - row.perpMark) + fundingPnl;
  }
  function markEquity(row) {
    if (!active) return cash;
    return cash + units * row.spot + currentFuturesEquity(row);
  }
  function checkRealizedMargin(row) {
    if (!active) return;
    const futuresEquity = currentFuturesEquity(row);
    const maintenance = units * row.perpMark * m.marginStress.maintenanceMarginPctOfPerpetualNotional;
    if (!realizedMarginBreach && futuresEquity < maintenance) {
      realizedMarginBreach = { timestamp: new Date(row.timestamp).toISOString(), futuresEquity, maintenance, perpMark: row.perpMark };
    }
  }
  function recordRetainedStress(row) {
    if (!active) return;
    for (const gap of m.marginStress.additionalGapStressPct) {
      const stressedMark = row.perpMark * (1 + gap);
      const stressedFuturesEquity = collateral + units * (perpEntryFill - stressedMark) + fundingPnl;
      const stressedMaintenance = units * stressedMark * m.marginStress.maintenanceMarginPctOfPerpetualNotional;
      const excess = stressedFuturesEquity - stressedMaintenance;
      const slot = gapStress[String(gap)];
      if (excess < slot.minimumExcessMargin) {
        slot.minimumExcessMargin = excess;
        slot.minimumExcessTimestamp = new Date(row.timestamp).toISOString();
      }
      if (excess < 0) slot.breached = true;
    }
  }
  function enter(row, i, signal, reason) {
    if (active) throw new Error(`${symbol}: enter while active`);
    const sleeveEquity = cash;
    const spotNotional = sleeveEquity * m.portfolio.spotNotionalPctOfSleeveWhenActive;
    collateral = sleeveEquity * m.portfolio.futuresCollateralReservePctOfSleeveWhenActive;
    spotEntryFill = fill(row.spot, 'buy', cost.spot);
    units = spotNotional / spotEntryFill;
    perpEntryFill = fill(row.perpExec, 'sell', cost.perp);
    const spotFee = spotNotional * cost.spot.feeBpsPerSide / 10000;
    const perpEntryNotional = units * perpEntryFill;
    const perpFee = perpEntryNotional * cost.perp.feeBpsPerSide / 10000;
    const required = spotNotional + collateral + spotFee + perpFee;
    if (required > cash) throw new Error(`${symbol}: insufficient cash for frozen 15/80 sizing required=${required} cash=${cash}`);
    cash -= required;
    totalFees += spotFee + perpFee;
    fundingPnl = 0;
    active = true;
    anchorIndex = i;
    currentTrade = {
      entryTimestamp: new Date(row.timestamp).toISOString(), entryIndex: i, entrySignalAnnualizedFunding: signal,
      entryReason: reason, entrySleeveEquity: sleeveEquity, spotNotional, collateral, units, spotEntryFill, perpEntryFill,
      entryFees: spotFee + perpFee,
    };
  }
  function exit(row, i, signal, reason) {
    if (!active) throw new Error(`${symbol}: exit while inactive`);
    const before = markEquity(row);
    const spotExitFill = fill(row.spot, 'sell', cost.spot);
    const spotGross = units * spotExitFill;
    const spotFee = spotGross * cost.spot.feeBpsPerSide / 10000;
    const perpExitFill = fill(row.perpExec, 'buy', cost.perp);
    const perpExitNotional = units * perpExitFill;
    const perpFee = perpExitNotional * cost.perp.feeBpsPerSide / 10000;
    const realizedPerp = units * (perpEntryFill - perpExitFill);
    const entrySpotFee = currentTrade.spotNotional * cost.spot.feeBpsPerSide / 10000;
    const entryPerpFee = units * perpEntryFill * cost.perp.feeBpsPerSide / 10000;
    const spotLegPnlAfterFees = spotGross - spotFee - currentTrade.spotNotional - entrySpotFee;
    const perpLegPnlAfterFees = realizedPerp - entryPerpFee - perpFee;
    const tradeFunding = fundingPnl;
    cash += spotGross - spotFee + collateral + realizedPerp + fundingPnl - perpFee;
    totalFees += spotFee + perpFee;
    totalFundingPnl += tradeFunding;
    totalPriceHedgePnlAfterFees += spotLegPnlAfterFees + perpLegPnlAfterFees;
    trades.push({
      ...currentTrade,
      exitTimestamp: new Date(row.timestamp).toISOString(), exitIndex: i, exitSignalAnnualizedFunding: signal,
      exitReason: reason, holdingBoundaries: i - currentTrade.entryIndex,
      fundingPnl: tradeFunding, spotLegPnlAfterFees, perpLegPnlAfterFees,
      netTradePnl: tradeFunding + spotLegPnlAfterFees + perpLegPnlAfterFees,
      exitFees: spotFee + perpFee, markedEquityBeforeExit: before, cashAfterExit: cash,
    });
    active = false; units = 0; spotEntryFill = 0; perpEntryFill = 0; collateral = 0; fundingPnl = 0; anchorIndex = null; currentTrade = null;
  }
  function reanchor(row, i, signal, reason) {
    exit(row, i, signal, reason);
    reanchorCount++;
    enter(row, i, signal, `reanchor:${reason}`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let signal = null;
    if (i >= lookback) {
      signal = mean(rows.slice(i - lookback, i).map((r) => r.funding)) * annualization;
      signalEligibleBoundaries++;
    }

    if (active) {
      fundingPnl += units * row.perpMark * row.funding;
      activeBoundaryCount++;
      checkRealizedMargin(row);

      const signalExit = signal !== null && i - lastSignalTransitionIndex >= minState && signal <= exitThreshold;
      if (signalExit) {
        exit(row, i, signal, 'funding_exit');
        lastSignalTransitionIndex = i;
      } else if (i < rows.length - 1) {
        const equity = markEquity(row);
        const markNotionalRatio = equity > 0 ? (units * row.perpMark) / equity : Infinity;
        const age = i - anchorIndex;
        if (age >= maxAnchorAge || markNotionalRatio >= maxMarkNotionalRatio) {
          const reason = age >= maxAnchorAge ? 'age_cap' : 'mark_notional_cap';
          reanchor(row, i, signal, reason);
        }
      }
      recordRetainedStress(row);
    } else if (signal !== null && i - lastSignalTransitionIndex >= minState && signal >= entryThreshold) {
      enter(row, i, signal, 'funding_entry');
      lastSignalTransitionIndex = i;
      checkRealizedMargin(row);
      recordRetainedStress(row);
    }

    series.push({ time: row.timestamp, equity: markEquity(row), active, signalAnnualizedFunding: signal, anchorAgeBoundaries: active ? i - anchorIndex : null });
  }

  const last = rows.at(-1);
  if (active) {
    const finalSignal = rows.length >= lookback ? mean(rows.slice(rows.length - lookback).map((r) => r.funding)) * annualization : null;
    exit(last, rows.length - 1, finalSignal, 'window_end');
  }
  series.push({ time: last.timestamp + 1, equity: cash, active: false, finalExit: true });
  for (const slot of Object.values(gapStress)) if (!Number.isFinite(slot.minimumExcessMargin)) slot.minimumExcessMargin = null;

  return {
    symbol,
    input: { sha256: parsed.sha256, rows: rows.length, maxAbsoluteFundingTimestampSkewMs: parsed.maxSkew, firstTimestamp: new Date(rows[0].timestamp).toISOString(), lastTimestamp: new Date(last.timestamp).toISOString() },
    metrics: metrics(series, initialEquity, totalFees, rows[0].timestamp),
    diagnostics: {
      completedRoundTrips: trades.length,
      reanchorCount,
      signalEligibleBoundaries,
      activeBoundaryCount,
      activeFractionOfEligibleBoundaries: signalEligibleBoundaries ? activeBoundaryCount / signalEligibleBoundaries : 0,
      totalFundingPnl,
      totalPriceHedgePnlAfterFees,
      totalFees,
      realizedMarginBreach,
      gapStress,
    },
    trades,
    series,
  };
}

const parsed = Object.fromEntries(symbols.map((s) => [s, parseCsv(files[s])]));
const sleeves = Object.fromEntries(symbols.map((s) => [s, simulateSleeve(s, parsed[s])]));
const baseSeries = sleeves[symbols[0]].series;
for (const s of symbols.slice(1)) if (sleeves[s].series.length !== baseSeries.length) throw new Error(`sleeve series length mismatch ${s}`);
const basketSeries = baseSeries.map((p, i) => {
  let equity = 0;
  for (const s of symbols) {
    const q = sleeves[s].series[i];
    if (q.time !== p.time) throw new Error(`basket timestamp mismatch ${s} at ${i}`);
    equity += q.equity;
  }
  return { time: p.time, equity };
});
const totalFees = symbols.reduce((sum, s) => sum + sleeves[s].metrics.fees, 0);
const basket = metrics(basketSeries, m.portfolio.startingEquity, totalFees, basketSeries[0].time);
const completedRoundTrips = symbols.reduce((sum, s) => sum + sleeves[s].diagnostics.completedRoundTrips, 0);
const sleevesWithActivity = symbols.filter((s) => sleeves[s].diagnostics.activeBoundaryCount > 0).length;
const positiveSleeves = symbols.filter((s) => sleeves[s].metrics.netReturn > 0).length;
const result = {
  experimentId: m.experimentId,
  trialNumber: 22,
  mode,
  generatedAt: new Date().toISOString(),
  window,
  signal: m.signal,
  riskControl: m.riskControl,
  basket,
  completedRoundTrips,
  sleevesWithActivity,
  positiveSleeves,
  sleeves,
  paperOnly: true,
  realMoneyAllowed: false,
  antiRescueRule: m.antiRescueRule,
};
fs.mkdirSync(outPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ experimentId: result.experimentId, trialNumber: 22, mode, basket, completedRoundTrips, sleevesWithActivity, positiveSleeves, sleeveReturns: Object.fromEntries(symbols.map((s) => [s, sleeves[s].metrics.netReturn])) }, null, 2));
