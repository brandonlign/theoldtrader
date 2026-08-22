import assert from 'node:assert/strict';
import test from 'node:test';
import { promotionDecision } from '../research/crypto/ctrend-promotion-check.js';

const manifest = {
  experimentId: 'ctrend-v1',
  trialNumber: 4,
  historicalData: { finalHoldoutStart: '2026-01-01T00:00:00Z' }
};

function development() {
  return {
    experimentId: 'ctrend-v1', mode: 'development', endExclusive: '2026-01-01T00:00:00Z',
    candidate: { closedTrades: 15 },
    developmentFoldSummary: { medianSharpe: 0.8, positiveReturnFolds: 6, totalFolds: 8 }
  };
}

function final() {
  return {
    experimentId: 'ctrend-v1', mode: 'final', start: '2026-01-01T00:00:00Z',
    candidate: { netReturn: 0.08, sharpe: 1.1, feeDrag: 0.02, closedTrades: 8, realizedByAsset: { A: 40, B: 35, C: 25 } },
    comparators: { cash: { netReturn: 0 }, sameUniverse21dMomentumTop3Weekly: { sharpe: 0.7 } }
  };
}

test('promotion passes only when every frozen criterion passes', () => {
  const result = promotionDecision(manifest, development(), final());
  assert.equal(result.promoted, true);
  assert.equal(result.liveStrategyModified, false);
});

test('single-asset domination blocks promotion', () => {
  const f = final();
  f.candidate.realizedByAsset = { A: 80, B: 10, C: 10 };
  const result = promotionDecision(manifest, development(), f);
  assert.equal(result.promoted, false);
  assert.equal(result.criteria.find((item) => item.id === 'positive_realized_profit_not_single_asset_dominated').pass, false);
});

test('a tie with the momentum comparator blocks promotion', () => {
  const f = final();
  f.comparators.sameUniverse21dMomentumTop3Weekly.sharpe = 1.1;
  const result = promotionDecision(manifest, development(), f);
  assert.equal(result.promoted, false);
});
