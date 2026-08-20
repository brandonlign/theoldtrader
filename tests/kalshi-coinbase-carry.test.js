import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateTrial11 } from '../research/crypto/evaluate-kalshi-coinbase-carry.mjs';

const manifest = JSON.parse(fs.readFileSync('research/crypto/manifests/kalshi-coinbase-carry-v1.json', 'utf8'));

function rows({ fundingRate = 0.0002, spot = 100000, bid = 100000, ask = 100000, mark = 100000, mutate } = {}) {
  const start = Date.parse(manifest.historicalDevelopmentWindow.startInclusive);
  return Array.from({ length: 234 }, (_, index) => {
    const base = {
      timestamp: new Date(start + index * 8 * 3600 * 1000).toISOString(),
      coinbaseSpotOpen: spot,
      kalshiBid: bid,
      kalshiAsk: ask,
      kalshiMarkPrice: mark,
      fundingRate
    };
    return mutate ? mutate(base, index) : base;
  });
}

function evaluate(inputRows) {
  return evaluateTrial11({
    manifest,
    synchronized: { experimentId: manifest.experimentId, trialNumber: 11, rows: inputRows, manifestSha256: 'x' },
    sourceManifest: { experimentId: manifest.experimentId, trialNumber: 11, synchronizedSha256: 'y', rawSources: [] }
  });
}

test('Trial 11 excludes entry funding and passes a strong flat positive-carry synthetic path', () => {
  const result = evaluate(rows());
  const q = result.sizing.quantityBtc;
  const expectedFunding = 233 * q * 100000 * 0.0002;
  assert.ok(Math.abs(result.primary.totalFundingUsd - expectedFunding) < 1e-9);
  assert.equal(result.primary.historicalMarginFailure, false);
  assert.equal(result.shocks['0.25'].marginFailure, false);
  assert.equal(result.developmentChecks.primaryNetPnlPositive, true);
  assert.equal(result.developmentChecks.highCostStressNetPnlPositive, true);
  assert.equal(result.developmentPass, true);
  assert.equal(result.classification, 'PROMISING_HISTORICAL_DEVELOPMENT_ONLY');
  assert.equal(result.cannotPromote, true);
  assert.equal(result.feeVerificationFirewallSatisfied, false);
});

test('Trial 11 does not call zero/negative funding carry a development pass', () => {
  const result = evaluate(rows({ fundingRate: 0 }));
  assert.equal(result.developmentChecks.totalFundingPositive, false);
  assert.equal(result.developmentPass, false);
  assert.equal(result.classification, 'HISTORICAL_DEVELOPMENT_FAIL');
});

test('Trial 11 fails closed on missing boundaries and crossed Kalshi execution references', () => {
  assert.throws(() => evaluate(rows().slice(0, 233)), /exactly 234/);
  assert.throws(() => evaluate(rows({ bid: 100100, ask: 100000 })), /Crossed Kalshi bid\/ask/);
});

test('Trial 11 detects venue-local collateral failure under a large adverse mark path', () => {
  const result = evaluate(rows({
    fundingRate: 0,
    mutate: (row, index) => index < 100 ? row : { ...row, kalshiMarkPrice: 400000 }
  }));
  assert.equal(result.primary.historicalMarginFailure, true);
  assert.equal(result.developmentPass, false);
});

test('Trial 11 sizing is exact whole 0.0001 BTC contracts and preserves 30% collateral reserve', () => {
  const result = evaluate(rows());
  assert.equal(Number((result.sizing.quantityBtc / 0.0001).toFixed(8)), result.sizing.contracts);
  assert.equal(result.sizing.collateralReserveUsd, 3000);
  assert.ok(result.sizing.quantityBtc * 100100 <= 1500 + 1e-9);
});
