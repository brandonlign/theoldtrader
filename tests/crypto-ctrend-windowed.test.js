import assert from 'node:assert/strict';
import test from 'node:test';
import { walkForwardCtrendWindowedPredictions } from '../research/crypto/lib/ctrend-windowed.js';

function syntheticPanel(weeks = 80, assets = 10) {
  const start = Date.UTC(2023, 0, 2) / 1000;
  const rows = [];
  for (let w = 0; w < weeks; w += 1) {
    const time = start + w * 7 * 86400;
    for (let a = 0; a < assets; a += 1) {
      const x = a / (assets - 1) - 0.5;
      const signals = Array.from({ length: 28 }, (_, j) => j === 0 ? x : Math.sin((w + 1) * (j + 2) + a) * 0.1);
      rows.push({
        time,
        labelEnd: time + 7 * 86400,
        symbol: `A${a}`,
        open: 100,
        signals,
        target: 0.02 * x + 0.001 * Math.sin(w + a)
      });
    }
  }
  return rows;
}

const manifest = {
  model: {
    minimumEligibleAssetsPerWeek: 10,
    minimumHistoryWeeks: 52,
    elasticNetAlpha: 0.5,
    lambdaGridPoints: 20,
    lambdaMinRatio: 1e-4,
    maxIterations: 5000,
    convergenceTolerance: 1e-9
  }
};

test('windowed Trial 4 estimator needs one 52-week window, not two nested windows', () => {
  const panel = syntheticPanel();
  const start = new Date(panel[0].time * 1000).toISOString();
  const end = new Date((panel.at(-1).time + 7 * 86400) * 1000).toISOString();
  const predictions = walkForwardCtrendWindowedPredictions(panel, manifest, start, end);
  assert.ok(predictions.size > 0);
  const first = Math.min(...predictions.keys());
  const panelStart = panel[0].time;
  assert.equal(first, panelStart + 53 * 7 * 86400);
});

test('windowed Trial 4 estimator keeps all training labels before the embargo and exactly 52 weeks', () => {
  const panel = syntheticPanel();
  const start = new Date(panel[0].time * 1000).toISOString();
  const end = new Date((panel.at(-1).time + 7 * 86400) * 1000).toISOString();
  const predictions = walkForwardCtrendWindowedPredictions(panel, manifest, start, end);
  for (const [time, record] of predictions) {
    assert.equal(record.embargoCutoff, time - 7 * 86400);
    assert.equal(record.trainingWeeks, 52);
    assert.ok(record.trainingRows >= 520);
    assert.ok(record.selectedSignalIndexes.every((index) => index >= 0 && index < 28));
  }
});
