import test from "node:test";
import assert from "node:assert/strict";
import {
  binanceFundingScheduleCsv,
  validateTrial7ReportArtifact
} from "../research/crypto/lib/trial7-report-guard.js";

function artifact({ mode = "final", classification = "PROMOTION_ELIGIBLE_RESEARCH_ONLY", schedulePass = true } = {}) {
  const audit = {
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
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    paperOnly: true,
    livePromotionAllowed: false,
    mode,
    classification,
    dataGate: { pass: schedulePass, binanceFundingScheduleAudit: audit }
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

test("non-data-failure report requires a passing Binance announced schedule audit", () => {
  assert.throws(() => validateTrial7ReportArtifact(artifact({ schedulePass: false })), /failed Binance funding schedule audit/);
  assert.equal(validateTrial7ReportArtifact(artifact({
    classification: "FAILED_DATA_GATE",
    schedulePass: false
  })).pass, true);
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
