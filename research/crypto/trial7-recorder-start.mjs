#!/usr/bin/env node

import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  TRIAL7_CANONICAL_MANIFEST_PATH,
  verifyTrial7CanonicalManifestBytes
} from "./lib/trial7-freeze-identity.js";
import { trial7CriticalBoundaryCatchUp } from "./lib/trial7-collection-schedule.js";

const RECORDER = "research/crypto/record-cross-venue-funding.mjs";
const bytes = fs.readFileSync(TRIAL7_CANONICAL_MANIFEST_PATH);
verifyTrial7CanonicalManifestBytes(bytes);
const manifest = JSON.parse(bytes.toString("utf8"));

const boundariesMs = [
  manifest.forwardWindow.startInclusive,
  manifest.forwardWindow.screeningEndExclusive,
  manifest.forwardWindow.finalEndExclusive
].map((value) => Date.parse(value));
const toleranceMinutes = Number(manifest.forwardWindow.entryExitPriceMatchToleranceMinutes);

const catchUp = trial7CriticalBoundaryCatchUp({
  nowMs: Date.now(),
  boundariesMs,
  toleranceMinutes,
  offsetSeconds: Number(manifest.forwardWindow.primaryCollectionOffsetSecondsAfterUtcHour)
});

if (catchUp) {
  process.stderr.write(
    `[trial7-recorder] critical-boundary catch-up at ${new Date().toISOString()} for ${new Date(catchUp.boundaryMs).toISOString()} `
      + `(preferred ${new Date(catchUp.preferredMs).toISOString()}, deadline ${new Date(catchUp.deadlineMs).toISOString()})\n`
  );
  const once = spawnSync(process.execPath, [RECORDER, "--once"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (once.error) throw once.error;
  if (once.status !== 0) {
    throw new Error(`Trial 7 critical-boundary catch-up failed with exit status ${once.status}`);
  }
}

const child = spawn(process.execPath, [RECORDER], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`[trial7-recorder] child exited on ${signal}\n`);
    process.exitCode = 0;
    return;
  }
  process.exitCode = code ?? 1;
});
