import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const evaluator = path.resolve('research/crypto/risk-capped-funding-regime-evaluate.js');
const baseManifest = JSON.parse(fs.readFileSync('research/crypto/manifests/risk-capped-funding-regime-v1.json', 'utf8'));

function iso(ms) { return new Date(ms).toISOString(); }

function writeSyntheticCsv(file, start, rows) {
  const lines = ['timestamp,raw_funding_timestamp,funding_timestamp_skew_ms,spot_price,perp_exec_price,perp_mark_price,funding_rate'];
  const step = 8 * 60 * 60 * 1000;
  for (let i = 0; i < rows; i++) {
    const t = start + i * step;
    const price = 100 * Math.exp(Math.log(2.4) * i / Math.max(1, rows - 1));
    lines.push(`${iso(t)},${iso(t)},0,${price.toFixed(10)},${price.toFixed(10)},${price.toFixed(10)},0.000200000000`);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

test('Trial 22 evaluator causally re-anchors before drift defeats frozen gap stress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trial22-test-'));
  try {
    const rows = 360;
    const step = 8 * 60 * 60 * 1000;
    const start = Date.parse('2022-01-01T00:00:00Z');
    const manifest = structuredClone(baseManifest);
    manifest.developmentWindow = {
      startInclusive: iso(start),
      endExclusive: iso(start + rows * step),
      derivativeRowsObservedAtFreeze: false,
    };
    const manifestPath = path.join(tmp, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const csvs = ['link', 'bch', 'eos', 'uni'].map((name) => {
      const file = path.join(tmp, `${name}.csv`);
      writeSyntheticCsv(file, start, rows);
      return file;
    });
    const out = path.join(tmp, 'summary.json');
    const run = spawnSync(process.execPath, [evaluator, manifestPath, 'development', ...csvs, out], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(result.trialNumber, 22);
    assert.ok(result.completedRoundTrips >= 4);
    for (const symbol of manifest.assetSelection.symbols) {
      const sleeve = result.sleeves[symbol];
      assert.ok(sleeve.diagnostics.reanchorCount >= 1, `${symbol} should re-anchor`);
      assert.equal(sleeve.diagnostics.realizedMarginBreach, null);
      for (const stress of Object.values(sleeve.diagnostics.gapStress)) {
        assert.equal(stress.breached, false);
        assert.ok(stress.minimumExcessMargin >= 0);
      }
      assert.ok(Number.isFinite(sleeve.metrics.endValue));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
