import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const path = "research/crypto/ops/install-trial7-recorder-systemd.sh";
const script = fs.readFileSync(path, "utf8");

test("Trial 7 systemd installer is valid bash", () => {
  const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Trial 7 installer refuses branch drift and dirty worktree", () => {
  assert.match(script, /REQUIRED_BRANCH="research\/cross-venue-funding-v1-current"/);
  assert.match(script, /CURRENT_BRANCH.*REQUIRED_BRANCH/s);
  assert.match(script, /git -C "\$ROOT" diff --quiet/);
  assert.match(script, /git -C "\$ROOT" diff --cached --quiet/);
  assert.match(script, /Refusing Trial 7 install from branch/);
  assert.match(script, /Refusing Trial 7 install from a dirty worktree/);
});

test("Trial 7 installer runs deterministic preflight before enabling service", () => {
  const npmCi = script.indexOf("npm ci");
  const tests = script.indexOf("npm test");
  const prestart = script.indexOf("npm run research:cv:prestart");
  const connectivity = script.indexOf("npm run research:cv:connectivity");
  const enable = script.indexOf("enable --now");
  assert.ok(npmCi >= 0);
  assert.ok(tests > npmCi);
  assert.ok(prestart > tests);
  assert.ok(connectivity > prestart);
  assert.ok(enable > connectivity);
});

test("installed service invokes only the sealed research recorder and no trading command", () => {
  assert.match(script, /ExecStart=.*npm run research:cv:record/);
  assert.doesNotMatch(script, /paper:run|paper:once|scan:all|whales:observe/);
  assert.doesNotMatch(script, /API_KEY|API_SECRET|PRIVATE_KEY|seed phrase|mnemonic/i);
});

test("installed service limits writable filesystem to Trial 7 data directory", () => {
  assert.match(script, /NoNewPrivileges=true/);
  assert.match(script, /ProtectSystem=full/);
  assert.match(script, /ProtectHome=read-only/);
  assert.match(script, /PrivateDevices=true/);
  assert.match(script, /ReadWritePaths=\$\{DATA_DIR\}/);
  assert.match(script, /UMask=0077/);
});
