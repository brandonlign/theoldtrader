#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  buildCrossSectionalPanel,
  costGateLogThreshold,
  walkForwardCrossSectionalPredictions
} from './lib/cross-sectional.js';
import { simulateCrossSectionalPortfolio } from './lib/cross-sectional-portfolio.js';
import { performanceMetrics } from './lib/metrics.js';

const FEATURE_NAMES = [
  'momentum_30d',
  'momentum_90d',
  'realized_vol_30d',
  'log_median_quote_volume_30d',
  'amihud_illiquidity_30d',
  'asset_age_log_days'
];

function readJson(file) {
  const raw = fs.readFileSync(file);
  const payload = file.endsWith('.gz') ? gunzipSync(raw) : raw;
  return JSON.parse(payload.toString('utf8'));
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function stdev(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const mu = mean(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (clean.length - 1));
}

function iso(time) {
  return new Date(time * 1000).toISOString();
}

function utcMonthStart(time) {
  const date = new Date(time * 1000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
}

function performanceByRegime(state, dataset, manifest) {
  const btcRows = [...(dataset?.products?.BTCUSDT ?? [])].sort((a, b) => a.time - b.time);
  const btc = new Map(btcRows.map((row) => [Number(row.time), row]));
  const regimeCache = new Map();

  function regime(time) {
    const month = utcMonthStart(time);
    if (regimeCache.has(month)) return regimeCache.get(month);
    const history = [];
    for (let lag = 91; lag >= 1; lag -= 1) {
      const row = btc.get(month - lag * 86400);
      if (!row || !(Number(row.close) > 0)) {
        regimeCache.set(month, 'unavailable');
        return 'unavailable';
      }
      history.push(Number(row.close));
    }
    const momentum90 = Math.log(history.at(-1) / history[0]);
    const value = momentum90 > 0 ? 'btc90_positive' : 'btc90_nonpositive';
    regimeCache.set(month, value);
    return value;
  }

  const groups = new Map();
  let previous = Number(manifest.portfolio.startingCash ?? 10_000);
  for (const point of state.equitySeries ?? []) {
    const value = Number(point.value);
    const dailyReturn = value / previous - 1;
    previous = value;
    const key = regime(Number(point.time));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(dailyReturn);
  }

  return Object.fromEntries([...groups.entries()].map(([key, returns]) => {
    const sd = stdev(returns);
    return [key, {
      days: returns.length,
      compoundedReturn: returns.reduce((capital, value) => capital * (1 + value), 1) - 1,
      meanDailyReturn: mean(returns),
      sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0
    }];
  }));
}

function summarizeState(state, manifest) {
  const metrics = performanceMetrics(state, manifest.portfolio.startingCash);
  const realizedByAsset = { ...state.realizedByAsset };
  const perAssetContribution = { ...realizedByAsset };
  for (const [symbol, position] of state.positions) {
    perAssetContribution[symbol] = (perAssetContribution[symbol] ?? 0)
      + position.units * position.lastPrice - position.costBasis;
  }
  return {
    ...metrics,
    numberOfTrades: metrics.orderCount,
    expectancyPerClosedPosition: metrics.expectancyPerTrade,
    forcedExits: state.forcedExits,
    realizedByAsset,
    perAssetContribution
  };
}

function buildRankBaselinePredictions(panel, startIso, endIso, scoreIndex, manifest) {
  const start = Date.parse(startIso) / 1000;
  const end = Date.parse(endIso) / 1000;
  const gate = costGateLogThreshold(manifest);
  const map = new Map();
  for (const time of [...new Set(panel.map((row) => row.time))].sort((a, b) => a - b)) {
    if (time < start || time >= end) continue;
    const rows = panel.filter((row) => row.time === time);
    const ranked = [...rows].sort((left, right) => right.rawFeatures[scoreIndex] - left.rawFeatures[scoreIndex] || left.symbol.localeCompare(right.symbol));
    const synthetic = ranked.map((row, index) => ({
      ...row,
      // All eligible rows deliberately clear the candidate's cost filter so this comparator is
      // exactly a top-three rank baseline, not a second cost-gated strategy.
      prediction: gate + 1 + (ranked.length - index) * 1e-6
    }));
    map.set(time, { time, trainingRows: 0, trainingMonths: 0, rows: synthetic });
  }
  return map;
}

function singleEntryPredictions(symbols, startIso, manifest) {
  const time = Date.parse(startIso) / 1000;
  const gate = costGateLogThreshold(manifest);
  return new Map([[time, {
    time,
    trainingRows: 0,
    trainingMonths: 0,
    rows: symbols.map((symbol, index) => ({ symbol, prediction: gate + 1 + (symbols.length - index) * 1e-6 }))
  }]]);
}

function coefficientStability(predictions) {
  const models = [...predictions.values()].map((entry) => entry.model).filter(Boolean);
  return FEATURE_NAMES.map((name, index) => {
    const values = models.map((model) => model.coefficients[index]).filter(Number.isFinite);
    return { feature: name, mean: mean(values), stdev: stdev(values), min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 };
  });
}

function sixMonthFoldRanges(startIso, endExclusiveIso) {
  const out = [];
  let cursor = new Date(startIso);
  const end = new Date(endExclusiveIso);
  while (cursor < end) {
    const foldStart = new Date(cursor);
    const foldEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 6, 1));
    if (foldEnd > end) break;
    out.push([foldStart.toISOString(), foldEnd.toISOString()]);
    cursor = foldEnd;
  }
  return out;
}

