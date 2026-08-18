import test from 'node:test';
import assert from 'node:assert/strict';

import { backtestLowVol, backtestStaticAllocation, selectLowestVolatility, trailingAnnualizedVolatility } from '../research/crypto/lib/lowvol.js';

const DAY = 86_400;
const sec = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;

function path(start, end, dailyLogReturn, decisionCloseMultiplier = 1) {
  const rows = [];
  let price = 100;
  for (let time = sec(start); time < sec(end); time += DAY) {
    const open = price;
    price *= Math.exp(dailyLogReturn(time));
    let close = price;
    if (time === sec('2024-01-01')) close *= decisionCloseMultiplier;
    rows.push({ time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 });
  }
  return rows;
}

function manifest() {
  return {
    data: { products: ['BTC-USD', 'ETH-USD', 'SOL-USD'] },
    signal: { realizedVolLookbackDays: 90, annualizationDays: 365 },
    portfolio: {
      startingCash: 10_000,
      targetSelectedAssetWeight: 0.15,
      maxSinglePositionPct: 0.15,
      maxTotalCryptoExposurePct: 0.15
    },
    costModel: {
      feeBpsPerTrade: 60,
      slippageBpsPerTrade: 5,
      historicalSpreadProxyBpsPerTrade: 5,
      totalBpsPerDollarTurnover: 70
    }
  };
}

function dataset(decisionCloseMultiplier = 1) {
  return {
    products: {
      'BTC-USD': path('2023-09-01', '2024-02-02', () => 0.001, decisionCloseMultiplier),
      'ETH-USD': path('2023-09-01', '2024-02-02', (time) => (Math.floor(time / DAY) % 2 ? 0.02 : -0.018)),
      'SOL-USD': path('2023-09-01', '2024-02-02', (time) => (Math.floor(time / DAY) % 2 ? 0.04 : -0.035))
    }
  };
}

function maps(data) {
  return Object.fromEntries(Object.entries(data.products).map(([product, rows]) => [product, new Map(rows.map((row) => [row.time, row]))]));
}

test('Trial 6 selects the lowest exact trailing-volatility asset', () => {
  const data = dataset();
  const result = selectLowestVolatility(maps(data), manifest().data.products, sec('2024-01-01'), manifest());
  assert.equal(result.selected.product, 'BTC-USD');
  assert.equal(result.eligible.length, 3);
  assert.ok(result.eligible[0].volatility < result.eligible[1].volatility);
});

test('Trial 6 ranking never reads the decision-day close', () => {
  const normal = dataset(1);
  const shocked = dataset(10);
  const a = selectLowestVolatility(maps(normal), manifest().data.products, sec('2024-01-01'), manifest());
  const b = selectLowestVolatility(maps(shocked), manifest().data.products, sec('2024-01-01'), manifest());
  assert.equal(a.selected.product, b.selected.product);
  assert.deepEqual(a.eligible.map((row) => [row.product, row.volatility]), b.eligible.map((row) => [row.product, row.volatility]));
});

test('Trial 6 exact 90-day volatility fails closed on a missing daily observation', () => {
  const data = dataset();
  const map = maps(data)['BTC-USD'];
  map.delete(sec('2023-12-15'));
  assert.equal(trailingAnnualizedVolatility(map, sec('2024-01-01'), 90, 365), null);
});

test('Trial 6 tie break is deterministic by product id', () => {
  const same = path('2023-09-01', '2024-02-02', (time) => (Math.floor(time / DAY) % 2 ? 0.01 : -0.009));
  const data = { products: { 'BTC-USD': same, 'ETH-USD': same.map((row) => ({ ...row })), 'SOL-USD': same.map((row) => ({ ...row })) } };
  const result = selectLowestVolatility(maps(data), manifest().data.products, sec('2024-01-01'), manifest());
  assert.equal(result.selected.product, 'BTC-USD');
});

test('Trial 6 respects the 15% post-friction exposure cap and charges every traded dollar', () => {
  const result = backtestLowVol(dataset(), manifest(), {
    start: '2024-01-01T00:00:00.000Z',
    end: '2024-02-01T00:00:00.000Z'
  });
  assert.ok(result.equityPath[0].grossExposure <= 0.15 + 1e-12);
  assert.ok(result.equityPath[0].grossExposure > 0.14);
  assert.ok(Math.abs(result.transactionCostsUsd - result.turnoverUsd * 0.007) < 1e-8);
  assert.ok(result.trades.some((row) => row.reason === 'evaluation_end_liquidation'));
});

test('Trial 6 matched comparator also stays at 15% post-friction total exposure', () => {
  const result = backtestStaticAllocation(dataset(), manifest(), {
    start: '2024-01-01T00:00:00.000Z',
    end: '2024-02-01T00:00:00.000Z',
    weights: { 'BTC-USD': 0.05, 'ETH-USD': 0.05, 'SOL-USD': 0.05 }
  });
  assert.ok(result.equityPath[0].grossExposure <= 0.15 + 1e-12);
  assert.ok(result.equityPath[0].grossExposure > 0.14);
});
