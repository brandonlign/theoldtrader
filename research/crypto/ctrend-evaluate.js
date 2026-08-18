#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  CTREND_SIGNAL_NAMES,
  buildCtrendPanel,
  mean,
  stdev,
  weeklyDecisionTimes
} from './lib/ctrend.js';
import { walkForwardCtrendWindowedPredictions } from './lib/ctrend-windowed.js';
import { simulateCrossSectionalPortfolio } from './lib/cross-sectional-portfolio.js';
import { performanceMetrics } from './lib/metrics.js';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(file) {
  const raw = fs.readFileSync(file);
  const payload = file.endsWith('.gz') ? gunzipSync(raw) : raw;
  return JSON.parse(payload.toString('utf8'));
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function iso(time) {
  return new Date(time * 1000).toISOString();
}

function gateLog(manifest) {
  return Math.log1p(Math.max(0, finite(manifest?.costModel?.roundTripCostBps, 140)) / 10_000);
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

function indexedProducts(dataset) {
  return Object.fromEntries(Object.entries(dataset?.products ?? {}).map(([symbol, rows]) => {
    const sorted = [...rows].sort((a, b) => finite(a.time) - finite(b.time));
    return [symbol, new Map(sorted.map((row) => [finite(row.time), row]))];
  }));
}

export function buildWeeklyMomentumPredictions(dataset, membership, manifest, startIso, endExclusiveIso) {
  const products = indexedProducts(dataset);
  const gate = gateLog(manifest);
  const result = new Map();
  for (const time of weeklyDecisionTimes(startIso, endExclusiveIso)) {
    const ranked = [];
    for (const symbol of membership) {
      const index = products[symbol];
      if (!index) continue;
      const open = finite(index.get(time)?.open, NaN);
      const recent = finite(index.get(time - 86400)?.close, NaN);
      const old = finite(index.get(time - 22 * 86400)?.close, NaN);
      if (!(open > 0) || !(recent > 0) || !(old > 0)) continue;
      ranked.push({ symbol, score: Math.log(recent / old), open });
    }
    ranked.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    const rows = ranked.map((row, index) => ({
      symbol: row.symbol,
      open: row.open,
      prediction: gate + 1 + (ranked.length - index) * 1e-6,
      comparatorScore: row.score
    }));
    if (rows.length) result.set(time, { time, trainingRows: 0, trainingWeeks: 0, rows });
  }
  return result;
}

function singleEntryPredictions(symbols, startIso, manifest) {
  const time = Math.floor(Date.parse(startIso) / 1000);
  const gate = gateLog(manifest);
  return new Map([[time, {
    time,
    trainingRows: 0,
    trainingWeeks: 0,
    rows: symbols.map((symbol, index) => ({
      symbol,
      prediction: gate + 1 + (symbols.length - index) * 1e-6
    }))
  }]]);
}

export function thirteenWeekFoldRanges(startIso, endExclusiveIso) {
  const start = Math.floor(Date.parse(startIso) / 1000);
  const end = Math.floor(Date.parse(endExclusiveIso) / 1000);
  const width = 13 * 7 * 86400;
  const ranges = [];
  for (let cursor = start; cursor + width <= end; cursor += width) {
    ranges.push([iso(cursor), iso(cursor + width)]);
  }
  return ranges;
}

function foldMetrics(dataset, predictions, manifest, startIso, endExclusiveIso) {
  return thirteenWeekFoldRanges(startIso, endExclusiveIso).map(([foldStart, foldEnd]) => {
    const simulation = simulateCrossSectionalPortfolio(dataset, predictions, manifest, foldStart, foldEnd);
    return { start: foldStart, endExclusive: foldEnd, ...summarizeState(simulation.state, manifest) };
  });
}

export function signalSelectionFrequency(predictions) {
  const counts = Object.fromEntries(CTREND_SIGNAL_NAMES.map((name) => [name, 0]));
  let predictionWeeks = 0;
  for (const record of predictions.values()) {
    predictionWeeks += 1;
    for (const name of record.selectedSignals ?? []) counts[name] += 1;
  }
  return CTREND_SIGNAL_NAMES.map((signal) => ({
    signal,
    selectedWeeks: counts[signal],
    predictionWeeks,
    selectionRate: predictionWeeks ? counts[signal] / predictionWeeks : 0
  }));
}

function firstStageStability(predictions) {
  return CTREND_SIGNAL_NAMES.map((signal, index) => {
    const slopes = [...predictions.values()]
      .map((record) => record.firstStageModels?.[index]?.slope)
      .filter(Number.isFinite);
    const intercepts = [...predictions.values()]
      .map((record) => record.firstStageModels?.[index]?.intercept)
      .filter(Number.isFinite);
    return {
      signal,
      observations: slopes.length,
      meanSlope: slopes.length ? mean(slopes) : 0,
      slopeStdev: slopes.length > 1 ? stdev(slopes, true) : 0,
      minSlope: slopes.length ? Math.min(...slopes) : 0,
      maxSlope: slopes.length ? Math.max(...slopes) : 0,
      meanIntercept: intercepts.length ? mean(intercepts) : 0
    };
  });
}

function performanceByBtcRegime(state, dataset) {
  const btcRows = [...(dataset?.products?.BTCUSDT ?? [])].sort((a, b) => finite(a.time) - finite(b.time));
  const btc = new Map(btcRows.map((row) => [finite(row.time), row]));
  const groups = new Map();
  let previousEquity = null;
  for (const point of state.equitySeries ?? []) {
    const time = finite(point.time);
    const equity = finite(point.value);
    if (!(equity > 0)) continue;
    const recent = finite(btc.get(time - 86400)?.close, NaN);
    const old = finite(btc.get(time - 91 * 86400)?.close, NaN);
    const regime = recent > 0 && old > 0
      ? (Math.log(recent / old) > 0 ? 'btc90_positive' : 'btc90_nonpositive')
      : 'unavailable';
    if (previousEquity !== null) {
      if (!groups.has(regime)) groups.set(regime, []);
      groups.get(regime).push(equity / previousEquity - 1);
    }
    previousEquity = equity;
  }
  return Object.fromEntries([...groups.entries()].map(([key, returns]) => {
    const sd = returns.length > 1 ? stdev(returns, true) : 0;
    return [key, {
      days: returns.length,
      compoundedReturn: returns.reduce((capital, value) => capital * (1 + value), 1) - 1,
      meanDailyReturn: returns.length ? mean(returns) : 0,
      sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0
    }];
  }));
}

function validateInputs(manifest, universe, dataset, mode) {
  if (manifest.experimentId !== 'ctrend-v1' || manifest.trialNumber !== 4) throw new Error('Expected frozen ctrend-v1 Trial 4 manifest');
  if (manifest.livePromotionAllowed !== false || manifest.paperOnly !== true) throw new Error('Trial 4 safety flags changed');
  if (manifest.model.minimumHistoryWeeks !== 52 || manifest.model.minimumEligibleAssetsPerWeek !== 10) throw new Error('Trial 4 rolling-window constants changed');
  if (manifest.costModel.roundTripCostBps !== 140) throw new Error('Trial 4 frozen cost hurdle changed');
  if (universe.experimentId !== 'cross-sectional-v1' || universe.status !== 'UNIVERSE_FORMED_PRE_DEVELOPMENT') {
    throw new Error('Trial 4 requires the immutable Trial 3 2022-only universe');
  }
  if (universe.postFormationDataInspected !== false) throw new Error('Universe formation firewall marker changed');
  if (!Array.isArray(universe.membership) || universe.membership.length !== manifest.universe.membershipSize || new Set(universe.membership).size !== universe.membership.length) {
    throw new Error('Frozen Trial 4 membership size/uniqueness mismatch');
  }
  if (dataset.experimentId !== 'ctrend-v1' || dataset.universeExperimentId !== 'cross-sectional-v1') throw new Error('Trial 4 dataset identity mismatch');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Dataset membership differs from frozen universe');
  if (dataset.formationSourceManifestSha256 !== universe.formationSourceManifestSha256) throw new Error('Formation-source hash mismatch');

  const finalStart = manifest.historicalData.finalHoldoutStart;
  if (mode === 'development') {
    if (dataset.acquisitionMode !== 'development') throw new Error('Development evaluator requires a development-only dataset');
    if (dataset.endExclusive !== finalStart) throw new Error('Development dataset must stop exactly at the frozen final-holdout boundary');
    for (const [symbol, rows] of Object.entries(dataset.products ?? {})) {
      if (rows.some((row) => finite(row.time) >= Date.parse(finalStart) / 1000)) throw new Error(`Development dataset contains forbidden holdout row for ${symbol}`);
    }
  } else {
    if (dataset.acquisitionMode !== 'final') throw new Error('Final evaluator requires the separately acquired final dataset');
    if (dataset.endExclusive !== manifest.historicalData.finalHoldoutEndExclusive) throw new Error('Final dataset end does not match frozen holdout end');
  }
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

export function evaluateCtrend(args) {
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite existing Trial 4 result: ${args.out}`);
  const manifest = readJson(args.manifest);
  const universe = readJson(args.universe);
  const dataset = readJson(args.data);
  validateInputs(manifest, universe, dataset, args.mode);

  const panel = buildCtrendPanel(dataset, manifest, universe.membership);
  const isFinal = args.mode === 'final';
  const startIso = isFinal ? manifest.historicalData.finalHoldoutStart : manifest.historicalData.developmentStart;
  const endIso = isFinal ? manifest.historicalData.finalHoldoutEndExclusive : manifest.historicalData.developmentEndExclusive;
  const candidatePredictions = walkForwardCtrendWindowedPredictions(panel, manifest, startIso, endIso);
  if (!candidatePredictions.size) throw new Error(`No Trial 4 predictions available for ${args.mode}`);

  const candidate = simulateCrossSectionalPortfolio(dataset, candidatePredictions, manifest, startIso, endIso);
  const momentumPredictions = buildWeeklyMomentumPredictions(dataset, universe.membership, manifest, startIso, endIso);
  const momentum = simulateCrossSectionalPortfolio(dataset, momentumPredictions, manifest, startIso, endIso);
  const staticTop = (universe.eligibleRanking ?? []).slice(0, 3).map((row) => row.symbol);
  if (staticTop.length !== 3) throw new Error('Frozen universe lacks the top-three 2022 liquidity ranking');
  const staticLiquidity = simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(staticTop, startIso, manifest), manifest, startIso, endIso);
  const btc = dataset.products.BTCUSDT
    ? simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(['BTCUSDT'], startIso, manifest), manifest, startIso, endIso)
    : null;
  const majors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].filter((symbol) => dataset.products[symbol]);
  const majorBuyHold = majors.length === 3
    ? simulateCrossSectionalPortfolio(dataset, singleEntryPredictions(majors, startIso, manifest), manifest, startIso, endIso)
    : null;
  const cash = simulateCrossSectionalPortfolio(dataset, new Map(), manifest, startIso, endIso);

  const folds = args.mode === 'development' ? foldMetrics(dataset, candidatePredictions, manifest, startIso, endIso) : [];
  const foldReturns = folds.map((fold) => fold.netReturn);
  const foldSharpes = folds.map((fold) => fold.sharpe);
  const firstPredictionTime = Math.min(...candidatePredictions.keys());

  const result = {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    mode: args.mode,
    generatedAt: new Date().toISOString(),
    start: startIso,
    endExclusive: endIso,
    firstPrediction: iso(firstPredictionTime),
    frozenUniverseSize: universe.membership.length,
    panelRows: panel.length,
    predictionWeeks: candidatePredictions.size,
    candidate: summarizeState(candidate.state, manifest),
    comparators: {
      cash: summarizeState(cash.state, manifest),
      btc15pctBuyHold: btc ? summarizeState(btc.state, manifest) : null,
      btcEthSol45pctEqualWeightBuyHold: majorBuyHold ? summarizeState(majorBuyHold.state, manifest) : null,
      sameUniverse21dMomentumTop3Weekly: summarizeState(momentum.state, manifest),
      formationLiquidityTop3StaticBuyHold: summarizeState(staticLiquidity.state, manifest)
    },
    developmentFolds: folds,
    developmentFoldSummary: folds.length ? {
      medianSharpe: median(foldSharpes),
      positiveSharpeFolds: foldSharpes.filter((value) => value > 0).length,
      positiveReturnFolds: foldReturns.filter((value) => value > 0).length,
      totalFolds: folds.length
    } : null,
    performanceByRegime: performanceByBtcRegime(candidate.state, dataset),
    signalSelectionFrequency: signalSelectionFrequency(candidatePredictions),
    perSignalFirstStageStability: firstStageStability(candidatePredictions),
    decisions: candidate.decisions.map((decision) => ({ ...decision, timeIso: iso(decision.time) })),
    implementationFreeze: {
      authoritativeEstimator: 'walkForwardCtrendWindowedPredictions',
      estimatorWindowWeeks: 52,
      indicatorContinuityDays: 201,
      elasticNetAlpha: 0.5,
      lambdaGridPoints: 50,
      lambdaMinRatio: 1e-4,
      maxIterations: 10000,
      convergenceTolerance: 1e-9,
      positiveCoefficientThreshold: 1e-10,
      featureStandardization: 'training-sample only',
      finalCombination: 'equal average of first-stage forecasts selected by strictly positive elastic-net coefficient',
      momentumComparator: 'strict prior 21-day log return using closes at t-1d and t-22d; top-three rank weekly; identical portfolio costs/sizing; no candidate forecast hurdle',
      holdoutFirewall: 'development dataset must contain zero rows at or after 2026-01-01; final mode requires separate final dataset and --confirm-final YES'
    }
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}

function main() {
  const args = parseArgs(process.argv);
  const result = evaluateCtrend(args);
  console.log(JSON.stringify({
    out: args.out,
    mode: args.mode,
    firstPrediction: result.firstPrediction,
    candidate: result.candidate,
    developmentFoldSummary: result.developmentFoldSummary
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
