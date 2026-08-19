#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import { assessTrial7RecorderHealth } from "./lib/cross-venue-health.js";

const DEFAULT_MANIFEST = "research/crypto/manifests/cross-venue-funding-v1.json";
const DEFAULT_RECORDING = "research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readRecords(path) {
  if (!fs.existsSync(path)) return [];
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

const [recordingPath = DEFAULT_RECORDING, manifestPath = DEFAULT_MANIFEST] = process.argv.slice(2);
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
  throw new Error("Unexpected Trial 7 health manifest");
}
const records = await readRecords(recordingPath);
const health = assessTrial7RecorderHealth(records, {
  manifestSha256: sha256(manifestBytes),
  maxAgeMinutes: manifest.forwardWindow.maximumSnapshotGapMinutes,
  lookbackHours: 24
});
process.stdout.write(`${JSON.stringify({
  recordingPath,
  manifestPath,
  ...health
}, null, 2)}\n`);
if (!["HEALTHY", "NO_PRIMARY_LIVE_DATA"].includes(health.status)) process.exitCode = 1;
