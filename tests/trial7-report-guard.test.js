import test from "node:test";
import assert from "node:assert/strict";
import {
  binanceFundingScheduleCsv,
  validateTrial7ReportArtifact
} from "../research/crypto/lib/trial7-report-guard.js";

function artifact({
  mode = "final",
  classification = "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
  schedulePass = true,
  settlementPass = true,
  postWindowMarketFieldsUsed = false
} = {}) {
  const scheduleAudit = {
    pass: schedulePass,
    sourceMechanism: "premiumIndex.nextFundingTime -> fundingRate.fundingTime",
    contextRows: 10,
    eventRowsSeen: 2,
    announcedFundingTimes: ["a", "b"],
    observedFundingTimes: ["a", "b"],
    missingAnnouncedEvents: [],
    unannouncedObservedEvents: [],
    staleScheduleRows: []
  };
  const settlementDiscoveryProjection = {
    pass: settlementPass,
    contextCutoff: "x",
    settlementDiscoveryCutoff: "y",
    lateDiscoveryRows: 1,
    appendedHyperliquidEvents: 1,
    appendedBinanceEvents: 1,
    postWindowMarketFieldsUsed
  };
  const failedDataGate = classification === "FAILED_DATA_GATE";
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    paperOnly: true,
    livePromotionAllowed: false,
    mode,
    classification,
    economicsCalculated: !failedDataGate,
    dataGate: {
      pass: !failedDataGate,
      binanceFundingScheduleAudit: scheduleAudit,
      settlementDiscoveryProjection
    },
    provenance: {
      rawSemanticAudit: { pass: true },
      hyperliquidFundingTimestampNormalization: { pass: true },
      binanceFundingScheduleAudit: scheduleAudit,
      settlementDiscoveryProjection
    }
  };
}

test("guard accepts only the frozen final research-promotion ceiling", () => {
  assert.equal(validateTrial7ReportArtifact(artifact()).pass, true);
  assert.throws(
    () => validateTrial7ReportArtifact(artifact({ classification: "PROMOTED" })),
    /Forbidden Trial 7 classification/
  );
  assert.throws(
    () => validateTrial7ReportArtifact(artifact({ classification: "LIVE_READY" })),
    /Forbidden Trial 7 classification/
  );
});

test("screening artifact cannot masquerade as final promotion-eligible research", () => {
  assert.equal(validateTrial7ReportArtifact(artifact({
    mode: "screening",
    classification: "SCREENING_PASS_NO_PROMOTION"
  })).pass, true);
  assert.throws(() => validateTrial7ReportArtifact(artifact({
    mode: "screening",
    classification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY"
  })), /Forbidden Trial 7 classification/);
});

test("non-data-failure report requires every final provenance layer", () => {
  const badSchedule = artifact({ schedulePass: false });
  assert.throws(() => validateTrial7ReportArtifact(badSchedule), /passing Binance funding schedule audit/);

  const missingRaw = artifact();
  delete missingRaw.provenance.rawSemanticAudit;
  assert.throws(() => validateTrial7ReportArtifact(missingRaw), /raw semantic audit/);

  const missingNormalization = artifact();
  delete missingNormalization.provenance.hyperliquidFundingTimestampNormalization;
  assert.throws(() => validateTrial7ReportArtifact(missingNormalization), /timestamp normalization/);

  const badSettlement = artifact({ settlementPass: false });
  assert.throws(() => validateTrial7ReportArtifact(badSettlement), /settlement-discovery projection audit/);

  const leaked = artifact({ postWindowMarketFieldsUsed: true });
  assert.throws(() => validateTrial7ReportArtifact(leaked), /post-window market fields/);
});

test("FAILED_DATA_GATE remains reportable without strategy economics", () => {
  const failed = artifact({ classification: "FAILED_DATA_GATE", schedulePass: false, settlementPass: false });
  failed.dataGate.pass = false;
  failed.economicsCalculated = false;
  assert.equal(validateTrial7ReportArtifact(failed).pass, true);
});

test("failed data-gate report still rejects post-window market-field use", () => {
  const failed = artifact({
    classification: "FAILED_DATA_GATE",
    schedulePass: false,
    settlementPass: false,
    postWindowMarketFieldsUsed: true
  });
  failed.dataGate.pass = false;
  failed.economicsCalculated = false;
  assert.throws(() => validateTrial7ReportArtifact(failed), /post-window market fields/);
});

test("report guard refuses any live-enabled artifact", () => {
  const value = artifact();
  value.livePromotionAllowed = true;
  assert.throws(() => validateTrial7ReportArtifact(value), /paper-only and non-live/);
});

test("schedule audit CSV always exposes missing/stale counts", () => {
  const csv = binanceFundingScheduleCsv(artifact().dataGate.binanceFundingScheduleAudit);
  assert.match(csv, /missing_announced_events,0/);
  assert.match(csv, /stale_schedule_rows,0/);
  assert.match(csv, /announced_funding_times,2/);
});

test("schedule CSV remains deterministic when schedule audit was never reached", () => {
  assert.match(binanceFundingScheduleCsv(null), /status,not_reached_before_data_failure/);
});