function foldMetrics(dataset, predictions, manifest, startIso, endIso) {
  return sixMonthFoldRanges(startIso, endIso).map(([foldStart, foldEnd]) => {
    const simulation = simulateCrossSectionalPortfolio(dataset, predictions, manifest, foldStart, foldEnd);
    return { start: foldStart, endExclusive: foldEnd, ...summarizeState(simulation.state, manifest) };
  });
}

function validateInputs(manifest, universe, dataset) {
  if (manifest.experimentId !== 'cross-sectional-v1' || manifest.trialNumber !== 3) throw new Error('Wrong Trial 3 manifest');
  if (universe.experimentId !== manifest.experimentId || universe.status !== 'UNIVERSE_FORMED_PRE_DEVELOPMENT') {
    throw new Error('Trial 3 frozen universe is absent or not in the required immutable state');
  }
  if (universe.postFormationDataInspected !== false) throw new Error('Universe firewall marker is not false');
  if (!Array.isArray(universe.membership) || universe.membership.length !== manifest.universeFormation.membershipSize) {
    throw new Error('Frozen membership size mismatch');
  }
  if (new Set(universe.membership).size !== universe.membership.length) throw new Error('Frozen membership contains duplicates');
  if (dataset.experimentId !== manifest.experimentId) throw new Error('Dataset experiment mismatch');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Dataset membership differs from frozen universe');
  if (dataset.formationSourceManifestSha256 !== universe.formationSourceManifestSha256) throw new Error('Formation-source hash mismatch');
}

