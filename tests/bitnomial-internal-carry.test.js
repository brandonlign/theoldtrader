import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInternalCarry, HOUR_MS, DAY_MS } from "../research/crypto/lib/bitnomial-internal-carry.js";

const HASH = "a".repeat(64);
const MANIFEST_HASH = "f".repeat(64);
const START = Date.parse("2026-01-01T00:00:00Z");

function manifest() {
  return {
    experimentId: "bitnomial-internal-carry-v1",
    trialNumber: 9,
    paperOnly: true,
    livePromotionAllowed: false,
    forwardWindow: { startInclusive: new Date(START).toISOString() },
    evidenceDesign: {
      primaryForwardStrongestClassification: "PROMISING_FORWARD_30D_ONLY",
      extendedValidationStrongestClassification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
      promotionRequiresVerifiedActualIntermediaryFeeSchedule: true
    },
    venues: {
      spotLong: { contractSizeBtc: 0.00001 },
      perpetualShort: { contractSizeBtc: 0.01 }
    },
    portfolio: {
      startingEquityUsd: 10000,
      targetNotionalPctOfStartingEquityPerLeg: 0.20,
      maximumActualNotionalPctPerLeg: 0.25,
      perpetualCollateralReservePctOfStartingEquity: 0.30
    },
    executionModel: {
      publishedSpotExchangeClearingFeeBpsPerSide: 2,
      publishedPerpetualExchangeClearingFeeUsdPerContractPerSide: 0.10,
      spotFeeBpsPerSide: 2,
      perpetualFeeUsdPerContractPerSide: 0.10,
      stressAdditionalAdverseBpsPerOrder: 10,
      stressUnverifiedIntermediaryCostBpsPerSpotOrder: 10,
      stressUnverifiedIntermediaryCostUsdPerPerpetualContractPerSide: 1.00,
      intermediaryFeeStatus: "UNVERIFIED"
    },
    dataGates: {
      minimumHourlyCoverage: 0.98,
      maximumObservationGapMinutes: 130,
      entryExitToleranceMinutes: 10,
      bookSnapshotMaximumAgeSeconds: 30,
      fundingDiscoveryLookaheadMinutes: 70
    },
    marginStress: {
      researchMaintenanceMarginPctOfPerpetualNotional: 0.15,
      adverseRelativeBasisShockPct: [0.05, 0.10, 0.20]
    }
  };
}

function book({ symbol, mid, contractSizeBtc, depthBtc = 0.1, time }) {
  const halfSpread = 2;
  return {
    symbol,
    timestamp: new Date(time).toISOString(),
    bestAskUsd: mid + halfSpread,
    bestBidUsd: mid - halfSpread,
    midpointUsd: mid,
    spreadBps: (halfSpread * 2 / mid) * 10000,
    asks: [{ priceUsd: mid + halfSpread, btcQuantity: depthBtc, contracts: depthBtc / contractSizeBtc }],
    bids: [{ priceUsd: mid - halfSpread, btcQuantity: depthBtc, contracts: depthBtc / contractSizeBtc }]
  };
}

