import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script = fs.readFileSync("research/crypto/trial8-recorder-health.mjs", "utf8");

test("Trial 8 health monitor exposes only operational/provenance state", () => {
  assert.match(script, /candidateValuesExposed: false/);
  assert.match(script, /latestRecordedAt/);
  assert.match(script, /recent24hCoverage/);
  assert.match(script, /manifestMismatchRows/);
  assert.doesNotMatch(script, /sources\.coinbase|sources\.bitnomial|fundingRate|fundingPnl|netPnl|lastPriceUsd|\.bid|\.ask/);
});
