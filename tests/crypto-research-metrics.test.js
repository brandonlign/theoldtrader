import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceMetrics } from '../research/crypto/lib/metrics.js';

test('research metrics include first observation friction relative to starting capital', () => {
  const state = {
    equitySeries: [
      { time: 1772323200, value: 9990 },
      { time: 1772409600, value: 9990 }
    ],
    exposureSeries: [
      { time: 1772323200, value: 0.15 },
      { time: 1772409600, value: 0.15 }
    ],
    closedTrades: [],
    totalFees: 10,
    turnover: 1000,
    orders: 1
  };
  const metrics = performanceMetrics(state, 10000);
  assert.equal(metrics.startValue, 10000);
  assert.ok(Math.abs(metrics.netReturn + 0.001) < 1e-12);
  assert.ok(metrics.maxDrawdown <= -0.001);
  assert.equal(metrics.feeDrag, 0.001);
});
