import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const evaluator = path.join(root, 'research', 'crypto', 'carry-evaluate.js');
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
  return spawnSync(process.execPath, [evaluator, manifestPath, dataPath], { cwd: root, encoding: 'utf8' });
}

test('carry evaluator separates contract execution price from mark valuation price', () => {
  const result = run([
    '2021-05-01T00:00:00Z,2021-05-01T00:00:00.002Z,2,100,101,100.5,0.00010',
    '2021-05-01T08:00:00Z,2021-05-01T08:00:00.006Z,6,102,103,102.5,0.00020',
    '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
  ]);
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
});

test('carry evaluator rejects a missing scheduled funding boundary', () => {
  const result = run([
    '2021-05-01T00:00:00Z,2021-05-01T00:00:00.002Z,2,100,101,100.5,0.00010',
    '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected 3 frozen rows|Missing\/duplicate normalized funding boundary/);
});

test('carry evaluator rejects raw funding timestamps outside the frozen tolerance', () => {
  const result = run([
    '2021-05-01T00:00:00Z,2021-05-01T00:01:00.001Z,60001,100,101,100.5,0.00010',
    '2021-05-01T08:00:00Z,2021-05-01T08:00:00.006Z,6,102,103,102.5,0.00020',
    '2021-05-01T16:00:00Z,2021-05-01T15:59:59.997Z,-3,104,106,105,0.00030'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds frozen skew tolerance/);
});
