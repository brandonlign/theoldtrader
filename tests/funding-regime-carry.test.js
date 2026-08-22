import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const evaluator = path.join(repo, 'research/crypto/funding-regime-carry-evaluate.js');
const manifest = path.join(repo, 'research/crypto/manifests/funding-regime-carry-v1.json');
const eightHours = 8 * 60 * 60 * 1000;
const start = Date.parse('2022-01-01T00:00:00Z');
const end = Date.parse('2026-01-01T00:00:00Z');
const rows = (end - start) / eightHours;

function writeSynthetic(file, phaseOffset = 0) {
  const out = ['timestamp,raw_funding_timestamp,funding_timestamp_skew_ms,spot_price,perp_exec_price,perp_mark_price,funding_rate'];
  for (let i = 0; i < rows; i++) {
    const t = start + i * eightHours;
    const phase = (i + phaseOffset) % 450;
    // 90 zero observations, then 180 high-funding observations, then 180 zeros.
    // A causal 90-boundary lookback cannot enter on the first high-funding row.
    const funding = phase >= 90 && phase < 270 ? 0.0004 : 0;
    const iso = new Date(t).toISOString();
    out.push(`${iso},${iso},0,100,100,100,${funding}`);
  }
  fs.writeFileSync(file, out.join('\n') + '\n');
}

test('Trial 19 evaluator is causal, trades the frozen regime, and preserves hedge economics', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trial19-test-'));
  try {
    const ada = path.join(tmp, 'ada.csv');
    const doge = path.join(tmp, 'doge.csv');
    const resultPath = path.join(tmp, 'summary.json');
    writeSynthetic(ada, 0);
    writeSynthetic(doge, 30);
    const run = spawnSync(process.execPath, [evaluator, manifest, 'development', ada, doge, resultPath], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.trialNumber, 19);
    assert.equal(result.mode, 'development');
    assert.ok(result.completedRoundTrips >= 4);
    assert.ok(result.basket.netReturn > 0, `expected positive synthetic carry, got ${result.basket.netReturn}`);
    assert.ok(result.basket.maxDrawdown > -0.025);
    for (const symbol of ['ADAUSDT', 'DOGEUSDT']) {
      const sleeve = result.sleeves[symbol];
      assert.ok(sleeve.trades.length >= 2);
      assert.ok(sleeve.trades[0].entryIndex > 90, 'current-boundary funding must not trigger same-boundary entry');
      assert.ok(sleeve.trades.every((t) => t.holdingBoundaries >= 90 || t.forcedExit), 'minimum active state duration drifted');
      assert.equal(sleeve.diagnostics.marginBreach, null);
      assert.ok(Object.values(sleeve.diagnostics.gapStress).every((x) => x.breached === false));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
