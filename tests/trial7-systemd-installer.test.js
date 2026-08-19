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
  const checksumSnapshot = script.indexOf("CHECKSUM_CONTENT=");
  const enable = script.indexOf("enable --now");
  assert.ok(npmCi >= 0);
  assert.ok(tests > npmCi);
  assert.ok(prestart > tests);
  assert.ok(connectivity > prestart);
  assert.ok(checksumSnapshot > connectivity);
  assert.ok(enable > checksumSnapshot);
});

test("installed service invokes only the sealed research recorder and no trading command", () => {
  assert.match(script, /ExecStart=.*npm run research:cv:record/);
  assert.doesNotMatch(script, /paper:run|paper:once|scan:all|whales:observe/);
  assert.doesNotMatch(script, /API_KEY|API_SECRET|PRIVATE_KEY|seed phrase|mnemonic/i);
});

test("systemd PATH includes the resolved Node directory for nvm-style installations", () => {
  assert.match(script, /NODE_BIN="\$\(command -v node/);
  assert.match(script, /NODE_DIR="\$\(dirname "\$NODE_BIN"\)"/);
  assert.match(script, /Environment=PATH=\$\{SYSTEM_PATH\}/);
});

test("service verifies a root-owned acquisition-runtime checksum snapshot before every start", () => {
  assert.match(script, /CHECKSUM_PATH="\/etc\/\$\{SERVICE_NAME\}\.sha256"/);
  assert.match(script, /ExecStartPre=\$\{SHA256SUM_BIN\} -c \$\{CHECKSUM_PATH\}/);
  assert.match(script, /chmod 0444 "\$CHECKSUM_PATH"/);
  for (const file of [
    "package.json",
    "research/crypto/manifests/cross-venue-funding-v1.json",
    "research/crypto/trial7-manifest-guard.mjs",
    "research/crypto/trial7-recorder-start.mjs",
    "research/crypto/record-cross-venue-funding.mjs",
    "research/crypto/lib/trial7-freeze-identity.js",
    "research/crypto/lib/trial7-collection-schedule.js",
    "research/crypto/lib/cross-venue-record.js"
  ]) {
    assert.ok(script.includes(`\"${file}\"`), `runtime checksum snapshot missing ${file}`);
  }
});

test("installed service limits writable filesystem to Trial 7 data directory", () => {
  assert.match(script, /NoNewPrivileges=true/);
  assert.match(script, /ProtectSystem=full/);
  assert.match(script, /ProtectHome=read-only/);
  assert.match(script, /PrivateDevices=true/);
  assert.match(script, /ReadWritePaths=\$\{DATA_DIR\}/);
  assert.match(script, /UMask=0077/);
});
