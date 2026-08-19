import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCrossVenueFunding, HOUR_MS } from "../research/crypto/lib/cross-venue-funding.js";

const HASHES = {
  manifest: "f".repeat(64),
  hlMeta: "a".repeat(64),
  hlFunding: "b".repeat(64),
  bnPremium: "c".repeat(64),
  bnFunding: "d".repeat(64)
};

function manifestFor(days = 180) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const screeningEnd = start + Math.min(90, days) * 24 * HOUR_MS;
  const finalEnd = start + days * 24 * HOUR_MS;
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    paperOnly: true,
    livePromotionAllowed: false,
    sourceRules: { binanceFundingScheduleAudit: { maximumStaleAnnouncementLagMs: 300000 } },
    forwardWindow: {
      startInclusive: new Date(start).toISOString(),
      screeningEndExclusive: new Date(screeningEnd).toISOString(),
      finalEndExclusive: new Date(finalEnd).toISOString(),
      minimumRecorderCoverage: 0.98,
      targetPrimaryLiveRecorderCoverage: 0.98,
      maximumSnapshotGapMinutes: 130,
      fundingPriceMatchToleranceMinutes: 10,
      entryExitPriceMatchToleranceMinutes: 10,
      fundingAtStartBoundaryEarned: false,
      fundingAtEndBoundaryEarned: true
    },
    portfolio: {
      startingEquityUsd: 10000,
      pairedNotionalPctOfStartingEquityPerLeg: 0.15,
      collateralReservePctOfStartingEquityPerVenue: 0.20
    },
    executionModel: {
      primaryAllInFrictionBpsPerOrder: 15,
      stressAllInFrictionBpsPerOrder: 25
    },
    marginStress: {
      researchMaintenanceMarginPctOfLegNotional: 0.10,
      crossVenueBasisShockPct: [0.05, 0.10, 0.25]
    },
    finalGate: { strongestPossibleClassification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY" },
    antiLeakage: { noOutcomeDrivenRetuning: true }
  };
}

function makeRecords({
  days = 10,
  hlRate = 0.00006,
  bnRate = 0.00004,
  recoveredEvery = 0,
  markFn = () => ({ binance: 100, hyperliquid: 100, oracle: 100, index: 100 })
} = {}) {
  const manifest = manifestFor(days);
  const start = Date.parse(manifest.forwardWindow.startInclusive);
  const hours = days * 24;
  const records = [];
  for (let i = 0; i <= hours; i += 1) {
    const boundary = start + i * HOUR_MS;
    const recorded = boundary + 2 * 60_000;
    const marks = markFn(i, hours);
    const hlEvents = [{ time: boundary, rate: hlRate, premium: 0 }];
    const bnEvents = i % 8 === 0
      ? [{ time: boundary, rate: bnRate, markPrice: marks.binance, rateType: "Regular" }]
      : [];
    const nextFunding = start + (Math.floor(i / 8) + 1) * 8 * HOUR_MS;
    const acquisitionType = recoveredEvery > 0 && i > 0 && i % recoveredEvery === 0
      ? "OFFICIAL_RECOVERY"
      : "PRIMARY_LIVE";
    records.push({
      schema: "theoldtrader-cross-venue-funding-v1-record-v2",
      experimentId: "cross-venue-funding-v1",
      trialNumber: 7,
      manifestSha256: HASHES.manifest,
      acquisition: {
        type: acquisitionType,
        collector: acquisitionType === "PRIMARY_LIVE" ? "synthetic-live" : "synthetic-recovery"
      },
      recordedAt: new Date(recorded).toISOString(),
      sources: {
        hyperliquid: {
          mark: marks.hyperliquid,
          oracle: marks.oracle,
          currentFunding: hlRate,
          events: hlEvents,
          hashes: {
            metaAndAssetCtxsSha256: HASHES.hlMeta,
            fundingHistorySha256: HASHES.hlFunding
          }
        },
        binance: {
          mark: marks.binance,
          indexPrice: marks.index,
          lastFundingRate: bnRate,
          nextFundingTime: nextFunding,
          events: bnEvents,
          hashes: {
            premiumIndexSha256: HASHES.bnPremium,
            fundingHistorySha256: HASHES.bnFunding
          }
        }
      }
    });
  }
  return { manifest, records };
}

function rawHashes() {
  return new Set([HASHES.hlMeta, HASHES.hlFunding, HASHES.bnPremium, HASHES.bnFunding]);
}

function evaluateFinal(bundle, overrides = {}) {
  const finalEnd = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  return evaluateCrossVenueFunding({
    manifest: bundle.manifest,
    manifestHash: HASHES.manifest,
    records: bundle.records,
    availableRawHashes: rawHashes(),
    mode: "final",
    evaluationNowMs: finalEnd + 1,
    ...overrides
  });
}

test("Trial 7 refuses to evaluate before the frozen final boundary", () => {
  const bundle = makeRecords();
  const finalEnd = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  assert.throws(() => evaluateCrossVenueFunding({
    manifest: bundle.manifest,
    manifestHash: HASHES.manifest,
    records: bundle.records,
    availableRawHashes: rawHashes(),
    mode: "final",
    evaluationNowMs: finalEnd - 1
  }), /Refusing to evaluate/);
});

