import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetHash, loadOrFetchDataset, missingBarDiagnostics } from './lib/data.js';
import { cashComparator } from './lib/tsmom.js';
import { backtestLowVol, backtestStaticAllocation, summarizeLowVol } from './lib/lowvol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const manifestPath = path.join(here, 'manifests', 'lowvol-v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const mode = process.argv[2] ?? 'development';

if (manifest.status !== 'FROZEN_BEFORE_FIRST_EVALUATION') throw new Error(`Unexpected Trial 6 manifest status: ${manifest.status}`);
if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false || manifest.liveStrategyModified !== false) {
  throw new Error('Trial 6 must remain research-only and unable to modify the live strategy');
}
if (!['development', 'diagnostic'].includes(mode)) throw new Error('Usage: node research/crypto/lowvol-evaluate.js [development|diagnostic]');

const outDir = path.join(here, 'results', manifest.experimentId);
const developmentPath = path.join(outDir, 'development-summary.json');
const outputPath = mode === 'development'
  ? developmentPath
  : path.join(outDir, 'retrospective-diagnostic-summary.json');
if (fs.existsSync(outputPath)) {
  console.log(`Frozen ${mode} result already exists at ${path.relative(rootDir, outputPath)}; refusing to overwrite.`);
  process.exit(0);
}
if (mode === 'diagnostic') {
  if (!fs.existsSync(developmentPath)) throw new Error('Trial 6 diagnostic is sealed until development exists');
  const development = JSON.parse(fs.readFileSync(developmentPath, 'utf8'));
  if (development.developmentGate?.pass !== true) throw new Error('Trial 6 failed development; retrospective diagnostic must remain unopened');
}

const evaluationStart = mode === 'development' ? manifest.data.developmentStart : manifest.data.developmentEnd;
const evaluationEnd = mode === 'development' ? manifest.data.developmentEnd : manifest.data.retrospectiveDiagnosticEnd;
const acquisitionManifest = {
  ...manifest,
  data: { ...manifest.data, start: manifest.data.acquisitionStart, end: evaluationEnd }
};

console.log(`Loading official Coinbase daily candles for Trial 6 ${mode}...`);
const { dataset, cachePath, source } = await loadOrFetchDataset(acquisitionManifest, rootDir);
const sha256 = datasetHash(dataset);
const missingBars = Object.fromEntries(manifest.data.products.map((product) => [
  product,
  missingBarDiagnostics(dataset.products[product] ?? [], manifest.data.granularitySeconds)
]));

function metrics(state) {
  return summarizeLowVol(state, manifest);
}

function runRange(start, end) {
  const candidateState = backtestLowVol(dataset, manifest, { start, end });
  const btcState = backtestStaticAllocation(dataset, manifest, {
    start,
    end,
    weights: { 'BTC-USD': 0.15, 'ETH-USD': 0, 'SOL-USD': 0 }
  });
  const matchedEqualState = backtestStaticAllocation(dataset, manifest, {
    start,
    end,
    weights: { 'BTC-USD': 0.05, 'ETH-USD': 0.05, 'SOL-USD': 0.05 }
  });
  const fullEqualState = backtestStaticAllocation(dataset, manifest, {
    start,
    end,
    weights: { 'BTC-USD': 0.15, 'ETH-USD': 0.15, 'SOL-USD': 0.15 }
  });
  const cashState = cashComparator(manifest, start, end);
  return {
    states: { candidateState, btcState, matchedEqualState, fullEqualState, cashState },
    metrics: {
      lowvol_90d_monthly: metrics(candidateState),
      btc_buy_hold_15pct: metrics(btcState),
      equal_weight_buy_hold_15pct_total: metrics(matchedEqualState),
      equal_weight_buy_hold_45pct_total: metrics(fullEqualState),
      cash: metrics(cashState)
    }
  };
}

const full = runRange(evaluationStart, evaluationEnd);
let developmentFolds = [];
let developmentGate = null;

