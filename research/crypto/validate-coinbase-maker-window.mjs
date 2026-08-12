import fs from 'node:fs';
import path from 'node:path';

const manifestPath = 'research/crypto/manifests/coinbase-maker-execution-v1.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const args = process.argv.slice(2);
const expectedFiles = manifest.venue.products.length * 2;
if (args.length !== expectedFiles) {
  throw new Error(`Expected ${expectedFiles} files as <maker-summary> <integrity-audit> pairs for ${manifest.venue.products.length} products`);
}

function weightedMean(items, valuePath, weightPath) {
  let weighted = 0;
  let totalWeight = 0;
  for (const item of items) {
    const value = valuePath(item);
    const weight = weightPath(item);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

const byProduct = new Map();
for (let i = 0; i < args.length; i += 2) {
  const summaryPath = path.resolve(args[i]);
  const auditPath = path.resolve(args[i + 1]);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

  if (summary.experimentId !== manifest.experimentId || summary.paperOnly !== true || summary.strategyTrial !== false) {
    throw new Error(`Unexpected maker summary: ${summaryPath}`);
  }
  if (audit.experimentId !== manifest.experimentId || audit.paperOnly !== true || audit.auditType !== 'INDEPENDENT_FEED_INTEGRITY_AND_FULL_BOOK_TAKER') {
    throw new Error(`Unexpected integrity audit: ${auditPath}`);
  }
  const product = summary.input?.product;
  if (!manifest.venue.products.includes(product)) throw new Error(`Unexpected/missing product in ${summaryPath}: ${product}`);
  if (audit.product !== product) throw new Error(`Summary/audit product mismatch: ${product} vs ${audit.product}`);
  if (byProduct.has(product)) throw new Error(`Duplicate product pair: ${product}`);
  if (summary.input?.rawHashVerified !== true) throw new Error(`Maker summary raw SHA-256 not verified for ${product}`);
  if (audit.raw?.rawHashVerified !== true) throw new Error(`Independent audit raw SHA-256 not verified for ${product}`);
  if (summary.input?.rawSha256 !== audit.raw?.rawSha256) throw new Error(`Independent raw hash mismatch for ${product}`);
  if (summary.recording?.classification !== 'SCIENTIFIC_WINDOW') {
    throw new Error(`${product} maker summary is not a SCIENTIFIC_WINDOW: ${summary.recording?.classification}`);
  }
  if (audit.integrity?.scientificIntegrityPass !== true) {
    throw new Error(`${product} failed independent scientific integrity audit`);
  }
  byProduct.set(product, { summaryPath, auditPath, summary, audit });
}

const missing = manifest.venue.products.filter((product) => !byProduct.has(product));
if (missing.length) throw new Error(`Missing scientific product pairs: ${missing.join(', ')}`);

const ordered = manifest.venue.products.map((product) => byProduct.get(product));
const totalEligibleOrders = ordered.reduce((sum, item) => sum + (item.summary.groups.aggregate.eligibleOrders ?? 0), 0);
const totalFilledOrders = ordered.reduce((sum, item) => sum + (item.summary.groups.aggregate.filledOrders ?? 0), 0);
const totalTakerDepthAvailable = ordered.reduce((sum, item) => sum + (item.audit.fullBookTakerComparator.takerDepthAvailableOrders ?? 0), 0);
const totalFullBookComparableFills = ordered.reduce((sum, item) => sum + (item.audit.fullBookTakerComparator.filledOrdersWithFullBookComparator ?? 0), 0);
const markoutSeconds = manifest.markouts.secondsAfterFill;

const perProduct = Object.fromEntries(ordered.map((item) => [item.summary.input.product, {
  rawSha256: item.summary.input.rawSha256,
  makerRecording: item.summary.recording,
  independentIntegrity: item.audit.integrity,
  aggregateMakerExecution: item.summary.groups.aggregate,
  fullBookTakerComparator: item.audit.fullBookTakerComparator,
  summaryPath: item.summaryPath,
  auditPath: item.auditPath
}]));

const combined = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  status: 'SCIENTIFIC_WINDOW_VALIDATED_WITH_INDEPENDENT_AUDIT',
  paperOnly: true,
  livePromotionAllowed: false,
  strategyTrial: false,
  products: manifest.venue.products,
  combinedCounts: {
    eligibleOrders: totalEligibleOrders,
    filledOrders: totalFilledOrders,
    fillRate: totalEligibleOrders > 0 ? totalFilledOrders / totalEligibleOrders : null,
    takerDepthAvailableOrders: totalTakerDepthAvailable,
    takerDepthAvailabilityRate: totalEligibleOrders > 0 ? totalTakerDepthAvailable / totalEligibleOrders : null,
    filledOrdersWithFullBookTakerComparator: totalFullBookComparableFills
  },
  filledOrderWeightedMeans: {
    makerEffectiveCostVsArrivalMidBps: weightedMean(
      ordered,
      (item) => item.summary.groups.aggregate.meanEffectiveCostVsArrivalMidBps,
      (item) => item.summary.groups.aggregate.filledOrders
    ),
    immediateTakerFullBookCostVsArrivalMidBpsConditionalOnMakerFill: weightedMean(
      ordered,
      (item) => item.audit.fullBookTakerComparator.meanTakerCostVsArrivalMidBpsConditionalOnMakerFill,
      (item) => item.audit.fullBookTakerComparator.filledOrdersWithFullBookComparator
    ),
    priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: weightedMean(
      ordered,
      (item) => item.audit.fullBookTakerComparator.meanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps,
      (item) => item.audit.fullBookTakerComparator.filledOrdersWithFullBookComparator
    ),
    markoutBps: Object.fromEntries(markoutSeconds.map((seconds) => [String(seconds), weightedMean(
      ordered,
      (item) => item.summary.groups.aggregate.markoutBps?.[String(seconds)]?.mean,
      (item) => item.summary.groups.aggregate.markoutBps?.[String(seconds)]?.n
    )]))
  },
  perProduct,
  interpretationConstraint: 'Combined metrics are descriptive across the three frozen product recordings. Taker cost uses the independently reconstructed full book for the same base quantity. Maker-versus-taker savings are conditional on maker fill and do not include the opportunity cost of non-fills. Product/side/notional/time subsets may not be selected post hoc as a deployment policy.',
  antiSelectionRule: manifest.antiSelectionRule
};

const outputPath = path.resolve('research/crypto/results/coinbase-maker-execution-v1/SCIENTIFIC_SUMMARY.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing scientific E1 result: ${outputPath}`);
fs.writeFileSync(outputPath, `${JSON.stringify(combined, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...combined }, null, 2));
