import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1,
  TRIAL7_CANONICAL_MANIFEST_PATH,
  TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT,
  gitBlobSha1,
  verifyTrial7CanonicalManifestBytes
} from "../research/crypto/lib/trial7-freeze-identity.js";

const bytes = fs.readFileSync(TRIAL7_CANONICAL_MANIFEST_PATH);

test("exact canonical Trial 7 manifest bytes equal the final pre-start frozen Git blob", () => {
  assert.equal(TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1, "33363388183c9ef4fb6910398a0ae9dc381601cc");
  assert.equal(TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT, "2026-08-19T23:19:57Z");
  assert.equal(gitBlobSha1(bytes), TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1);
  assert.equal(verifyTrial7CanonicalManifestBytes(bytes), TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1);
});

test("one-byte Trial 7 manifest mutation fails the frozen identity guard", () => {
  const mutated = Buffer.concat([bytes, Buffer.from("\n")]);
  assert.notEqual(gitBlobSha1(mutated), TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1);
  assert.throws(() => verifyTrial7CanonicalManifestBytes(mutated), /canonical manifest bytes changed after freeze/);
});

test("every supported Trial 7 npm command is guarded before execution", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const guardedCommands = [
    "research:cv:prestart",
    "research:cv:connectivity",
    "research:cv:once",
    "research:cv:record",
    "research:cv:health",
    "research:cv:evaluate",
    "research:cv:report"
  ];
  for (const command of guardedCommands) {
    const value = pkg.scripts?.[command];
    assert.ok(value, `missing ${command}`);
    assert.match(value, /^node research\/crypto\/trial7-manifest-guard\.mjs >\/dev\/null && /);
  }
});
