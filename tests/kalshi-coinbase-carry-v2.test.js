import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateTrial12 } from '../research/crypto/evaluate-kalshi-coinbase-carry-v2.mjs';

const manifest = JSON.parse(fs.readFileSync('research/crypto/manifests/kalshi-coinbase-carry-v2.json', 'utf8'));
function rows({ spot0 = 100000, spot1 = 110000, fundingRate = 0, mark0 = 10, mark1 = 11, bid0 = 10, ask1 = 11, mutate } = {}) {
  const start = Date.parse(manifest.historicalDevelopmentWindow.startInclusive);
  const out = Array.from({ length: 234 }, (_, i) => {
    const f = i / 233;
    const row = {
      timestamp: new Date(start + i * 8 * 3600 * 1000).toISOString(),
      coinbaseSpotOpen: spot0 + (spot1 - spot0) * f,
      kalshiBidPerContractUsd: i === 0 ? bid0 : mark0 + (mark1 - mark0) * f,
      kalshiAskPerContractUsd: i === 233 ? ask1 : mark0 + (mark1 - mark0) * f,
      kalshiMarkPerContractUsd: mark0 + (mark1 - mark0) * f,
      fundingRate
    };
    return mutate ? mutate(row, i) : row;
  });
  return out;
}
function evaluate(inputRows) {
  return evaluateTrial12({ manifest, synchronized: { experimentId: manifest.experimentId, trialNumber: 12, rows: inputRows, manifestSha256: 'x' }, sourceManifest: { experimentId: manifest.experimentId, trialNumber: 12, synchronizedSha256: 'y', rawSources: [] } });
}

test('Trial 12 uses whole contract count for Kalshi price PnL', () => {
  const result = evaluate(rows());
  const expectedRawPerpMove = result.sizing.contracts * (10 - 11);
  const feePart = result.primary.perpPricePnlAfterFeesUsd - expectedRawPerpMove;
  assert.ok(Math.abs(expectedRawPerpMove) > 100, 'perp move must scale by contracts, not BTC quantity');
  assert.ok(feePart < 0);
});

test('Trial 12 uses contracts times USD-per-contract mark for funding', () => {
  const rate = 0.0002;
  const flat = rows({ spot1: 100000, mark1: 10, ask1: 10, fundingRate: rate });
  const result = evaluate(flat);
  const expected = 233 * result.sizing.contracts * 10 * rate;
  assert.ok(Math.abs(result.primary.totalFundingUsd - expected) < 1e-9);
});

test('Trial 12 still excludes entry funding', () => {
  const flat = rows({ spot1: 100000, mark1: 10, ask1: 10, fundingRate: 0.001 });
  const result = evaluate(flat);
  const all234 = 234 * result.sizing.contracts * 10 * 0.001;
  assert.ok(result.primary.totalFundingUsd < all234);
});

test('Trial 12 fails closed on crossed quotes and missing rows', () => {
  assert.throws(() => evaluate(rows().slice(0, 233)), /exactly 234/);
  assert.throws(() => evaluate(rows({ mutate: (row, i) => i === 50 ? { ...row, kalshiBidPerContractUsd: 12, kalshiAskPerContractUsd: 11 } : row })), /Crossed/);
});

test('Trial 12 detects venue-local margin failure under large adverse contract quote', () => {
  const result = evaluate(rows({ fundingRate: 0, mutate: (row, i) => i < 100 ? row : { ...row, kalshiMarkPerContractUsd: 40, kalshiBidPerContractUsd: 40, kalshiAskPerContractUsd: 40 } }));
  assert.equal(result.primary.historicalMarginFailure, true);
  assert.equal(result.developmentPass, false);
});
