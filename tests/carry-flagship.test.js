import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCarryFlagship } from '../research/crypto/lib/carry-flagship.js';

function summary(overrides = {}) {
  const base = {
    experimentId: 'funding-carry-v1',
    trialNumber: 2,
    paperOnly: true,
    livePromotionAllowed: false,
    input: { exactEightHourGridVerified: true },
    pnlDecomposition: {
      fundingPnl: 220,
      priceHedgePnlAfterFees: -70,
      totalFees: 40,
      finalEquity: 10110
    },
    margin: {
      breached: false,
      strategyValidWithoutHistoricalMarginBreach: true,
      gapStress: {
        '0.25': { breached: false, minimumExcessMargin: 1000 },
        '0.5': { breached: false, minimumExcessMargin: 500 },
        '1': { breached: false, minimumExcessMargin: 100 }
      }
    },
    strategies: {
      fundingCarry: {
        netReturn: 0.011,
        annualizedReturn: 0.0024,
        sharpe: 0.7,
        sortino: 1,
        maxDrawdown: -0.02,
        calmar: 0.12,
        startValue: 10000,
        endValue: 10110
      },
      cash: { netReturn: 0, annualizedReturn: 0 }
    }
  };
  return {
    ...base,
    ...overrides,
    input: { ...base.input, ...(overrides.input ?? {}) },
    pnlDecomposition: { ...base.pnlDecomposition, ...(overrides.pnlDecomposition ?? {}) },
    margin: { ...base.margin, ...(overrides.margin ?? {}) },
    strategies: {
      ...base.strategies,
      ...(overrides.strategies ?? {}),
      fundingCarry: {
        ...base.strategies.fundingCarry,
        ...(overrides.strategies?.fundingCarry ?? {})
      },
      cash: {
        ...base.strategies.cash,
        ...(overrides.strategies?.cash ?? {})
      }
    }
  };
}

test('flagship audit can only label positive historical evidence as promising, never promoted', () => {
  const result = analyzeCarryFlagship(summary());
  assert.equal(result.status, 'PROMISING_HISTORICAL_ONLY');
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.forwardValidationRequired, true);
  assert.equal(result.checks.positiveVsCash, true);
  assert.equal(result.economics.fundingCoverageOfFees, 5.5);
});

test('historical maintenance-margin breach rejects the frozen candidate', () => {
  const result = analyzeCarryFlagship(summary({
    margin: { breached: true, strategyValidWithoutHistoricalMarginBreach: false }
  }));
  assert.equal(result.status, 'REJECT_HISTORICAL');
  assert.equal(result.checks.historicalMarginSafe, false);
});

test('failure of an already-frozen gap stress rejects the candidate', () => {
  const result = analyzeCarryFlagship(summary({
    margin: {
      gapStress: {
        '0.25': { breached: false, minimumExcessMargin: 500 },
        '0.5': { breached: true, minimumExcessMargin: -1 },
        '1': { breached: true, minimumExcessMargin: -100 }
      }
    }
  }));
  assert.equal(result.status, 'REJECT_HISTORICAL');
  assert.equal(result.checks.allFrozenGapStressesSurvive, false);
});

test('non-positive net return versus cash rejects without inventing a rescue threshold', () => {
  const result = analyzeCarryFlagship(summary({
    strategies: { fundingCarry: { netReturn: -0.001, endValue: 9990 } },
    pnlDecomposition: { finalEquity: 9990 }
  }));
  assert.equal(result.status, 'REJECT_HISTORICAL');
  assert.equal(result.checks.positiveVsCash, false);
});

test('broken synchronized-grid provenance rejects even a profitable result', () => {
  const result = analyzeCarryFlagship(summary({
    input: { exactEightHourGridVerified: false }
  }));
  assert.equal(result.status, 'REJECT_HISTORICAL');
  assert.equal(result.historicalEvidenceUsable, false);
});

test('audit rejects summaries that could authorize live promotion', () => {
  assert.throws(
    () => analyzeCarryFlagship(summary({ livePromotionAllowed: true })),
    /paper-only, non-promotion/
  );
});
