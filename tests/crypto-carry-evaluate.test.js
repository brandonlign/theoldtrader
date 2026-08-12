import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const evaluator = path.join(root, 'research', 'crypto', 'carry-evaluate.js');
const reporter = path.join(root, 'research', 'crypto', 'carry-report.js');
const realManifest = JSON.parse(fs.readFileSync(path.join(root, 'research', 'crypto', 'manifests', 'funding-carry-v1.json'), 'utf8'));

function makeManifest(dir) {
  const manifest = structuredClone(realManifest);
  manifest.historicalRobustnessWindow = {
    ...manifest.historicalRobustnessWindow,
    startInclusive: '2021-05-01T00:00:00Z',
    endExclusive: '2021-05-02T00:00:00Z'
  };
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function csv(rows) {
  return [
    'timestamp,raw_funding_timestamp,funding_timestamp_skew_ms,spot_price,perp_exec_price,perp_mark_price,funding_rate',
    ...rows
  ].join('\n') + '\n';
}

function run(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymog-carry-'));
  const manifestPath = makeManifest(dir);
  const dataPath = path.join(dir, 'data.csv');
  fs.writeFileSync(dataPath, csv(rows));
  const result = spawnSync(process.execPath, [evaluator, manifestPath, dataPath], { cwd: root, encoding: 'utf8' });
  return { dir, result };
}

const validRows = [
  '2021-05-01T00:00:00Z,2021-05-01T00:00:00.002Z,2,100,101,100.5,0.00010',
  '2021-05-01T08:00:00Z,2021-05-01T08:00:00.006Z,6,102,103,102.5,0.00020',
  '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
];

test('carry evaluator separates contract execution price from mark valuation price', () => {
  const { result } = run(validRows);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.input.rows, 3);
  assert.equal(output.input.expectedRows, 3);
  assert.equal(output.input.exactEightHourGridVerified, true);
  assert.equal(output.input.maxAbsoluteFundingTimestampSkewMs, 6);
  assert.equal(output.frozenPosition.perpEntryExecutionReference, 101);
  assert.equal(output.frozenPosition.perpEntryMark, 100.5);
  assert.notEqual(output.frozenPosition.perpEntryFill, output.frozenPosition.perpEntryMark);
  assert.ok(Math.abs(output.basisDiagnostics.entryContractVsSpotPct - 0.01) < 1e-12);
  assert.equal(output.margin.strategyValidWithoutHistoricalMarginBreach, true);
  assert.ok(output.pnlDecomposition.fundingPnl > 0);
  assert.equal(output.dailyDiagnostics.length, 1);
  assert.equal(output.dailyDiagnostics[0].perpExecutionReference, 106);
  assert.equal(output.dailyDiagnostics[0].perpMark, 105);
  assert.ok(Number.isFinite(output.dailyDiagnostics[0].marginExcess));
});

test('carry reporter writes deterministic tables and requested diagnostic plots', () => {
  const { dir, result } = run(validRows);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summaryPath = path.join(dir, 'summary.json');
  fs.writeFileSync(summaryPath, result.stdout);
  const reportResult = spawnSync(process.execPath, [reporter, summaryPath, dir], { cwd: root, encoding: 'utf8' });
  assert.equal(reportResult.status, 0, reportResult.stderr || reportResult.stdout);
  for (const filename of [
    'REPORT.md','comparison-metrics.csv','daily-diagnostics.csv','equity-curve.svg','drawdown.svg',
    'cumulative-funding.svg','basis.svg','margin-excess.svg'
  ]) {
    assert.ok(fs.existsSync(path.join(dir, filename)), `missing ${filename}`);
    assert.ok(fs.statSync(path.join(dir, filename)).size > 0, `empty ${filename}`);
  }
  const report = fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8');
  assert.match(report, /Funding P&L/);
  assert.match(report, /Historical margin breach/);
  assert.match(report, /BTC spot buy-and-hold 15%/);
  const dailyCsv = fs.readFileSync(path.join(dir, 'daily-diagnostics.csv'), 'utf8');
  assert.match(dailyCsv, /perpExecutionReference,perpMark/);
});

test('carry evaluator rejects a missing scheduled funding boundary', () => {
  const { result } = run([
    '2021-05-01T00:00:00Z,2021-05-01T00:00:00.002Z,2,100,101,100.5,0.00010',
    '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected 3 frozen rows|Missing\/duplicate normalized funding boundary/);
});

test('carry evaluator rejects raw funding timestamps outside the frozen tolerance', () => {
  const { result } = run([
    '2021-05-01T00:00:00Z,2021-05-01T00:01:00.001Z,60001,100,101,100.5,0.00010',
    '2021-05-01T08:00:00Z,2021-05-01T08:00:00.006Z,6,102,103,102.5,0.00020',
    '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds frozen skew tolerance/);
});
