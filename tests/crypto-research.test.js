import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitRidge, predictRidge, backtestDailyPolicy, buyHoldPolicy, performanceMetrics } from '../research/crypto/lib/core.js';
import { frozenV2Config } from '../research/crypto/lib/v2-backtest.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../research/crypto/manifests/crypto-oos-v1.json', import.meta.url), 'utf8'));

test('research manifest is frozen and paper-only', () => {
  assert.equal(manifest.status, 'FROZEN_BEFORE_FIRST_FINAL_EVALUATION');
  assert.equal(manifest.paperOnly, true);
  assert.equal(manifest.livePromotionAllowed, false);
  assert.equal(manifest.multipleTesting.seriousCandidateConfigurationsAttemptedBeforeThisEvaluation, 1);
});

test('ridge regression learns a simple stable relationship', () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const x1 = (i - 100) / 30;
    const x2 = Math.sin(i / 7);
    return { features: [x1, x2], target: 0.02 + 0.5 * x1 - 0.2 * x2 };
  });
  const model = fitRidge(samples, 0.01);
  const prediction = predictRidge(model, [1.2, -0.4]);
  assert.ok(Math.abs(prediction - (0.02 + 0.5 * 1.2 + 0.08)) < 0.02);
});

test('frozen v2 adapter mirrors live v2 defaults', () => {
  const config = frozenV2Config(manifest);
  assert.equal(config.fastPeriod, 12);
  assert.equal(config.slowPeriod, 36);
  assert.equal(config.regimePeriod, 72);
  assert.equal(config.minEdgeToCost, 2);
  assert.equal(config.minProjectedEdge, 0.01);
  assert.equal(config.stopLossPct, 0.035);
  assert.equal(config.takeProfitPct, 0.075);
});

test('backtester charges costs and preserves exposure caps for buy-and-hold', () => {
  const start = Date.parse('2026-03-01T00:00:00Z') / 1000;
  const products = manifest.data.products;
  const dataset = { products: {} };
  for (const [k, product] of products.entries()) {
    dataset.products[product] = Array.from({ length: 4 }, (_, d) => ({
      time: start + d * 86400,
      open: 100 + k * 20,
      high: 101 + k * 20,
      low: 99 + k * 20,
      close: 100 + k * 20,
      volume: 1000
    }));
  }
  const state = backtestDailyPolicy({
    dataset,
    manifest,
    start: '2026-03-01T00:00:00Z',
    end: '2026-03-04T00:00:00Z',
    policy: buyHoldPolicy(products)
  });
  const metrics = performanceMetrics(state);
  assert.ok(metrics.totalFees > 0);
  assert.ok(metrics.netReturn < 0);
  assert.ok(metrics.averageExposure <= 0.46);
});
