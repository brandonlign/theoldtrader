import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("Trial 7 recorder rejects a custom manifest before any connectivity request", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trial7-custom-manifest-"));
  const custom = path.join(dir, "custom.json");
  fs.writeFileSync(custom, JSON.stringify({ experimentId: "cross-venue-funding-v1", trialNumber: 7 }));
  const result = run([
    "research/crypto/record-cross-venue-funding.mjs",
    "--connectivity-only",
    "--manifest",
    custom
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the canonical manifest/);
  assert.doesNotMatch(result.stderr, /returned 4\d\d|fetch failed/i);
});

test("Trial 7 evaluator rejects any fourth custom-manifest argument", () => {
  const result = run([
    "research/crypto/cross-venue-funding-evaluate.mjs",
    "final",
    "does-not-matter.ndjson",
    "does-not-matter.raw.ndjson.gz",
    "custom-manifest.json"
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("Trial 7 reporter rejects an artifact not bound to the current canonical manifest hash", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trial7-forged-report-"));
  const resultPath = path.join(dir, "evaluation.json");
  const outputDir = path.join(dir, "report");
  fs.writeFileSync(resultPath, JSON.stringify({
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    mode: "final",
    paperOnly: true,
    livePromotionAllowed: false,
    classification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
    provenance: {
      manifestPath: "research/crypto/manifests/cross-venue-funding-v1.json",
      manifestSha256: "0".repeat(64),
      canonicalManifestVerified: true
    },
    dataGate: {
      pass: true,
      binanceFundingScheduleAudit: { pass: true }
    }
  }));
  const result = run([
    "research/crypto/cross-venue-funding-report.mjs",
    resultPath,
    outputDir
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not bound to the canonical repository manifest/);
  assert.equal(fs.existsSync(outputDir), false);
});