if (mode === 'development') {
  developmentFolds = manifest.development.calendarYearFolds.map((year) => {
    const start = `${year}-01-01T00:00:00.000Z`;
    const end = `${year + 1}-01-01T00:00:00.000Z`;
    const fold = runRange(start, end);
    return { year, start, end, strategies: fold.metrics };
  });

  const candidate = full.metrics.lowvol_90d_monthly;
  const matched = full.metrics.equal_weight_buy_hold_15pct_total;
  const positiveYears = developmentFolds.filter((fold) => fold.strategies.lowvol_90d_monthly.netReturn > 0).length;
  const universeComplete = full.states.candidateState.rebalances.every((row) => row.eligible.length === manifest.data.products.length && row.selected);
  const chargedExactly = Math.abs(candidate.transactionCostsUsd - candidate.turnoverUsd * 0.007) <= Math.max(1e-8, candidate.turnoverUsd * 1e-10);
  const checks = [
    {
      name: 'positive full development net return after frozen costs',
      pass: candidate.netReturn > 0,
      detail: `${(candidate.netReturn * 100).toFixed(2)}%`
    },
    {
      name: 'positive net return in at least three of four calendar-year folds',
      pass: positiveYears >= 3,
      detail: `${positiveYears}/${developmentFolds.length}`
    },
    {
      name: 'annualized Sharpe exceeds matched-exposure equal-weight comparator',
      pass: candidate.annualizedSharpe > matched.annualizedSharpe,
      detail: `${candidate.annualizedSharpe.toFixed(3)} vs ${matched.annualizedSharpe.toFixed(3)}`
    },
    {
      name: 'maximum drawdown no worse than matched-exposure equal-weight comparator',
      pass: candidate.maxDrawdown >= matched.maxDrawdown - 1e-12,
      detail: `${(candidate.maxDrawdown * 100).toFixed(2)}% vs ${(matched.maxDrawdown * 100).toFixed(2)}%`
    },
    {
      name: 'every monthly decision ranks the complete fixed three-asset universe with exact 90-day history',
      pass: universeComplete,
      detail: `${full.states.candidateState.rebalances.filter((row) => row.eligible.length === manifest.data.products.length && row.selected).length}/${full.states.candidateState.rebalances.length}`
    },
    {
      name: 'all turnover charged at frozen 70 bps per traded dollar',
      pass: chargedExactly,
      detail: `$${candidate.transactionCostsUsd.toFixed(2)} cost on $${candidate.turnoverUsd.toFixed(2)} turnover`
    }
  ];
  developmentGate = { pass: checks.every((check) => check.pass), checks };
}

const selectionCounts = {};
for (const row of full.states.candidateState.rebalances) {
  const key = row.selected ?? 'NONE';
  selectionCounts[key] = (selectionCounts[key] ?? 0) + 1;
}

const summary = {
  experimentId: manifest.experimentId,
  trial: manifest.trial,
  generatedAt: new Date().toISOString(),
  mode,
  paperOnly: true,
  liveStrategyModified: false,
  manifestStatusAtEvaluation: manifest.status,
  evaluationWindow: { start: evaluationStart, end: evaluationEnd },
  data: {
    source: manifest.data.source,
    loadedFrom: source,
    cachePath: path.relative(rootDir, cachePath),
    sha256,
    products: manifest.data.products,
    granularitySeconds: manifest.data.granularitySeconds,
    missingBars
  },
  frozenDesign: {
    realizedVolLookbackDays: manifest.signal.realizedVolLookbackDays,
    selectedAssets: manifest.signal.selectedAssets,
    targetSelectedAssetWeight: manifest.portfolio.targetSelectedAssetWeight,
    totalBpsPerDollarTurnover: manifest.costModel.totalBpsPerDollarTurnover,
    fullEntryExitRoundTripBps: manifest.costModel.fullEntryExitRoundTripBps
  },
  strategies: full.metrics,
  selectionCounts,
  developmentFolds,
  developmentGate,
  interpretation: mode === 'development'
    ? 'A development pass permits opening only the predeclared retrospective diagnostic. Promotion still requires a separate >=180-day post-freeze prospective window.'
    : 'This retrospective 2026 diagnostic predates the Trial 6 freeze and cannot authorize promotion or parameter changes.'
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote ${mode} evidence to ${path.relative(rootDir, outputPath)}`);
if (developmentGate) console.log(`Trial 6 development gate: ${developmentGate.pass ? 'PASS' : 'FAIL'}`);