function bundle({ days = 7, fundingRate = 0.0005, spotFn = () => 100000, perpFn = () => 100000, depthBtc = 0.1 } = {}) {
  const m = manifest();
  const records = [];
  const hours = days * 24;
  for (let i = 0; i <= hours; i += 1) {
    const boundary = START + i * HOUR_MS;
    const recorded = boundary + 15_000;
    const spotMid = spotFn(i, hours);
    const perpMid = perpFn(i, hours);
    const fundingEvents = i > 0 && i % 8 === 0 ? [{
      productId: 5614,
      markPrice: perpMid,
      priceIndex: spotMid,
      fundingRate,
      interestRate: 0,
      intervalStart: new Date(boundary - 8 * HOUR_MS).toISOString(),
      intervalEnd: new Date(boundary).toISOString()
    }] : [];
    records.push({
      schema: "theoldtrader-bitnomial-internal-carry-v1-record-v1",
      experimentId: "bitnomial-internal-carry-v1",
      trialNumber: 9,
      manifestSha256: MANIFEST_HASH,
      acquisition: { type: "PRIMARY_LIVE" },
      recordedAt: new Date(recorded).toISOString(),
      sources: {
        spot: {
          productId: 3592,
          symbol: "BTCUSD",
          contractSizeBtc: 0.00001,
          lastPriceUsd: spotMid,
          book: book({ symbol: "BTCUSD", mid: spotMid, contractSizeBtc: 0.00001, depthBtc, time: recorded - 1000 }),
          hashes: { spec: HASH, productData: HASH, book: HASH }
        },
        perpetual: {
          productId: 5614,
          symbol: "PBTCUCZ50",
          contractSizeBtc: 0.01,
          lastPriceUsd: perpMid,
          book: book({ symbol: "PBTCUCZ50", mid: perpMid, contractSizeBtc: 0.01, depthBtc, time: recorded - 1000 }),
          fundingEvents,
          hashes: { spec: HASH, productData: HASH, funding: HASH, book: HASH }
        }
      }
    });
  }
  return { manifest: m, records };
}

function evaluate(b, mode = "screen") {
  const days = mode === "screen" ? 7 : mode === "primary" ? 30 : 90;
  return evaluateInternalCarry({
    manifest: b.manifest,
    manifestHash: MANIFEST_HASH,
    records: b.records,
    availableRawHashes: new Set([HASH]),
    mode,
    evaluationNowMs: START + days * DAY_MS + 71 * 60_000
  });
}

test("7-day positive carry can pass only the non-promotional viability screen", () => {
  const result = evaluate(bundle());
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.economicsCalculated, true);
  assert.equal(result.primary.size.contracts, 2);
  assert.equal(result.primary.size.btcQuantity, 0.02);
  assert.ok(result.primary.pnl.funding > 0);
  assert.ok(result.primary.pnl.net > 0);
  assert.equal(result.classification, "VIABILITY_SCREEN_PASS_NONPROMOTIONAL");
  assert.equal(result.livePromotionAllowed, false);
});

test("missing one expected 8-hour funding event fails before economics", () => {
  const b = bundle();
  b.records[8].sources.perpetual.fundingEvents = [];
  const result = evaluate(b);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.economicsCalculated, false);
  assert.equal(result.dataGate.fundingCoverage.pass, false);
});

test("insufficient displayed execution depth fails without fictitious fill", () => {
  const result = evaluate(bundle({ depthBtc: 0.005 }));
  assert.equal(result.classification, "FAILED_EXECUTION_DEPTH_GATE");
  assert.equal(result.economicsCalculated, false);
});

test("positive funding cannot rescue an adverse perpetual basis blowout", () => {
  const b = bundle({
    fundingRate: 0.0005,
    perpFn: (i, hours) => 100000 + 20000 * (i / hours)
  });
  const result = evaluate(b);
  assert.ok(result.primary.pnl.funding > 0);
  assert.ok(result.primary.pnl.net < 0);
  assert.equal(result.classification, "FAILED_VIABILITY_SCREEN");
});

test("perpetual product-id drift fails the data gate", () => {
  const b = bundle();
  b.records[20].sources.perpetual.productId = 9999;
  const result = evaluate(b);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.dataGate.productIdentityPass, false);
});

test("stale book fails closed", () => {
  const b = bundle();
  b.records[20].sources.spot.book.timestamp = new Date(Date.parse(b.records[20].recordedAt) - 60_000).toISOString();
  assert.throws(() => evaluate(b), /stale spot book/);
});

test("screen cannot be opened before the frozen discovery delay", () => {
  const b = bundle();
  assert.throws(() => evaluateInternalCarry({
    manifest: b.manifest,
    manifestHash: MANIFEST_HASH,
    records: b.records,
    availableRawHashes: new Set([HASH]),
    mode: "screen",
    evaluationNowMs: START + 7 * DAY_MS + 5 * 60_000
  }), /Refusing Trial 9 screen/);
});
