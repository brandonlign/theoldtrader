import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInternalCarry, HOUR_MS, DAY_MS } from "../research/crypto/lib/bitnomial-internal-carry.js";

const START = Date.parse("2026-01-01T00:00:00Z");
const HASH = "b".repeat(64);
const MANIFEST_HASH = "c".repeat(64);

function book(symbol, mid, contractSize, time) {
  return {
    symbol,
    timestamp: new Date(time - 1000).toISOString(),
    bestAskUsd: mid + 1,
    bestBidUsd: mid - 1,
    midpointUsd: mid,
    spreadBps: 0.2,
    asks: [{ priceUsd: mid + 1, btcQuantity: 1, contracts: 1 / contractSize }],
    bids: [{ priceUsd: mid - 1, btcQuantity: 1, contracts: 1 / contractSize }]
  };
}
function manifest(intermediaryFeeStatus = "UNVERIFIED") {
  return {
    experimentId: "bitnomial-internal-carry-v1",
    trialNumber: 9,
    forwardWindow: { startInclusive: new Date(START).toISOString() },
    evidenceDesign: {
      primaryForwardStrongestClassification: "PROMISING_FORWARD_30D_ONLY",
      extendedValidationStrongestClassification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
      promotionRequiresVerifiedActualIntermediaryFeeSchedule: true
    },
    venues: { spotLong: { contractSizeBtc: 0.00001 }, perpetualShort: { contractSizeBtc: 0.01 } },
    portfolio: {
      startingEquityUsd: 10000,
      targetNotionalPctOfStartingEquityPerLeg: 0.20,
      maximumActualNotionalPctPerLeg: 0.25,
      perpetualCollateralReservePctOfStartingEquity: 0.30
    },
    executionModel: {
      publishedSpotExchangeClearingFeeBpsPerSide: 2,
      publishedPerpetualExchangeClearingFeeUsdPerContractPerSide: 0.10,
      additionalPrimarySlippageBps: 0,
      stressAdditionalAdverseBpsPerOrder: 10,
      stressUnverifiedIntermediaryCostBpsPerSpotOrder: 10,
      stressUnverifiedIntermediaryCostUsdPerPerpetualContractPerSide: 1,
      intermediaryFeeStatus
    },
    dataGates: {
      minimumHourlyCoverage: 0.98,
      maximumObservationGapMinutes: 130,
      entryExitToleranceMinutes: 10,
      bookSnapshotMaximumAgeSeconds: 30,
      fundingDiscoveryLookaheadMinutes: 70
    },
    marginStress: { researchMaintenanceMarginPctOfPerpetualNotional: 0.15, adverseRelativeBasisShockPct: [0.05, 0.10, 0.20] }
  };
}
function records(days = 90, fundingRate = 0.0004) {
  const result = [];
  for (let i = 0; i <= days * 24; i += 1) {
    const boundary = START + i * HOUR_MS;
    const time = boundary + 15_000;
    const fundingEvents = i > 0 && i % 8 === 0 ? [{
      productId: 5614,
      markPrice: 100000,
      priceIndex: 100000,
      fundingRate,
      interestRate: 0,
      intervalStart: new Date(boundary - 8 * HOUR_MS).toISOString(),
      intervalEnd: new Date(boundary).toISOString()
    }] : [];
    result.push({
      schema: "theoldtrader-bitnomial-internal-carry-v1-record-v1",
      experimentId: "bitnomial-internal-carry-v1",
      trialNumber: 9,
      manifestSha256: MANIFEST_HASH,
      acquisition: { type: "PRIMARY_LIVE" },
      recordedAt: new Date(time).toISOString(),
      sources: {
        spot: { productId: 3592, symbol: "BTCUSD", contractSizeBtc: 0.00001, lastPriceUsd: 100000, book: book("BTCUSD", 100000, 0.00001, time), hashes: { spec: HASH, productData: HASH, book: HASH } },
        perpetual: { productId: 5614, symbol: "PBTCUCZ50", contractSizeBtc: 0.01, lastPriceUsd: 100000, book: book("PBTCUCZ50", 100000, 0.01, time), fundingEvents, hashes: { spec: HASH, productData: HASH, funding: HASH, book: HASH } }
      }
    });
  }
  return result;
}
function evaluate(m, mode, days) {
  return evaluateInternalCarry({ manifest: m, manifestHash: MANIFEST_HASH, records: records(days), availableRawHashes: new Set([HASH]), mode, evaluationNowMs: START + days * DAY_MS + 71 * 60_000 });
}

test("stress scenario explicitly charges more fees than known-venue-cost primary", () => {
  const result = evaluate(manifest(), "screen", 7);
  assert.equal(result.economicsCalculated, true);
  assert.equal(result.primary.feeBasis, "KNOWN_EXCHANGE_CLEARING_ONLY");
  assert.equal(result.costStress.feeBasis, "KNOWN_EXCHANGE_CLEARING_PLUS_UNVERIFIED_INTERMEDIARY_RESERVE");
  assert.ok(result.costStress.fees.total > result.primary.fees.total);
  assert.equal(result.costStress.fees.intermediarySpotBps, 10);
  assert.equal(result.costStress.fees.intermediaryPerpUsdPerContract, 1);
});

test("90-day profitable evidence cannot become promotion eligible while intermediary fees remain unverified", () => {
  const result = evaluate(manifest("UNVERIFIED"), "extended", 90);
  assert.equal(result.economicsCalculated, true);
  assert.ok(result.primary.pnl.net > 0);
  assert.ok(result.costStress.pnl.net > 0);
  assert.equal(result.classification, "PROMISING_90D_BLOCKED_INTERMEDIARY_FEE_VERIFICATION");
});

test("verified fee status removes only the fee-verification ceiling, not the economic gates", () => {
  const result = evaluate(manifest("VERIFIED"), "extended", 90);
  assert.equal(result.economicsCalculated, true);
  assert.equal(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
  assert.equal(result.livePromotionAllowed, false);
});
