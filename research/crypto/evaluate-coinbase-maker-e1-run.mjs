import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const manifestPath = path.join(here, 'manifests', 'coinbase-maker-execution-v1.json');
const analyzerPath = path.join(here, 'analyze-coinbase-maker-execution.mjs');
const auditPath = path.join(here, 'audit-coinbase-execution-integrity.mjs');
const runManifestArg = process.argv[2];
if (!runManifestArg) {
  throw new Error('Usage: node research/crypto/evaluate-coinbase-maker-e1-run.mjs <run-manifest.json>');
}
const runManifestPath = path.resolve(root, runManifestArg);
const runDir = path.dirname(runManifestPath);
const outputPath = path.join(runDir, 'evaluation-summary.json');
if (fs.existsSync(outputPath)) {
  throw new Error(`E1 aggregate evaluation already exists; refusing to overwrite: ${path.relative(root, outputPath)}`);
}

const frozenManifestBytes = fs.readFileSync(manifestPath);
const frozenManifest = JSON.parse(frozenManifestBytes.toString('utf8'));
const frozenManifestHash = crypto.createHash('sha256').update(frozenManifestBytes).digest('hex');
const run = JSON.parse(fs.readFileSync(runManifestPath, 'utf8'));
if (run.experimentId !== 'coinbase-maker-execution-v1' || run.paperOnly !== true) {
  throw new Error('Run manifest is not an E1 paper-only run');
}
if (run.frozenManifest?.sha256 !== frozenManifestHash) {
  throw new Error('Frozen E1 manifest hash changed between recording and evaluation');
}
if (run.status !== 'COMPLETE') {
  throw new Error(`E1 run is not complete: ${run.status}`);
}
if (run.products?.join(',') !== frozenManifest.venue.products.join(',')) {
  throw new Error('E1 run product set does not match the frozen manifest');
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed:\n${result.stderr || result.stdout}`);
  }
}
function meanWeighted(rows, valueKey, weightKey) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const value = Number(row[valueKey]);
    const weight = Number(row[weightKey]);
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

const products = {};
for (const product of run.products) {
  const relativeRaw = run.recordings?.[product];
  if (!relativeRaw) throw new Error(`Run manifest is missing recording path for ${product}`);
  const raw = path.resolve(root, relativeRaw);
  if (!fs.existsSync(raw) || !fs.existsSync(`${raw}.sha256`)) {
    throw new Error(`Missing recording or checksum for ${product}: ${relativeRaw}`);
  }

  runNode(analyzerPath, [raw, manifestPath]);
  const base = raw.replace(/\.ndjson\.gz$/, '');
  const makerSummaryPath = `${base}-maker-summary.json`;
  const ordersPath = `${base}-maker-orders.csv`;
  if (!fs.existsSync(makerSummaryPath) || !fs.existsSync(ordersPath)) {
    throw new Error(`Analyzer outputs missing for ${product}`);
  }
  runNode(auditPath, [raw, ordersPath, manifestPath]);
  const integrityPath = `${base}-execution-integrity.json`;
  if (!fs.existsSync(integrityPath)) throw new Error(`Independent audit output missing for ${product}`);

  const maker = JSON.parse(fs.readFileSync(makerSummaryPath, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
  if (maker.input?.product !== product || audit.product !== product) {
    throw new Error(`Product identity mismatch while evaluating ${product}`);
  }
  products[product] = {
    makerSummaryPath: path.relative(root, makerSummaryPath),
    integrityPath: path.relative(root, integrityPath),
    recording: maker.recording,
    aggregateMaker: maker.groups?.aggregate ?? null,
    auditIntegrity: audit.integrity,
    fullBookTakerComparator: audit.fullBookTakerComparator
  };
}

const rows = Object.values(products);
const allAnalyzerScientific = rows.every((row) => row.recording?.classification === 'SCIENTIFIC_WINDOW');
const allAuditScientific = rows.every((row) => row.auditIntegrity?.scientificIntegrityPass === true);
const totalEligibleOrders = rows.reduce((sum, row) => sum + Number(row.aggregateMaker?.eligibleOrders ?? 0), 0);
const totalFilledOrders = rows.reduce((sum, row) => sum + Number(row.aggregateMaker?.filledOrders ?? 0), 0);
const totalFullBookComparableFills = rows.reduce((sum, row) => sum + Number(row.fullBookTakerComparator?.filledOrdersWithFullBookComparator ?? 0), 0);
const weightedFillRate = totalEligibleOrders > 0 ? totalFilledOrders / totalEligibleOrders : null;
const weightedMeanConditionalSavingsBps = meanWeighted(
  rows.map((row) => ({
    value: row.fullBookTakerComparator?.meanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps,
    weight: row.fullBookTakerComparator?.filledOrdersWithFullBookComparator
  })),
  'value',
  'weight'
);

const summary = {
  experimentId: frozenManifest.experimentId,
  runId: run.runId,
  generatedAt: new Date().toISOString(),
  mode: run.mode,
  paperOnly: true,
  strategyTrial: false,
  frozenManifestSha256: frozenManifestHash,
  runManifest: path.relative(root, runManifestPath),
  products,
  aggregate: {
    allAnalyzerScientific,
    allAuditScientific,
    scientificDatasetUsable: allAnalyzerScientific && allAuditScientific,
    totalEligibleOrders,
    totalFilledOrders,
    weightedFillRate,
    totalFullBookComparableFills,
    weightedMeanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: weightedMeanConditionalSavingsBps
  },
  interpretation: allAnalyzerScientific && allAuditScientific
    ? 'This run satisfies the frozen E1 recording/integrity gates. The measured fill and conditional cost statistics are execution evidence only; they do not automatically modify the live/paper strategy or justify substituting a lower cost model into prior alpha trials.'
    : 'This run does not satisfy every frozen E1 scientific recording/integrity gate and may be used only for engineering diagnostics, not for execution-cost claims.',
  antiSelectionRule: frozenManifest.antiSelectionRule
};

fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  evaluationSummary: path.relative(root, outputPath),
  scientificDatasetUsable: summary.aggregate.scientificDatasetUsable,
  totalEligibleOrders,
  totalFilledOrders,
  weightedFillRate,
  totalFullBookComparableFills,
  weightedMeanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: weightedMeanConditionalSavingsBps
}, null, 2));
