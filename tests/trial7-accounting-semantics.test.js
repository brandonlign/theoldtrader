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
const DAY_MS = 24 * HOUR_MS;

function manifestFor(days) {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    paperOnly: true,
    livePromotionAllowed: false,
    sourceRules: {
      binanceFundingScheduleAudit: { maximumStaleAnnouncementLagMs: 300000 }
    },
    forwardWindow: {
      startInclusive: new Date(start).toISOString(),
      screeningEndExclusive: new Date(start + Math.min(90, days) * DAY_MS).toISOString(),
      finalEndExclusive: new Date(start + days * DAY_MS).toISOString(),
      minimumRecorderCoverage: 0.98,
      targetPrimaryLiveRecorderCoverage: 0.98,
      maximumSnapshotGapMinutes: 130,
      fundingPriceMatchToleranceMinutes: 10,
      entryExitPriceMatchToleranceMinutes: 10,
      entryExitSelectionRule: "firstValidOfficialObservationAtOrAfterBoundary"
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
    riskStatistics: {
      sharpeAnnualizationDays: 365,
      consistencyWindows: { count: 3, durationDays: 60 }
    },
    marginStress: {
      researchMaintenanceMarginPctOfLegNotional: 0.10,
      crossVenueBasisShockPct: [0.05, 0.10, 0.25]
    },
    finalGate: { strongestPossibleClassification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY" },
    antiLeakage: { noOutcomeDrivenRetuning: true }
  };
}

function makeBundle({ days = 10, hlRate = 0.00006, bnRate = 0.00004 } = {}) {
  const manifest = manifestFor(days);
  const start = Date.parse(manifest.forwardWindow.startInclusive);
  const hours = days * 24;
  const records = [];
  for (let i = 0; i <= hours; i += 1) {
    const boundary = start + i * HOUR_MS;
    const nextFunding = start + (Math.floor(i / 8) + 1) * 8 * HOUR_MS;
    records.push({
      schema: "theoldtrader-cross-venue-funding-v1-record-v2",
      experimentId: "cross-venue-funding-v1",
      trialNumber: 7,
      manifestSha256: HASHES.manifest,
      acquisition: { type: "PRIMARY_LIVE", collector: "synthetic" },
      recordedAt: new Date(boundary + 2 * 60_000).toISOString(),
      sources: {
        hyperliquid: {
          mark: 100,
          oracle: 100,
          currentFunding: hlRate,
          events: [{ time: boundary, rate: hlRate, premium: 0 }],
          hashes: { metaAndAssetCtxsSha256: HASHES.hlMeta, fundingHistorySha256: HASHES.hlFunding }
        },
        binance: {
          mark: 100,
          indexPrice: 100,
          lastFundingRate: bnRate,
          nextFundingTime: nextFunding,
          events: i % 8 === 0 ? [{ time: boundary, rate: bnRate, markPrice: 100, rateType: "Regular" }] : [],
          hashes: { premiumIndexSha256: HASHES.bnPremium, fundingHistorySha256: HASHES.bnFunding }
        }
      }
    });
  }
  return { manifest, records };
}

function evaluate(bundle) {
  const end = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  return evaluateCrossVenueFunding({
    manifest: bundle.manifest,
    manifestHash: HASHES.manifest,
    records: bundle.records,
    availableRawHashes: new Set(Object.values(HASHES).filter((value) => value !== HASHES.manifest)),
    mode: "final",
    evaluationNowMs: end + 1
  });
}

test("entry and exit use first official context at or after boundary, never a closer pre-boundary row", () => {
  const bundle = makeBundle();
  const start = Date.parse(bundle.manifest.forwardWindow.startInclusive);
  const end = Date.parse(bundle.manifest.forwardWindow.finalEndExclusive);
  const preEntry = structuredClone(bundle.records[0]);
  preEntry.recordedAt = new Date(start - 30_000).toISOString();
  preEntry.sources.binance.mark = 1;
  preEntry.sources.hyperliquid.mark = 1;
  const preExit = structuredClone(bundle.records.at(-2));
  preExit.recordedAt = new Date(end - 30_000).toISOString();
  preExit.sources.binance.mark = 1000;
  preExit.sources.hyperliquid.mark = 1;
  preExit.sources.binance.nextFundingTime = end;
  bundle.records.push(preEntry, preExit);

  const result = evaluate(bundle);
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.primary.entry.timestamp, new Date(start + 2 * 60_000).toISOString());
  assert.equal(result.primary.exit.timestamp, new Date(end + 2 * 60_000).toISOString());
  assert.equal(result.primary.entry.binanceMark, 100);
  assert.equal(result.primary.exit.binanceMark, 100);
});

