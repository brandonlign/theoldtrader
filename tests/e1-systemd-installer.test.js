import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const path = "research/crypto/ops/install-e1-recorder-systemd.sh";
const script = fs.readFileSync(path, "utf8");

test("E1 installer is valid bash", () => {
  const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("E1 installer is branch-locked, clean-worktree, Linux-only and one-shot", () => {
  assert.match(script, /REQUIRED_BRANCH="research\/execution-e1-ops"/);
  assert.match(script, /uname -s/);
  assert.match(script, /git -C "\$ROOT" diff --quiet/);
  assert.match(script, /git -C "\$ROOT" diff --cached --quiet/);
  assert.match(script, /coinbase-maker-e1-scientific-\*/);
  assert.match(script, /refusing to create a second scientific run/i);
});

test("E1 installer requires measured disk headroom and validates code before enablement", () => {
  assert.match(script, /MIN_FREE_GIB=22/);
  assert.match(script, /13\.4 GB compressed total/);
  assert.match(script, /df -Pk/);
  const tests = script.indexOf("npm test");
  const runner = script.indexOf("node --check research/crypto/run-coinbase-maker-e1.mjs");
  const recorder = script.indexOf("node --check research/crypto/record-coinbase-microstructure.mjs");
  const checksums = script.indexOf("CHECKSUM_CONTENT=");
  const enable = script.indexOf("enable --now");
  assert.ok(tests >= 0 && runner > tests && recorder > runner && checksums > recorder && enable > checksums);
});

test("E1 service is low priority, public-data only and runtime sealed", () => {
  assert.match(script, /ExecStart=\$\{NPM_BIN\} run research:e1:scientific/);
  assert.match(script, /Nice=10/);
  assert.match(script, /CPUWeight=20/);
  assert.match(script, /IOWeight=20/);
  assert.match(script, /Restart=on-failure/);
  assert.match(script, /NoNewPrivileges=true/);
  assert.match(script, /PrivateDevices=true/);
  assert.match(script, /ReadWritePaths=\$\{DATA_DIR\}/);
  assert.match(script, /ExecStartPre=\$\{SHA256SUM_BIN\} -c \$\{CHECKSUM_PATH\}/);
  assert.doesNotMatch(script, /paper:run|paper:once|scan:all|whales:observe/);
  assert.doesNotMatch(script, /API_KEY|API_SECRET|PRIVATE_KEY|mnemonic|seed phrase/i);
});

test("E1 runtime hashes include scientific manifest, runner, recorder and evaluator", () => {
  for (const expected of [
    "research/crypto/manifests/coinbase-maker-execution-v1.json",
    "research/crypto/run-coinbase-maker-e1.mjs",
    "research/crypto/record-coinbase-microstructure.mjs",
    "research/crypto/evaluate-coinbase-maker-e1-run.mjs",
    "research/crypto/e1-recorder-health.mjs"
  ]) assert.ok(script.includes(expected), `missing runtime hash target ${expected}`);
});