function parseArgs(argv) {
  const values = { mode: 'development' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    values[key.slice(2)] = argv[++i];
  }
  for (const required of ['manifest', 'universe', 'data', 'out']) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  if (!['development', 'final'].includes(values.mode)) throw new Error('--mode must be development or final');
  if (values.mode === 'final' && values['confirm-final'] !== 'YES') {
    throw new Error('Final holdout is one-shot protected; pass --confirm-final YES explicitly');
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite existing Trial 3 result: ${args.out}`);

  const manifest = readJson(args.manifest);
  const universe = readJson(args.universe);
  const dataset = readJson(args.data);
  validateInputs(manifest, universe, dataset);

  const panel = buildCrossSectionalPanel(dataset, manifest, universe.membership);
  const isFinal = args.mode === 'final';
  const startIso = isFinal ? manifest.historicalData.finalHoldoutStart : '2024-01-01T00:00:00Z';
  const endIso = isFinal ? manifest.historicalData.finalHoldoutEndExclusive : manifest.historicalData.developmentEndExclusive;
  const candidatePredictions = walkForwardCrossSectionalPredictions(panel, manifest, startIso, endIso);
  if (!candidatePredictions.size) throw new Error(`No candidate predictions available for ${args.mode}`);

  const candidate = simulateCrossSectionalPortfolio(dataset, candidatePredictions, manifest, startIso, endIso);
  const momentumPredictions = buildRankBaselinePredictions(panel, startIso, endIso, 1, manifest);
  const momentum = simulateCrossSectionalPortfolio(dataset, momentumPredictions, manifest, startIso, endIso);

  const staticTop = (universe.eligibleRanking ?? []).slice(0, 3).map((row) => row.symbol);
  if (staticTop.length !== 3) throw new Error('Frozen universe lacks the top-three formation-liquidity ranking');
  const staticLiquidity = simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(staticTop, startIso, manifest), manifest, startIso, endIso);

  const btc = dataset.products.BTCUSDT
    ? simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(['BTCUSDT'], startIso, manifest), manifest, startIso, endIso)
    : null;
  const majors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].filter((symbol) => dataset.products[symbol]);
  const majorBuyHold = majors.length === 3
    ? simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(majors, startIso, manifest), manifest, startIso, endIso)
    : null;
  const cash = simulateCrossSectionalPortfolio(dataset, new Map(), manifest, startIso, endIso);

  const folds = args.mode === 'development'
    ? foldMetrics(dataset, candidatePredictions, manifest, startIso, endIso)
    : [];
  const foldSharpes = folds.map((fold) => fold.sharpe);
  const foldReturns = folds.map((fold) => fold.netReturn);

  const result = {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    mode: args.mode,
    generatedAt: new Date().toISOString(),
    start: startIso,
    endExclusive: endIso,
    frozenUniverseSize: universe.membership.length,
    panelRows: panel.length,
    predictionMonths: candidatePredictions.size,
    candidate: summarizeState(candidate.state, manifest),
    comparators: {
      cash: summarizeState(cash.state, manifest),
      btc15pctBuyHold: btc ? summarizeState(btc.state, manifest) : null,
      btcEthSol45pctEqualWeightBuyHold: majorBuyHold ? summarizeState(majorBuyHold.state, manifest) : null,
      sameUniverse90dMomentumTop3Monthly: summarizeState(momentum.state, manifest),
      formationLiquidityTop3StaticBuyHold: summarizeState(staticLiquidity.state, manifest)
    },
    developmentFolds: folds,
    developmentFoldSummary: folds.length ? {
      medianSharpe: median(foldSharpes),
      positiveSharpeFolds: foldSharpes.filter((value) => value > 0).length,
      positiveReturnFolds: foldReturns.filter((value) => value > 0).length,
      totalFolds: folds.length
    } : null,
    performanceByRegime: performanceByRegime(candidate.state, dataset, manifest),
    coefficientStability: coefficientStability(candidatePredictions),
    decisions: candidate.decisions.map((decision) => ({ ...decision, timeIso: iso(decision.time) })),
    implementationFreeze: {
      quantileMethod: 'linear interpolation at (n-1)*p',
      featureContinuity: 'exact prior UTC daily bars required; a gap makes the asset ineligible at that rebalance',
      ridge: 'intercept unpenalized; six already cross-section-z-scored features are not re-standardized in pooled training',
      costGate: 'predicted log return must exceed log(1 + frozen roundTripCostBps/10000)',
      embargo: 'training labels must end on or before the previous calendar-month rebalance boundary',
      regimeDefinition: 'BTCUSDT strictly prior 90-day log-return sign at each UTC calendar-month boundary; exact daily continuity required; positive vs non-positive; unavailable kept separate',
      momentumComparator: 'rank top three by raw 90d momentum each month with identical sizing/friction but no candidate cost gate',
      staticComparator: 'enter frozen top-three 2022-liquidity members once at evaluation start and do not rebalance'
    }
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ out: args.out, mode: args.mode, candidate: result.candidate, developmentFoldSummary: result.developmentFoldSummary }, null, 2));
}

main();
