import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const replicationManifestPath = process.argv[2] ?? 'research/crypto/manifests/funding-carry-v1R-api.json';
const dataPath = process.argv[3];
if (!dataPath) throw new Error('Usage: node research/crypto/carry-evaluate-replication.js <replication-manifest.json> <synchronized.csv>');

const replication = JSON.parse(fs.readFileSync(replicationManifestPath, 'utf8'));
if (
  replication.experimentId !== 'funding-carry-v1R-api'
  || replication.replicationOf !== 'funding-carry-v1'
  || replication.paperOnly !== true
  || replication.livePromotionAllowed !== false
  || replication.promotionEligible !== false
  || replication.status !== 'FROZEN_BEFORE_FIRST_API_REPLICATION_EVALUATION'
) {
  throw new Error('Expected frozen non-promotion funding-carry-v1R-api manifest');
}

// The primary evaluator is the authoritative economic engine. A temporary compatibility
// manifest changes only the identifier so the exact same engine can be reused; all frozen
// dates, sizing, costs, margin rules and timestamp tolerances come from the replication manifest.
const compatibility = {
  ...replication,
  experimentId: 'funding-carry-v1'
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-carry-replication-'));
const tempManifest = path.join(tempDir, 'compatibility-manifest.json');
fs.writeFileSync(tempManifest, JSON.stringify(compatibility, null, 2));

const evaluator = path.resolve('research/crypto/carry-evaluate.js');
const run = spawnSync(process.execPath, [evaluator, tempManifest, dataPath], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});
if (run.status !== 0) {
  process.stderr.write(run.stderr || run.stdout || 'Carry replication evaluator failed\n');
  process.exit(run.status ?? 1);
}

const result = JSON.parse(run.stdout);
result.experimentId = replication.experimentId;
result.replicationOf = replication.replicationOf;
result.trialNumber = replication.trialNumber;
result.promotionEligible = false;
result.replicationSource = 'official Binance public REST endpoints';
result.interpretationConstraint = replication.evaluation.historicalHoldoutIntegrity;
result.antiRescueRule = replication.antiRescueRule;
console.log(JSON.stringify(result, null, 2));