test("clean positive 180-day synthetic path can only become research-promotion eligible", () => {
  const result = evaluateFinal(makeRecords({ days: 180 }));
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.dataGate.primaryLiveCoverage, 1);
  assert.equal(result.primary.fundingPnl.net > 0, true);
  assert.equal(result.primary.netPnl > 0, true);
  assert.equal(result.costStress.netPnl > 0, true);
  assert.equal(result.primary.margin.observedBreach, null);
  assert.equal(result.primary.margin.allFrozenStressesPass, true);
  assert.equal(result.windows60d.length, 3);
  assert.equal(result.windows60d.filter((row) => row.positive).length, 3);
  assert.equal(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
  assert.equal(result.livePromotionAllowed, false);
});

test("mixed official recovery counts toward first-party coverage but is reported separately", () => {
  const result = evaluateFinal(makeRecords({ recoveredEvery: 10 }));
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.dataGate.hourlyFirstPartyContextCoverage, 1);
  assert.ok(result.dataGate.primaryLiveCoverage < 1);
  assert.ok(result.dataGate.primaryLiveCoverage > 0.85);
  assert.ok(result.dataGate.acquisitionCoverage.officialRecoveryHourlyContexts > 0);
  assert.equal(
    result.dataGate.acquisitionCoverage.primaryLiveHourlyContexts
      + result.dataGate.acquisitionCoverage.officialRecoveryHourlyContexts,
    result.dataGate.expectedHourlyContexts
  );
});

test("invalid or missing acquisition provenance is rejected before economics", () => {
  const bundle = makeRecords();
  delete bundle.records[10].acquisition;
  assert.throws(() => evaluateFinal(bundle), /Invalid Trial 7 acquisition type/);
});

test("missing one hourly Hyperliquid funding event fails the scientific data gate without calculating P&L", () => {
  const bundle = makeRecords();
  bundle.records[100].sources.hyperliquid.events = [];
  const result = evaluateFinal(bundle);
  assert.equal(result.dataGate.fundingCoverage.hyperliquidPass, false);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.economicsCalculated, false);
  assert.equal(result.primary, undefined);
});

test("missing preserved raw-response hash fails without calculating economics", () => {
  const bundle = makeRecords();
  const available = rawHashes();
  available.delete(HASHES.hlMeta);
  const finalEnd = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  const result = evaluateCrossVenueFunding({
    manifest: bundle.manifest,
    manifestHash: HASHES.manifest,
    records: bundle.records,
    availableRawHashes: available,
    mode: "final",
    evaluationNowMs: finalEnd + 1
  });
  assert.equal(result.dataGate.rawHashCoverage.pass, false);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.economicsCalculated, false);
});

test("funding edge does not rescue a large adverse cross-venue basis move", () => {
  const bundle = makeRecords({
    hlRate: 0.00002,
    markFn: (i, hours) => ({
      binance: 100,
      hyperliquid: 100 + 40 * (i / hours),
      oracle: 100 + 40 * (i / hours),
      index: 100
    })
  });
  const result = evaluateFinal(bundle);
  assert.equal(result.primary.fundingPnl.net > 0, true);
  assert.equal(result.primary.netPnl < 0, true);
  assert.notEqual(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
});

test("primary-cost profit can still fail the frozen 25 bps per-order stress", () => {
  const result = evaluateFinal(makeRecords({ hlRate: 0.0000385 }));
  assert.equal(result.primary.netPnl > 0, true);
  assert.equal(result.costStress.netPnl < 0, true);
  assert.equal(result.finalRequirements.costStressNetPositive, false);
  assert.equal(result.classification, "FAILED_FINAL_GATE");
});

test("an observed per-venue margin breach fails an otherwise positive carry path", () => {
  const bundle = makeRecords({
    markFn: (i, hours) => ({
      binance: 100,
      hyperliquid: i === Math.floor(hours / 2) ? 300 : 100,
      oracle: 100,
      index: 100
    })
  });
  const result = evaluateFinal(bundle);
  assert.ok(result.primary.margin.observedBreach);
  assert.equal(result.finalRequirements.marginPass, false);
  assert.notEqual(result.classification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
});

test("conflicting duplicate funding observations are rejected rather than averaged", () => {
  const bundle = makeRecords();
  const duplicateTime = bundle.records[100].sources.hyperliquid.events[0].time;
  bundle.records[101].sources.hyperliquid.events.push({ time: duplicateTime, rate: 0.9, premium: 0 });
  assert.throws(() => evaluateFinal(bundle), /Conflicting Hyperliquid funding rate/);
});

test("start-boundary funding is excluded while end-boundary funding is included before post-boundary exit", () => {
  const baseline = makeRecords();
  const baselineResult = evaluateFinal(baseline);

  const startMutated = makeRecords();
  startMutated.records[0].sources.hyperliquid.events[0].rate = 999;
  const startResult = evaluateFinal(startMutated);
  assert.ok(Math.abs(startResult.primary.fundingPnl.hyperliquid - baselineResult.primary.fundingPnl.hyperliquid) < 1e-12);

  const endMutated = makeRecords();
  endMutated.records.at(-1).sources.hyperliquid.events[0].rate = 999;
  const endResult = evaluateFinal(endMutated);
  assert.ok(endResult.primary.fundingPnl.hyperliquid > baselineResult.primary.fundingPnl.hyperliquid + 100000);
  assert.equal(endResult.dataGate.pass, true);
});
