import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateCrossSectionalPortfolio } from '../research/crypto/lib/cross-sectional-portfolio.js';

function sec(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function daily(start, endExclusive, price = 100) {
  const rows = [];
  for (let time = sec(start); time < sec(endExclusive); time += 86400) {
    rows.push({ time, open: price, high: price, low: price, close: price, volume: 1000, quoteVolume: 100_000 });
  }
  return rows;
}

function manifest() {
  return {
    portfolio: {
      startingCash: 10_000,
      maxSelectedAssets: 3,
      targetWeightPerSelectedAsset: 0.15,
      maxSinglePositionPct: 0.15,
      maxTotalCryptoExposurePct: 0.45,
      cashReservePct: 0.25
    },
    costModel: {
      feeBpsPerSide: 60,
      slippageBpsPerSide: 5,
      spreadBpsRoundTrip: 10,
      roundTripCostBps: 140
    }
  };
}

function prediction(time, rows) {
  return {
    time,
    trainingRows: 100,
    trainingMonths: 12,
    rows
  };
}

test('monthly portfolio applies frozen friction and never exceeds the 15% single-asset target at entry', () => {
  const dataset = { products: { AAAUSDT: daily('2024-01-01', '2024-03-01', 100) } };
  const predictions = new Map([
    [sec('2024-01-01'), prediction(sec('2024-01-01'), [{ symbol: 'AAAUSDT', prediction: 0.05 }])]
  ]);
  const result = simulateCrossSectionalPortfolio(dataset, predictions, manifest(), '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
  const position = result.state.positions.get('AAAUSDT');
  assert.ok(position);
  assert.ok(Math.abs(position.units * 100 - 1500) < 1e-6);
  assert.equal(result.state.orders, 1);
  assert.ok(result.state.totalFees > 0);
  assert.ok(result.state.equitySeries.at(-1).value < 10_000);
  assert.ok(result.state.exposureSeries[0].value < 0.151);
});

test('deselection closes the position and records a completed lifecycle trade', () => {
  const dataset = { products: { AAAUSDT: daily('2024-01-01', '2024-03-02', 100) } };
  const predictions = new Map([
    [sec('2024-01-01'), prediction(sec('2024-01-01'), [{ symbol: 'AAAUSDT', prediction: 0.05 }])],
    [sec('2024-02-01'), prediction(sec('2024-02-01'), [{ symbol: 'AAAUSDT', prediction: 0 }])]
  ]);
  const result = simulateCrossSectionalPortfolio(dataset, predictions, manifest(), '2024-01-01T00:00:00Z', '2024-03-01T00:00:00Z');
  assert.equal(result.state.positions.size, 0);
  assert.equal(result.state.closedTrades.length, 1);
  assert.equal(result.state.closedTrades[0].reason, 'rebalance');
  assert.ok(result.state.closedTrades[0].pnl < 0);
  assert.equal(result.state.forcedExits, 0);
});

test('a held asset with a daily-data gap is force-exited at its final observed close before the gap', () => {
  const rows = daily('2024-01-01', '2024-02-01', 100).filter((row) => row.time !== sec('2024-01-15'));
  const dataset = { products: { AAAUSDT: rows } };
  const predictions = new Map([
    [sec('2024-01-01'), prediction(sec('2024-01-01'), [{ symbol: 'AAAUSDT', prediction: 0.05 }])]
  ]);
  const result = simulateCrossSectionalPortfolio(dataset, predictions, manifest(), '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
  assert.equal(result.state.positions.size, 0);
  assert.equal(result.state.forcedExits, 1);
  assert.equal(result.state.closedTrades.length, 1);
  assert.equal(result.state.closedTrades[0].reason, 'DATA_GAP');
  assert.equal(result.state.closedTrades[0].closedAt, sec('2024-01-15'));
});

test('three selected assets respect the frozen 45% aggregate target', () => {
  const dataset = {
    products: {
      AAAUSDT: daily('2024-01-01', '2024-02-01', 100),
      BBBUSDT: daily('2024-01-01', '2024-02-01', 200),
      CCCUSDT: daily('2024-01-01', '2024-02-01', 50)
    }
  };
  const predictions = new Map([
    [sec('2024-01-01'), prediction(sec('2024-01-01'), [
      { symbol: 'AAAUSDT', prediction: 0.05 },
      { symbol: 'BBBUSDT', prediction: 0.04 },
      { symbol: 'CCCUSDT', prediction: 0.03 }
    ])]
  ]);
  const result = simulateCrossSectionalPortfolio(dataset, predictions, manifest(), '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
  const firstExposure = result.state.exposureSeries[0].value;
  assert.ok(firstExposure > 0.44 && firstExposure < 0.451);
  assert.equal(result.state.positions.size, 3);
});
