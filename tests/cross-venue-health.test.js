import test from "node:test";
import assert from "node:assert/strict";
import { assessTrial7RecorderHealth } from "../research/crypto/lib/cross-venue-health.js";

const HASH = "a".repeat(64);
const NOW = Date.parse("2026-08-21T00:30:00Z");

function record(hoursAgo, type = "PRIMARY_LIVE", hash = HASH) {
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    manifestSha256: hash,
    acquisition: { type },
    recordedAt: new Date(NOW - hoursAgo * 3600000).toISOString(),
    sources: {
      hyperliquid: { mark: 999999 },
      binance: { mark: 999999 }
    }
  };
}

test("health monitor reports collector health without exposing candidate values", () => {
  const records = Array.from({ length: 24 }, (_, index) => record(23 - index));
  const health = assessTrial7RecorderHealth(records, { manifestSha256: HASH, nowMs: NOW });
  assert.equal(health.status, "HEALTHY");
  assert.equal(health.candidateValuesExposed, false);
  assert.equal(health.recentPrimaryCoverage, 1);
  assert.equal(JSON.stringify(health).includes("999999"), false);
});

test("recovery rows are counted but cannot disguise stale live acquisition", () => {
  const records = [record(4, "PRIMARY_LIVE"), record(0.1, "OFFICIAL_RECOVERY")];
  const health = assessTrial7RecorderHealth(records, {
    manifestSha256: HASH,
    nowMs: NOW,
    maxAgeMinutes: 130
  });
  assert.equal(health.status, "STALE_PRIMARY_LIVE_DATA");
  assert.equal(health.primaryLiveRows, 1);
  assert.equal(health.officialRecoveryRows, 1);
});

test("manifest mismatch is a provenance failure rather than a health warning", () => {
  const health = assessTrial7RecorderHealth([record(0.1, "PRIMARY_LIVE", "b".repeat(64))], {
    manifestSha256: HASH,
    nowMs: NOW
  });
  assert.equal(health.status, "INVALID_PROVENANCE");
  assert.equal(health.manifestMismatchRows, 1);
});

test("empty pre-start recording is visible without being treated as corruption", () => {
  const health = assessTrial7RecorderHealth([], { manifestSha256: HASH, nowMs: NOW });
  assert.equal(health.status, "NO_PRIMARY_LIVE_DATA");
  assert.equal(health.primaryLiveRows, 0);
});
