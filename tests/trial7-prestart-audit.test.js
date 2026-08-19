import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Trial 7 machine pre-start/freeze audit passes without inspecting candidate performance", () => {
  const run = spawnSync(process.execPath, ["research/crypto/trial7-prestart-audit.mjs"], {
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, "PASS");
  assert.equal(result.experimentId, "cross-venue-funding-v1");
  assert.equal(result.trialNumber, 7);
  assert.equal(result.candidatePerformanceInspected, false);
  assert.ok(/^[0-9a-f]{64}$/.test(result.manifestSha256));
  assert.ok(result.checks.includes("frozen economics"));
  assert.ok(result.checks.includes("anti-leakage"));
});
