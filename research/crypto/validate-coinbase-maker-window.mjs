import fs from 'node:fs';
import path from 'node:path';

const manifestPath = 'research/crypto/manifests/coinbase-maker-execution-v1.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const summaryPaths = process.argv.slice(2);
if (summaryPaths.length !== manifest.venue.products.length) {
  throw new Error(`Expected exactly ${manifest.venue.products.length} per-product maker summary files`);
}

const summaries = summaryPaths.map((summaryPath) => ({
  path: path.resolve(summaryPath),
  value: JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
}));
const byProduct = new Map();
for (const item of summaries) {
  const summary = item.value;
  if (summary.experimentId !== manifest.experimentId || summary.paperOnly !== true || summary.strategyTrial !== false) {
    throw new Error(`Unexpected execution summary: ${item.path}`);
  }
  const product = summary.input?.product;
  if (!manifest.venue.products.includes(product)) throw new Error(`Unexpected/missing product in ${item.path}: ${product}`);
  if (byProduct.has(product)) throw new Error(`Duplicate product summary: ${product}`);
  if (summary.input?.rawHashVerified !== true) throw new Error(`Raw SHA-256 not verified for ${product}`);
  if (summary.recording?.classification !== 'SCIENTIFIC_WINDOW') {
    throw new Error(`${product} is not a SCIENTIFIC_WINDOW: ${summary.recording?.classification}`);
  }
  byProduct.set(product, item);
}

const missing = manifest.venue.products.filter((product) => !byProduct.has(product));
if (missing.length) throw new Error(`Missing scientific product summaries: ${missing.join(', ')}`);

function weightedMean(items, valuePath, weightPath) {
  let weighted = 0;
  let totalWeight = 0;
  for (const summary of items) {
    const value = valuePath(summary);
    const weight = weightPath(summary);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

const ordered = manifest.venue.products.map((product) => byProduct.get(product).value);
const totalEligibleOrders = ordered.reduce((sum, summary) => sum + (summary.groups.aggregate.eligibleOrders ?? 0), 0);
const totalFilledOrders = ordered.reduce((sum, summary) => sum + (summary.groups.aggregate.filledOrders ?? 0), 0);
const perProduct = Object.fromEntries(ordered.map((summary) => [summary.input.product, {
  rawSha256: summary.input.rawSha256,
  recording: summary.recording,
  aggregateExecution: summary.groups.aggregate
}]));

const markoutSeconds = manifest.markouts.secondsAfterFill;
const combined = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  status: 'SCIENTIFIC_WINDOW_VALIDATED',
  paperOnly: true,
  livePromotionAllowed: false,
  strategyTrial: false,
  products: manifest.venue.products,
  inputSummaries: summaries.map((item) => item.path),
  combinedCounts: {
    eligibleOrders: totalEligibleOrders,
    filledOrders: totalFilledOrders,
    fillRate: totalEligibleOrders > 0 ? totalFilledOrders / totalEligibleOrders : null
  },
  filledOrderWeightedMeans: {
    effectiveCostVsArrivalMidBps: weightedMean(
      ordered,
      (summary) => summary.groups.aggregate.meanEffectiveCostVsArrivalMidBps,
      (summary) => summary.groups.aggregate.filledOrders
    ),
    savingsVsImmediateTakerBpsConditionalOnFill: weightedMean(
      ordered,
      (summary) => summary.groups.aggregate.meanSavingsVsImmediateTakerBps,
      (summary) => summary.groups.aggregate.filledOrders
    ),
    markoutBps: Object.fromEntries(markoutSeconds.map((seconds) => [String(seconds), weightedMean(
      ordered,
      (summary) => summary.groups.aggregate.markoutBps?.[String(seconds)]?.mean,
      (summary) => summary.groups.aggregate.markoutBps?.[String(seconds)]?.n
    )]))
  },
  perProduct,
  interpretationConstraint: 'Combined metrics are descriptive across the three frozen product recordings. Product/side/notional subsets may not be selected post hoc as a deployment policy. Non-fill opportunity cost is not converted into alpha P&L by this execution-only experiment.',
  antiSelectionRule: manifest.antiSelectionRule
};

const outputPath = path.resolve('research/crypto/results/coinbase-maker-execution-v1/SCIENTIFIC_SUMMARY.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing scientific E1 result: ${outputPath}`);
fs.writeFileSync(outputPath, `${JSON.stringify(combined, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...combined }, null, 2));
