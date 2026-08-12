import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backtestDailyPolicy,
  buildDailySamples,
  btcBuyHoldPolicy,
  buyHoldPolicy,
  cashBacktest,
  coefficientStability,
  foldRanges,
  median,
  performanceMetrics,
  regimeByDay,
  regimePerformance,
  ridgePolicy,
  trend30Policy,
  walkForwardPredictions
} from './lib/core.js';
import { datasetHash, loadOrFetchDataset, missingBarDiagnostics } from './lib/data.js';
import { backtestFrozenV2 } from './lib/v2-backtest.js';
import { writeReports } from './lib/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const manifestPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, 'manifests', 'crypto-oos-v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error('Research manifest must remain paper-only with live promotion disabled');
}
if (manifest.status !== 'FROZEN_BEFORE_FIRST_FINAL_EVALUATION') {
  throw new Error(`Manifest is not frozen: ${manifest.status}`);
}

const outDir = path.join(here, 'results', manifest.experimentId);
const finalSummary = path.join(outDir, 'summary.json');
if (fs.existsSync(finalSummary)) {
  console.log(`Final result already exists at ${finalSummary}; refusing to overwrite frozen evidence.`);
  process.exit(0);
}

function iso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function cloneWithSpread(base, spreadBps) {
  return {
    ...base,
    costModel: { ...base.costModel, historicalSpreadBpsRoundTrip: spreadBps }
  };
}

function assetContribution(state) {
  const pnl = {};
  for (const trade of state.closedTrades) pnl[trade.product] = (pnl[trade.product] ?? 0) + trade.pnl;
  const total = Object.values(pnl).reduce((sum, value) => sum + value, 0);
  const maxShare = total > 0 ? Math.max(0, ...Object.values(pnl).map((value) => value / total)) : null;
  return { pnl, totalRealizedPnl: total, maxProfitContributionShare: maxShare };
}

function summarize(state, regimes) {
  return {
    ...performanceMetrics(state),
    assetContribution: assetContribution(state),
    regimePerformance: regimePerformance(state, regimes)
  };
}

console.log(`Loading data for ${manifest.experimentId}...`);
const { dataset, cachePath, source } = await loadOrFetchDataset(manifest, rootDir);
const sha256 = datasetHash(dataset);
const gaps = Object.fromEntries(manifest.data.products.map((product) => [
  product,
  missingBarDiagnostics(dataset.products[product] ?? [], manifest.data.granularitySeconds)
]));
console.log(`Dataset source=${source} sha256=${sha256}`);

console.log('Building leakage-controlled daily samples and walk-forward predictions...');
const samples = buildDailySamples(dataset, manifest);
const predictions = walkForwardPredictions(samples, manifest);
const stability = coefficientStability(samples, manifest);
if (!predictions.size) throw new Error('No walk-forward predictions were generated');

const holdoutStart = manifest.validation.finalHoldoutStart;
const holdoutEnd = manifest.validation.finalHoldoutEnd;
const regimes = regimeByDay(dataset, manifest, holdoutStart, holdoutEnd);

console.log('Running untouched final holdout comparisons...');
const ridgeState = backtestDailyPolicy({
  dataset,
  manifest,
  start: holdoutStart,
  end: holdoutEnd,
  policy: ridgePolicy(predictions, manifest)
});
const trendState = backtestDailyPolicy({
  dataset,
  manifest,
  start: holdoutStart,
  end: holdoutEnd,
  policy: trend30Policy(dataset, manifest)
});
const equalState = backtestDailyPolicy({
  dataset,
  manifest,
  start: holdoutStart,
  end: holdoutEnd,
  policy: buyHoldPolicy(manifest.data.products)
});
const btcState = backtestDailyPolicy({
  dataset,
  manifest,
  start: holdoutStart,
  end: holdoutEnd,
  policy: btcBuyHoldPolicy()
});
const v2State = backtestFrozenV2(dataset, manifest, holdoutStart, holdoutEnd);
const cashState = cashBacktest(manifest, holdoutStart, holdoutEnd);

const primaryStates = {
  ridge24_cost_gate: ridgeState,
  frozen_v2: v2State,
  trend30: trendState,
  btc_buy_hold_45pct: btcState,
  equal_weight_buy_hold_45pct: equalState,
  cash: cashState
};
const primaryMetrics = Object.fromEntries(Object.entries(primaryStates).map(([name, state]) => [name, summarize(state, regimes)]));

console.log('Running predeclared development folds...');
const developmentFolds = [];
for (const range of foldRanges(manifest)) {
  const start = iso(range.start);
  const end = iso(range.end);
  const candidate = backtestDailyPolicy({ dataset, manifest, start, end, policy: ridgePolicy(predictions, manifest) });
  const v2 = backtestFrozenV2(dataset, manifest, start, end);
  developmentFolds.push({
    start,
    end,
    candidate: performanceMetrics(candidate),
    v2: performanceMetrics(v2)
  });
}

