import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { datasetHash, loadOrFetchDataset, missingBarDiagnostics } from "./lib/data.js";
import {
  backtestStaticWeights,
  backtestTsmom,
  cashComparator,
  summarizeBacktest
} from "./lib/tsmom.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..", "..");
const manifestPath = path.join(here, "manifests", "tsmom-v1.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const mode = process.argv[2] ?? "development";

if (manifest.status !== "FROZEN_BEFORE_FIRST_EVALUATION") throw new Error(`Unexpected Trial 5 manifest status: ${manifest.status}`);
if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false || manifest.liveStrategyModified !== false) {
  throw new Error("Trial 5 must remain research-only and unable to modify the live strategy");
}
if (!['development', 'diagnostic'].includes(mode)) throw new Error("Usage: node research/crypto/tsmom-evaluate.js [development|diagnostic]");

const outDir = path.join(here, "results", manifest.experimentId);
const developmentPath = path.join(outDir, "development-summary.json");
const outputPath = mode === "development"
  ? developmentPath
  : path.join(outDir, "retrospective-diagnostic-summary.json");
if (fs.existsSync(outputPath)) {
  console.log(`Frozen ${mode} result already exists at ${path.relative(rootDir, outputPath)}; refusing to overwrite.`);
  process.exit(0);
}

if (mode === "diagnostic") {
  if (!fs.existsSync(developmentPath)) throw new Error("Diagnostic is sealed until the frozen development result exists");
  const development = JSON.parse(fs.readFileSync(developmentPath, "utf8"));
  if (development.developmentGate?.pass !== true) {
    throw new Error("Trial 5 failed development; retrospective 2026 diagnostic must remain unopened");
  }
}

const evaluationStart = mode === "development"
  ? manifest.data.developmentStart
  : manifest.data.developmentEnd;
const evaluationEnd = mode === "development"
  ? manifest.data.developmentEnd
  : manifest.data.retrospectiveDiagnosticEnd;

// Fetch enough pre-evaluation history to make every 30/90/180-day signal and
// 60-day volatility estimate causal at the first eligible decision.
const acquisitionManifest = {
  ...manifest,
  data: {
    ...manifest.data,
    start: manifest.data.acquisitionStart,
    end: evaluationEnd
  }
};

console.log(`Loading official Coinbase daily candles for Trial 5 ${mode}...`);
const { dataset, cachePath, source } = await loadOrFetchDataset(acquisitionManifest, rootDir);
const sha256 = datasetHash(dataset);
const missingBars = Object.fromEntries(manifest.data.products.map((product) => [
  product,
  missingBarDiagnostics(dataset.products[product] ?? [], manifest.data.granularitySeconds)
]));

function metrics(state) {
  return summarizeBacktest(state, manifest.portfolio.startingCash, manifest.risk.annualizationDays);
}

function runRange(start, end) {
  const candidateState = backtestTsmom(dataset, manifest, { start, end, volatilityScaling: true });
  const unscaledState = backtestTsmom(dataset, manifest, { start, end, volatilityScaling: false });
  const btcState = backtestStaticWeights(dataset, manifest, {
    start,
    end,
    targetWeights: { "BTC-USD": 0.15, "ETH-USD": 0, "SOL-USD": 0 }
  });
  const equalState = backtestStaticWeights(dataset, manifest, {
    start,
    end,
    targetWeights: { "BTC-USD": 0.15, "ETH-USD": 0.15, "SOL-USD": 0.15 }
  });
  const cashState = cashComparator(manifest, start, end);
  return {
    states: { candidateState, unscaledState, btcState, equalState, cashState },
    metrics: {
      tsmom_vol_scaled: metrics(candidateState),
      tsmom_unscaled: metrics(unscaledState),
      btc_buy_hold_15pct: metrics(btcState),
      equal_weight_buy_hold_45pct: metrics(equalState),
      cash: metrics(cashState)
    }
  };
}

const full = runRange(evaluationStart, evaluationEnd);
let developmentFolds = [];
let developmentGate = null;

if (mode === "development") {
  developmentFolds = manifest.development.calendarYearFolds.map((year) => {
    const start = `${year}-01-01T00:00:00.000Z`;
    const end = `${year + 1}-01-01T00:00:00.000Z`;
    const fold = runRange(start, end);
    return { year, start, end, strategies: fold.metrics };
  });

  const candidate = full.metrics.tsmom_vol_scaled;
  const unscaled = full.metrics.tsmom_unscaled;
  const positiveYears = developmentFolds.filter((fold) => fold.strategies.tsmom_vol_scaled.netReturn > 0).length;
  const checks = [
    {
      name: "positive full development net return after frozen costs",
      pass: candidate.netReturn > 0,
      detail: `${(candidate.netReturn * 100).toFixed(2)}%`
    },
    {
      name: "positive net return in at least three of four calendar-year folds",
      pass: positiveYears >= 3,
      detail: `${positiveYears}/${developmentFolds.length}`
    },
    {
      name: "volatility scaling does not worsen maximum drawdown versus unscaled signal",
      pass: candidate.maxDrawdown >= unscaled.maxDrawdown - 1e-12,
      detail: `${(candidate.maxDrawdown * 100).toFixed(2)}% vs ${(unscaled.maxDrawdown * 100).toFixed(2)}%`
    },
    {
      name: "all turnover charged at frozen 70 bps per traded dollar",
      pass: Math.abs(candidate.transactionCostsUsd - candidate.turnoverUsd * 0.007) <= Math.max(1e-8, candidate.turnoverUsd * 1e-10),
      detail: `$${candidate.transactionCostsUsd.toFixed(2)} cost on $${candidate.turnoverUsd.toFixed(2)} turnover`
    }
  ];
  developmentGate = { pass: checks.every((check) => check.pass), checks };
}

function decisionDiagnostics(state) {
  const reasons = {};
  let missingExactLookbacks = 0;
  for (const rebalance of state.rebalances) {
    for (const [product, decision] of Object.entries(rebalance.decisions)) {
      const key = `${product}:${decision.reason}`;
      reasons[key] = (reasons[key] ?? 0) + 1;
      if (String(decision.reason).startsWith("missing_exact_")) missingExactLookbacks += 1;
    }
  }
  return { reasons, missingExactLookbacks };
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
    momentumLookbackDays: manifest.signal.momentumLookbackDays,
    realizedVolLookbackDays: manifest.risk.realizedVolLookbackDays,
    targetAnnualizedVol: manifest.risk.targetAnnualizedVol,
    maxAssetWeight: manifest.risk.maxAssetWeight,
    maxTotalExposure: manifest.risk.maxTotalExposure,
    totalBpsPerDollarTurnover: manifest.costModel.totalBpsPerDollarTurnover,
    fullEntryExitRoundTripBps: manifest.costModel.fullEntryExitRoundTripBps
  },
  strategies: full.metrics,
  candidateDecisionDiagnostics: decisionDiagnostics(full.states.candidateState),
  developmentFolds,
  developmentGate,
  interpretation: mode === "development"
    ? "A development pass permits opening the predeclared retrospective diagnostic, but cannot authorize promotion. Trial 5 promotion requires a separate >=180-day post-freeze prospective window."
    : "This 2026 retrospective diagnostic predates the Trial 5 freeze and can never authorize promotion or parameter changes."
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
console.log(`Wrote ${mode} evidence to ${path.relative(rootDir, outputPath)}`);
if (developmentGate) console.log(`Trial 5 development gate: ${developmentGate.pass ? "PASS" : "FAIL"}`);
