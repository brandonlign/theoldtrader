import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBitnomialCarry, HOUR_MS } from "../research/crypto/lib/bitnomial-carry.js";

const HASH = "a".repeat(64);
const MANIFEST_HASH = "f".repeat(64);
const DAY_MS = 24 * HOUR_MS;

function manifest(days = 180) {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return {
    experimentId: "bitnomial-carry-v1",
    trialNumber: 8,
    paperOnly: true,
    livePromotionAllowed: false,
    forwardWindow: {
      startInclusive: new Date(start).toISOString(),
      screeningEndExclusive: new Date(start + Math.min(days, 90) * DAY_MS).toISOString(),
      finalEndExclusive: new Date(start + days * DAY_MS).toISOString(),
      entryExitToleranceMinutes: 10,
      minimumHourlyContextCoverage: 0.98,
      maximumContextGapMinutes: 130,
      maximumBitnomialLastTradeAgeMinutes: 30,
      earliestEvaluationDelayMinutesAfterBoundary: 70
    },
    portfolio: {
      startingEquityUsd: 10000,
      targetNotionalPctOfStartingEquityPerLeg: 0.20,
      contractSizeBtc: 0.01,
      maximumActualNotionalPctPerLeg: 0.25,
      perpetualCollateralReservePctOfStartingEquity: 0.30
    },
    executionModel: {
      coinbaseSpotFeeBpsPerOrder: 60,
      coinbaseSpotExtraSlippageBpsPerOrder: 10,
      bitnomialExchangeClearingFeeUsdPerContractPerSide: 0.10,
      bitnomialExtraSlippageBpsPerOrder: 10,
      stressCoinbaseSpotAllInBpsPerOrder: 100,
      stressBitnomialSlippageBpsPerOrder: 25
    },
    marginStress: {
      researchMaintenanceMarginPctOfPerpetualNotional: 0.15,
      adverseBasisShockPct: [0.05, 0.10, 0.20]
    },
    finalGate: { strongestPossibleClassification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY" }
  };
}

function records({ days = 180, fundingRate = 0.0002, spotFn = () => 100000, perpFn = () => 100000 } = {}) {
  const m = manifest(days);
  const start = Date.parse(m.forwardWindow.startInclusive);
  const hours = days * 24;
  const out = [];
  for (let i = 0; i <= hours; i += 1) {
    const boundary = start + i * HOUR_MS;
    const recorded = boundary + 2 * 60_000;
    const spot = spotFn(i, hours);
    const perp = perpFn(i, hours);
    const events = i > 0 && i % 8 === 0 ? [{
      productId: 777,
      priceIndex: spot,
      markPrice: perp,
      interestRate: 0.0001,
      fundingRate,
      intervalStart: new Date(boundary - 8 * HOUR_MS).toISOString(),
      intervalEnd: new Date(boundary).toISOString()
    }] : [];
    out.push({
      schema: "theoldtrader-bitnomial-carry-v1-record-v1",
      experimentId: "bitnomial-carry-v1",
      trialNumber: 8,
      manifestSha256: MANIFEST_HASH,
      acquisition: { type: "PRIMARY_LIVE", collector: "synthetic" },
      recordedAt: new Date(recorded).toISOString(),
      sources: {
        coinbase: { product: "BTC-USD", bid: spot - 10, ask: spot + 10, last: spot, tickerTime: new Date(recorded).toISOString(), hash: HASH },
        bitnomial: {
          productId: 777,
          symbol: "PBTCUC",
          baseSymbol: "BTCUC",
          productName: "Bitcoin US Dollar Centi Perpetual Futures",
          contractSizeBtc: 0.01,
          priceIncrement: 5,
          lastPriceUsd: perp,
          lastPriceTime: new Date(recorded - 60_000).toISOString(),
          fundingEvents: events,
          hashes: { specs: HASH, productData: HASH, funding: HASH }
        }
      }
    });
  }
  return { manifest: m, records: out };
}
function evaluate(bundle, mode = "final") {
  const end = Date.parse(mode === "final" ? bundle.manifest.forwardWindow.finalEndExclusive : bundle.manifest.forwardWindow.screeningEndExclusive);
  return evaluateBitnomialCarry({
    manifest: bundle.manifest,
    manifestHash: MANIFEST_HASH,
    records: bundle.records,
    availableRawHashes: new Set([HASH]),
    mode,
    evaluationNowMs: end + 71 * 60_000
  });
}

test("clean positive 180-day cash-and-carry path can only become research-promotion eligible", () => {
  const result = evaluate(records());
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.primary.size.contracts, 2);
  assert.equal(result.primary.size.btcQuantity, 0.02);
  assert.ok(result.primary.pnl.funding > 0);
  assert.ok(result.primary.pnl.net > 0);
  assert.ok(result.costStress.pnl.net > 0);
  assert.equal(result.primary.margin.observedBreach, null);
  assert.equal(result.primary.margin.allFrozenStressesPass, true);
  assert.equal(result.primary.windows60d.length, 3);
  assert.equal(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
  assert.equal(result.livePromotionAllowed, false);
});

test("missing one required 8-hour Bitnomial funding interval fails before economics", () => {
  const bundle = records({ days: 10 });
  bundle.records[8].sources.bitnomial.fundingEvents = [];
  const result = evaluate(bundle);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.economicsCalculated, false);
  assert.equal(result.dataGate.fundingCoverage.pass, false);
  assert.ok(result.dataGate.fundingCoverage.missing.length >= 1);
});

test("stale Bitnomial last trade fails the data gate rather than substituting a price", () => {
  const bundle = records({ days: 10 });
  bundle.records[50].sources.bitnomial.lastPriceTime = new Date(Date.parse(bundle.records[50].recordedAt) - 60 * 60_000).toISOString();
  const result = evaluate(bundle);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.dataGate.stalePricePass, false);
});

test("positive funding cannot rescue a large adverse perpetual basis move", () => {
  const bundle = records({
    days: 10,
    fundingRate: 0.0002,
    perpFn: (i, hours) => 100000 + 30000 * (i / hours)
  });
  const result = evaluate(bundle);
  assert.ok(result.primary.pnl.funding > 0);
  assert.ok(result.primary.pnl.net < 0);
  assert.notEqual(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
});

test("frozen high-cost stress is strictly harsher than primary economics", () => {
  const bundle = records({ days: 10, fundingRate: 0.00015 });
  const result = evaluate(bundle);
  assert.ok(result.primary.pnl.net > result.costStress.pnl.net);
});

test("pre-boundary context is never used for entry", () => {
  const bundle = records({ days: 10 });
  const start = Date.parse(bundle.manifest.forwardWindow.startInclusive);
  bundle.records.unshift({ ...structuredClone(bundle.records[0]), recordedAt: new Date(start - 1000).toISOString() });
  const result = evaluate(bundle);
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.primary.entry.spotReference, bundle.records[1].sources.coinbase.ask);
});

test("product-id drift fails before PnL", () => {
  const bundle = records({ days: 10 });
  bundle.records[20].sources.bitnomial.productId = 778;
  const result = evaluate(bundle);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.dataGate.productIdentityPass, false);
});

test("evaluation refuses to run before the frozen post-boundary discovery delay", () => {
  const bundle = records({ days: 10 });
  const end = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  assert.throws(() => evaluateBitnomialCarry({
    manifest: bundle.manifest,
    manifestHash: MANIFEST_HASH,
    records: bundle.records,
    availableRawHashes: new Set([HASH]),
    mode: "final",
    evaluationNowMs: end + 5 * 60_000
  }), /Refusing Trial 8/);
});
