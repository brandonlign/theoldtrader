import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCrossSectionalPanel,
  costGateLogThreshold,
  fitCrossSectionalRidge,
  predictCrossSectionalRidge,
  quantileLinear,
  selectCrossSection,
  walkForwardCrossSectionalPredictions,
  winsorizeAndZscore
} from '../research/crypto/lib/cross-sectional.js';

function utc(text) {
  return Math.floor(Date.parse(`${text}T00:00:00Z`) / 1000);
}

function dailySeries(start, endExclusive, priceFn, volumeFn = () => 1_000_000) {
  const rows = [];
  for (let time = utc(start); time < utc(endExclusive); time += 86400) {
    const price = priceFn(time);
    rows.push({
      time,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000,
      quoteVolume: volumeFn(time)
    });
  }
  return rows;
}

function manifest(overrides = {}) {
  return {
    historicalData: {
      developmentStart: '2023-01-01T00:00:00Z',
      finalHoldoutEndExclusive: '2026-08-01T00:00:00Z'
    },
    model: {
      ridgeLambda: 10,
      minimumTrainingMonths: 12,
      minimumEligibleAssetsPerRebalance: 10,
      ...(overrides.model ?? {})
    },
    portfolio: {
      maxSelectedAssets: 3,
      ...(overrides.portfolio ?? {})
    },
    costModel: {
      roundTripCostBps: 140,
      ...(overrides.costModel ?? {})
    }
  };
}

test('linear quantiles and cross-sectional winsorization are deterministic', () => {
  assert.equal(quantileLinear([0, 10, 20], 0.25), 5);
  const rows = [
    { symbol: 'A', rawFeatures: [0] },
    { symbol: 'B', rawFeatures: [1] },
    { symbol: 'C', rawFeatures: [100] }
  ];
  const transformed = winsorizeAndZscore(rows);
  assert.equal(transformed.length, 3);
  assert.ok(transformed.every((row) => Number.isFinite(row.features[0])));
  const zMean = transformed.reduce((sum, row) => sum + row.features[0], 0) / transformed.length;
  assert.ok(Math.abs(zMean) < 1e-12);
});

test('ridge leaves intercept unpenalized and predicts a simple relation', () => {
  const samples = [
    { features: [-2], target: -3 },
    { features: [-1], target: -1 },
    { features: [0], target: 1 },
    { features: [1], target: 3 },
    { features: [2], target: 5 }
  ];
  const model = fitCrossSectionalRidge(samples, 0);
  assert.ok(Math.abs(model.intercept - 1) < 1e-9);
  assert.ok(Math.abs(model.coefficients[0] - 2) < 1e-9);
  assert.ok(Math.abs(predictCrossSectionalRidge(model, [3]) - 7) < 1e-9);
});

test('panel features use only strict pre-rebalance daily bars and label on next month open', () => {
  const start = utc('2022-09-01');
  const products = {};
  for (const symbol of ['AAAUSDT', 'BBBUSDT']) {
    products[symbol] = dailySeries('2022-09-01', '2023-03-02', (time) => {
      const day = Math.round((time - start) / 86400);
      return (symbol === 'AAAUSDT' ? 100 : 200) + day;
    });
  }
  const data = { products };
  const m = manifest();
  m.historicalData.finalHoldoutEndExclusive = '2023-03-01T00:00:00Z';
  const panel = buildCrossSectionalPanel(data, m, ['AAAUSDT', 'BBBUSDT']);
  const january = panel.filter((row) => row.time === utc('2023-01-01'));
  assert.equal(january.length, 2);
  for (const row of january) {
    assert.equal(row.labelEnd, utc('2023-02-01'));
    assert.ok(Number.isFinite(row.target));
    assert.ok(row.features.every(Number.isFinite));
  }

  // Mutating the rebalance-day close cannot change features because the feature cutoff is the prior UTC day.
  const mutated = structuredClone(data);
  for (const symbol of Object.keys(mutated.products)) {
    const rebalance = mutated.products[symbol].find((row) => row.time === utc('2023-01-01'));
    rebalance.close *= 50;
  }
  const panelMutated = buildCrossSectionalPanel(mutated, m, ['AAAUSDT', 'BBBUSDT']);
  const januaryMutated = panelMutated.filter((row) => row.time === utc('2023-01-01'));
  assert.deepEqual(
    januaryMutated.map((row) => row.features),
    january.map((row) => row.features)
  );
});

test('a gap in the strict trailing history makes an asset ineligible for that rebalance', () => {
  const products = {
    AAAUSDT: dailySeries('2022-09-01', '2023-03-02', () => 100),
    BBBUSDT: dailySeries('2022-09-01', '2023-03-02', () => 200)
  };
  products.BBBUSDT = products.BBBUSDT.filter((row) => row.time !== utc('2022-12-15'));
  const m = manifest();
  m.historicalData.finalHoldoutEndExclusive = '2023-02-01T00:00:00Z';
  const january = buildCrossSectionalPanel({ products }, m, ['AAAUSDT', 'BBBUSDT'])
    .filter((row) => row.time === utc('2023-01-01'));
  assert.deepEqual(january.map((row) => row.symbol), ['AAAUSDT']);
});

test('walk-forward training enforces a complete monthly embargo', () => {
  const symbols = ['A', 'B'];
  const times = ['2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01'].map(utc);
  const panel = [];
  for (let t = 0; t < times.length; t += 1) {
    for (let s = 0; s < symbols.length; s += 1) {
      panel.push({
        time: times[t],
        labelEnd: t + 1 < times.length ? times[t + 1] : utc('2023-05-01'),
        symbol: symbols[s],
        features: [s === 0 ? -1 : 1],
        target: 0.01 * (t + 1) * (s === 0 ? -1 : 1)
      });
    }
  }
  const m = manifest({ model: { ridgeLambda: 10, minimumTrainingMonths: 2, minimumEligibleAssetsPerRebalance: 2 } });
  const predictions = walkForwardCrossSectionalPredictions(panel, m, '2023-04-01T00:00:00Z', '2023-05-01T00:00:00Z');
  const april = predictions.get(utc('2023-04-01'));
  assert.ok(april);
  assert.equal(april.embargoCutoff, utc('2023-03-01'));
  assert.equal(april.trainingMonths, 2);
  assert.equal(april.trainingRows, 4);
});

test('selection uses the frozen log-equivalent 140 bps cost gate and deterministic tie break', () => {
  const m = manifest();
  const gate = costGateLogThreshold(m);
  assert.ok(gate > 0.013 && gate < 0.015);
  const selected = selectCrossSection([
    { symbol: 'ZZZ', prediction: gate + 0.01 },
    { symbol: 'AAA', prediction: gate + 0.01 },
    { symbol: 'BBB', prediction: gate + 0.02 },
    { symbol: 'CCC', prediction: gate - 0.001 }
  ], m);
  assert.deepEqual(selected.map((row) => row.symbol), ['BBB', 'AAA', 'ZZZ']);
});