console.log('Running frozen spread sensitivity (not used for model selection)...');
const spreadStress = {};
for (const spread of manifest.costModel.spreadStressBpsRoundTrip) {
  const stressManifest = cloneWithSpread(manifest, spread);
  const state = backtestDailyPolicy({
    dataset,
    manifest: stressManifest,
    start: holdoutStart,
    end: holdoutEnd,
    policy: ridgePolicy(predictions, stressManifest)
  });
  spreadStress[String(spread)] = performanceMetrics(state);
}

const candidate = primaryMetrics.ridge24_cost_gate;
const v2 = primaryMetrics.frozen_v2;
const foldSharpes = developmentFolds.map((fold) => fold.candidate.sharpe);
const positiveFolds = developmentFolds.filter((fold) => fold.candidate.netReturn > 0).length;
const maxContribution = candidate.assetContribution.maxProfitContributionShare;
const stress35 = spreadStress['35'];
const checks = [
  { name: 'positive final-holdout net return', pass: candidate.netReturn > 0, detail: `${(candidate.netReturn * 100).toFixed(2)}%` },
  { name: 'final-holdout Sharpe greater than frozen v2', pass: candidate.sharpe > v2.sharpe, detail: `${candidate.sharpe.toFixed(3)} vs ${v2.sharpe.toFixed(3)}` },
  {
    name: 'max drawdown within 20% relative of frozen v2',
    pass: Math.abs(candidate.maxDrawdown) <= Math.max(1e-9, Math.abs(v2.maxDrawdown) * 1.2),
    detail: `${(candidate.maxDrawdown * 100).toFixed(2)}% vs ${(v2.maxDrawdown * 100).toFixed(2)}%`
  },
  {
    name: 'development median fold Sharpe positive',
    pass: developmentFolds.length > 0 && median(foldSharpes) > 0,
    detail: developmentFolds.length ? median(foldSharpes).toFixed(3) : 'no folds'
  },
  {
    name: 'positive net return in majority of development folds',
    pass: developmentFolds.length > 0 && positiveFolds > developmentFolds.length / 2,
    detail: `${positiveFolds}/${developmentFolds.length}`
  },
  {
    name: 'no asset contributes more than 70% of realized profit',
    pass: maxContribution !== null && maxContribution <= 0.70,
    detail: maxContribution === null ? 'candidate realized profit <= 0' : `${(maxContribution * 100).toFixed(1)}% max share`
  },
  {
    name: 'positive net return at 35 bps spread stress',
    pass: Boolean(stress35) && stress35.netReturn > 0,
    detail: stress35 ? `${(stress35.netReturn * 100).toFixed(2)}%` : 'missing stress run'
  }
];

const summary = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  paperOnly: true,
  liveStrategyModified: false,
  manifestStatusAtEvaluation: manifest.status,
  dataset: {
    source: manifest.data.source,
    cachePath: path.relative(rootDir, cachePath),
    loadedFrom: source,
    sha256,
    products: manifest.data.products,
    start: manifest.data.start,
    end: manifest.data.end,
    missingBars: gaps,
    sampleRows: samples.length,
    predictionDays: predictions.size
  },
  multipleTesting: {
    seriousCandidateConfigurationsAttempted: manifest.multipleTesting.seriousCandidateConfigurationsAttemptedBeforeThisEvaluation,
    deflatedSharpe: null,
    note: 'DSR is intentionally not presented as meaningful with only one serious candidate configuration. The global trial ledger must be incremented for every successor.'
  },
  finalHoldout: {
    start: holdoutStart,
    end: holdoutEnd,
    strategies: Object.fromEntries(Object.entries(primaryMetrics).map(([name, metrics]) => {
      const { regimePerformance: _regimes, ...rest } = metrics;
      return [name, rest];
    })),
    regimes: Object.fromEntries(Object.entries(primaryMetrics).map(([name, metrics]) => [name, metrics.regimePerformance]))
  },
  developmentFolds,
  spreadStress,
  modelStability: stability.features,
  promotion: { pass: checks.every((check) => check.pass), checks }
};

const predictionDiagnostics = {
  featureNames: stability.features.map((row) => row.feature),
  modelStability: stability,
  holdoutPredictions: [...predictions.entries()]
    .filter(([time]) => time >= Date.parse(holdoutStart) / 1000 && time < Date.parse(holdoutEnd) / 1000)
    .map(([time, rows]) => ({ time: iso(time), rows: rows.map((row) => ({ product: row.product, prediction: row.prediction, target: row.target, trainingRows: row.trainingRows })) }))
};

writeReports(outDir, { summary, predictionDiagnostics, states: primaryStates });
console.log(`Wrote frozen result bundle to ${path.relative(rootDir, outDir)}`);
console.log(`Promotion gate: ${summary.promotion.pass ? 'PASS' : 'FAIL'}`);