test("pre-entry equity anchors drawdown so modeled entry friction cannot disappear", () => {
  const result = evaluate(makeBundle({ hlRate: 0, bnRate: 0 }));
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.primary.equitySeries[0].phase, "pre-entry");
  assert.equal(result.primary.equitySeries[0].equity, 10000);
  assert.ok(result.primary.stats.maxDrawdown < 0);
  assert.ok(result.primary.executionFriction.entryUsd > 0);
});

test("zero-target downside deviation is computed over the fixed daily return grid", () => {
  const result = evaluate(makeBundle({ hlRate: 0, bnRate: 0 }));
  const series = result.primary.equitySeries;
  const start = Date.parse(result.frozenWindow.startInclusive);
  const end = Date.parse(result.frozenWindow.endExclusive);
  const returns = [];
  let prior = 10000;
  for (let boundary = start + DAY_MS; boundary <= end; boundary += DAY_MS) {
    const point = boundary === end
      ? series.find((row) => row.time === boundary)
      : series.find((row) => row.time >= boundary && row.time - boundary <= 130 * 60_000);
    assert.ok(point);
    returns.push(point.equity / prior - 1);
    prior = point.equity;
  }
  const expected = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length);
  assert.ok(Math.abs(result.primary.stats.downsideDeviation - expected) < 1e-15);
  assert.equal(result.primary.stats.dailyObservations, 10);
});

test("three frozen 60-day contribution windows telescope exactly to full 180-day P&L", () => {
  const result = evaluate(makeBundle({ days: 180 }));
  assert.equal(result.dataGate.pass, true);
  assert.equal(result.windows60d.length, 3);
  assert.equal(result.windows60d.every((window) => window.complete), true);
  const sum = result.windows60d.reduce((total, window) => total + window.pnl, 0);
  assert.ok(Math.abs(sum - result.primary.netPnl) < 1e-8);
  assert.ok(Math.abs(result.consistencyTelescopeErrorUsd) < 1e-8);
  assert.equal(result.finalRequirements.consistencyWindowsTelescope, true);
});

test("analytical break-even friction solves funding plus raw basis minus four-fill friction", () => {
  const result = evaluate(makeBundle());
  const p = result.primary;
  const coefficient = p.quantity * (p.entry.binanceMark + p.entry.hyperliquidMark + p.exit.binanceMark + p.exit.hyperliquidMark) / 10000;
  const residual = p.grossPnlBeforeFriction - result.breakEvenAllInFrictionBpsPerOrder * coefficient;
  assert.ok(Math.abs(residual) < 1e-10);
  assert.ok(result.breakEvenAllInFrictionBpsPerOrder > 0);
});

test("a missing venue-announced Binance funding event fails before economics", () => {
  const bundle = makeBundle();
  const start = Date.parse(bundle.manifest.forwardWindow.startInclusive);
  for (const record of bundle.records.slice(0, 4)) record.sources.binance.nextFundingTime = start + 4 * HOUR_MS;
  const result = evaluate(bundle);
  assert.equal(result.classification, "FAILED_DATA_GATE");
  assert.equal(result.dataGate.binanceFundingScheduleAudit.pass, false);
  assert.deepEqual(result.dataGate.binanceFundingScheduleAudit.missingAnnouncedEvents, [new Date(start + 4 * HOUR_MS).toISOString()]);
  assert.equal(result.economicsCalculated, false);
});
