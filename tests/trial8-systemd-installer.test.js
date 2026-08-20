import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const path = "research/crypto/ops/install-trial8-recorder-systemd.sh";
const script = fs.readFileSync(path, "utf8");

test("Trial 8 installer is valid bash", () => {
  const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Trial 8 installer is branch-locked, clean-worktree and Linux-only", () => {
  assert.match(script, /REQUIRED_BRANCH="research\/bitnomial-carry-v1"/);
  assert.match(script, /uname -s/);
  assert.match(script, /git -C "\$ROOT" diff --quiet/);
  assert.match(script, /git -C "\$ROOT" diff --cached --quiet/);
});

test("Trial 8 installer validates science and connectivity before service enablement", () => {
  const tests = script.indexOf("npm test");
  const guard = script.indexOf("npm run research:t8:freeze-guard");
  const connectivity = script.indexOf("npm run research:t8:connectivity");
  const checksums = script.indexOf("CHECKSUM_CONTENT=");
  const enable = script.indexOf("enable --now");
  assert.ok(tests >= 0 && guard > tests && connectivity > guard && checksums > connectivity && enable > checksums);
  assert.doesNotMatch(script, /npm ci|npm install/);
});

test("Trial 8 service has no trading or credential path", () => {
  assert.match(script, /ExecStart=\$\{NPM_BIN\} run research:t8:record/);
  assert.doesNotMatch(script, /paper:run|paper:once|scan:all|whales:observe/);
  assert.doesNotMatch(script, /API_KEY|API_SECRET|PRIVATE_KEY|mnemonic|seed phrase/i);
  assert.match(script, /NoNewPrivileges=true/);
  assert.match(script, /PrivateDevices=true/);
  assert.match(script, /ReadWritePaths=\$\{DATA_DIR\}/);
  assert.match(script, /ExecStartPre=\$\{SHA256SUM_BIN\} -c \$\{CHECKSUM_PATH\}/);
});
