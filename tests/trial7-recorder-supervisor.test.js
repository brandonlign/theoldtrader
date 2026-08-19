import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const supervisor = fs.readFileSync("research/crypto/trial7-recorder-start.mjs", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("supported long recorder command is freeze-guarded and routed through the catch-up supervisor", () => {
  assert.equal(
    pkg.scripts["research:cv:record"],
    "node research/crypto/trial7-manifest-guard.mjs >/dev/null && node research/crypto/trial7-recorder-start.mjs"
  );
});

test("supervisor considers exactly start, screen and final boundaries from canonical manifest", () => {
  assert.match(supervisor, /manifest\.forwardWindow\.startInclusive/);
  assert.match(supervisor, /manifest\.forwardWindow\.screeningEndExclusive/);
  assert.match(supervisor, /manifest\.forwardWindow\.finalEndExclusive/);
  assert.match(supervisor, /entryExitPriceMatchToleranceMinutes/);
  assert.match(supervisor, /primaryCollectionOffsetSecondsAfterUtcHour/);
});

test("supervisor performs one sealed catch-up observation before launching long recorder", () => {
  const once = supervisor.indexOf('[RECORDER, "--once"]');
  const long = supervisor.indexOf('spawn(process.execPath, [RECORDER]');
  assert.ok(once >= 0);
  assert.ok(long > once);
  assert.match(supervisor, /critical-boundary catch-up failed/);
});

test("supervisor itself verifies exact frozen manifest bytes", () => {
  assert.match(supervisor, /verifyTrial7CanonicalManifestBytes\(bytes\)/);
});

test("supervisor only starts the market-data recorder and contains no trading command", () => {
  assert.match(supervisor, /const RECORDER = "research\/crypto\/record-cross-venue-funding\.mjs"/);
  assert.doesNotMatch(supervisor, /paper:run|paper:once|scan:all|whales:observe/);
  assert.doesNotMatch(supervisor, /API_KEY|API_SECRET|PRIVATE_KEY|mnemonic|seed phrase/i);
});
