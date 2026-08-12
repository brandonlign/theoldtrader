import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const summaryPath = process.argv[2];
const outputDir = process.argv[3];
if (!summaryPath || !outputDir) {
  throw new Error('Usage: node research/crypto/carry-report-replication.js <replication-summary.json> <output-dir>');
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
if (
  summary.experimentId !== 'funding-carry-v1R-api'
  || summary.replicationOf !== 'funding-carry-v1'
  || summary.paperOnly !== true
  || summary.livePromotionAllowed !== false
  || summary.promotionEligible !== false
) {
  throw new Error('Expected observed non-promotion funding-carry-v1R-api summary');
}

// Reporting-only compatibility wrapper: the primary carry report generator contains no
// economic logic. Temporarily relabel the already-calculated summary so the exact same
// tables/plot code is reused, then restore the replication identity in REPORT.md.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymog-carry-report-replication-'));
const tempSummary = path.join(tempDir, 'summary.json');
fs.writeFileSync(tempSummary, JSON.stringify({ ...summary, experimentId: 'funding-carry-v1' }, null, 2));

const reporter = path.resolve('research/crypto/carry-report.js');
const run = spawnSync(process.execPath, [reporter, tempSummary, outputDir], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});
if (run.status !== 0) {
  process.stderr.write(run.stderr || run.stdout || 'Carry replication report failed\n');
  process.exit(run.status ?? 1);
}

const reportPath = path.join(outputDir, 'REPORT.md');
let report = fs.readFileSync(reportPath, 'utf8');
report = report.replace(
  '# MoneyMog funding-carry-v1 robustness report',
  '# MoneyMog funding-carry-v1R-api robustness replication report'
);
report = report.replace(
  '**Classification:** historical development/robustness evidence only; not pristine validation  ',
  '**Classification:** official Binance REST exact-family replication of funding-carry-v1; historical robustness evidence only; not pristine validation; never promotion eligible  '
);
report = report.replace(
  'A failed frozen Trial 2 stays failed.',
  'This replication cannot promote or rescue Trial 2. A failed/weak replication stays observed under 2R; the primary checksum-archive Trial 2 remains separately required. A failed frozen Trial 2 stays failed.'
);
fs.writeFileSync(reportPath, report);
console.log(run.stdout);
