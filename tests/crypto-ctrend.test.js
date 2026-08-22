import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CTREND_SIGNAL_NAMES,
  averageRanks,
  rankCrossSection,
  rawTechnicalSignals,
  weeklyDecisionTimes,
  firstStageForecasts,
  fitElasticNetAicc,
  walkForwardCtrendPredictions
} from '../research/crypto/lib/ctrend.js';

function day(sec, index, close = 100 + index) {
  return {
    time: sec + index * 86400,
    open: close - 0.2,
    high: close + 1,
    low: close - 1,
    close,
    quoteVolume: 1_000_000 + index * 1000
  };
}

test('CTREND defines exactly the frozen 28 signals', () => {
  assert.equal(CTREND_SIGNAL_NAMES.length, 28);
  assert.equal(new Set(CTREND_SIGNAL_NAMES).size, 28);
});

test('average ranks use tie averages and cross-sectional map spans [-0.5, 0.5]', () => {
  assert.deepEqual(averageRanks([10, 20, 20, 40]), [1, 2.5, 2.5, 4]);
  const rows = [0, 1, 2].map((rank) => ({ symbol: `S${rank}`, rawSignals: Array(28).fill(rank) }));
  const ranked = rankCrossSection(rows);
  assert.equal(ranked[0].signals[0], -0.5);
  assert.equal(ranked[1].signals[0], 0);
  assert.equal(ranked[2].signals[0], 0.5);
});

test('raw indicators use only bars strictly before the decision', () => {
  const start = Date.UTC(2024, 0, 1) / 1000;
  const candles = Array.from({ length: 230 }, (_, i) => day(start, i, 100 + i * 0.2 + Math.sin(i / 7)));
  const decision = start + 220 * 86400;
  const baseline = rawTechnicalSignals(candles, decision);
  assert.equal(baseline.length, 28);

  const changedFuture = candles.map((row) => ({ ...row }));
  changedFuture[220].close = 1_000_000;
  changedFuture[221].quoteVolume = 999_000_000_000;
  assert.deepEqual(rawTechnicalSignals(changedFuture, decision), baseline);
});

test('raw indicators reject a gap inside the frozen 200-day lookback', () => {
  const start = Date.UTC(2024, 0, 1) / 1000;
  const candles = Array.from({ length: 230 }, (_, i) => day(start, i));
  const decision = start + 220 * 86400;
  const gapped = candles.filter((_, i) => i !== 100);
  assert.equal(rawTechnicalSignals(gapped, decision), null);
});

test('weekly decision schedule is Monday UTC and end-exclusive', () => {
  const times = weeklyDecisionTimes('2026-01-01T00:00:00Z', '2026-01-20T00:00:00Z');
  assert.deepEqual(times.map((time) => new Date(time * 1000).toISOString()), [
    '2026-01-05T00:00:00.000Z',
    '2026-01-12T00:00:00.000Z',
    '2026-01-19T00:00:00.000Z'
  ]);
});

function syntheticPanel(weeks = 120, assets = 10) {
  const start = Date.UTC(2023, 0, 2) / 1000;
  const rows = [];
  for (let w = 0; w < weeks; w += 1) {
    const time = start + w * 7 * 86400;
    for (let a = 0; a < assets; a += 1) {
      const x = assets === 1 ? 0 : a / (assets - 1) - 0.5;
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
    secondStageWindowWeeks: 52,
    elasticNetAlpha: 0.5,
    lambdaGridPoints: 30,
    lambdaMinRatio: 1e-4,
    maxIterations: 5000,
    convergenceTolerance: 1e-9
  }
};

test('first stage requires a full 52-week history and one-week embargo', () => {
  const panel = syntheticPanel(70, 10);
  const forecasts = firstStageForecasts(panel, manifest);
  const firstTime = Math.min(...forecasts.keys());
  const panelStart = Math.min(...panel.map((row) => row.time));
  assert.ok(firstTime >= panelStart + 53 * 7 * 86400);
  assert.equal(forecasts.get(firstTime).rows[0].firstStage.length, 28);
});

test('AICc elastic net identifies a positive informative forecast', () => {
  const samples = [];
  for (let i = 0; i < 300; i += 1) {
    const x = (i - 150) / 150;
    const features = Array.from({ length: 28 }, (_, j) => j === 0 ? x : Math.sin(i * (j + 1)));
    samples.push({ features, target: 0.04 * x + 0.001 * Math.cos(i) });
  }
  const fit = fitElasticNetAicc(samples, { alpha: 0.5, lambdaGridPoints: 30, lambdaMinRatio: 1e-4 });
  assert.ok(Number.isFinite(fit.aicc));
  assert.ok(fit.lambda > 0);
  assert.ok(fit.coefficients[0] > 0);
});

test('walk-forward second stage never trains on the prediction week or adjacent embargo week', () => {
  const panel = syntheticPanel(120, 10);
  const start = new Date(panel[1050].time * 1000).toISOString();
  const end = new Date((Math.max(...panel.map((row) => row.time)) + 7 * 86400) * 1000).toISOString();
  const predictions = walkForwardCtrendPredictions(panel, manifest, start, end);
  assert.ok(predictions.size > 0);
  for (const [time, record] of predictions) {
    assert.equal(record.embargoCutoff, time - 7 * 86400);
    assert.equal(record.trainingWeeks, 52);
    assert.ok(record.trainingRows >= 520);
    assert.ok(record.selectedSignalIndexes.every((index) => index >= 0 && index < 28));
  }
});
