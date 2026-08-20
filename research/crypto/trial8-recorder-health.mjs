#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-carry-v1.json";
const DEFAULT_RECORDING = "research/crypto/data-cache/bitnomial-carry-v1-forward.ndjson";
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

async function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) records.push(JSON.parse(line));
  return records;
}

const [recordingPath = DEFAULT_RECORDING] = process.argv.slice(2);
const manifestBytes = fs.readFileSync(MANIFEST_PATH);
const manifestHash = sha256(manifestBytes);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const now = Date.now();
const records = (await readRecords(recordingPath))
  .filter((row) => row.experimentId === "bitnomial-carry-v1" && row.trialNumber === 8)
  .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
const mismatches = records.filter((row) => row.manifestSha256 !== manifestHash).length;
const latest = records.at(-1) ?? null;
const latestMs = latest ? Date.parse(latest.recordedAt) : null;
const latestAgeMinutes = latestMs === null ? null : Math.max(0, (now - latestMs) / 60_000);
const lookbackStart = now - 24 * 3_600_000;
const buckets = new Set(records
  .filter((row) => row.manifestSha256 === manifestHash)
  .map((row) => Date.parse(row.recordedAt))
  .filter((time) => Number.isFinite(time) && time >= lookbackStart && time <= now)
  .map((time) => Math.floor(time / 3_600_000)));
const status = mismatches > 0
  ? "INVALID_PROVENANCE"
  : latestAgeMinutes === null
    ? "NO_DATA"
    : latestAgeMinutes > manifest.forwardWindow.maximumContextGapMinutes
      ? "STALE"
      : "HEALTHY";
const output = {
  status,
  sealedMonitoringOnly: true,
  candidateValuesExposed: false,
  recordingPath,
  compactRows: records.length,
  manifestMismatchRows: mismatches,
  latestRecordedAt: latest?.recordedAt ?? null,
  latestAgeMinutes,
  maxAllowedAgeMinutes: manifest.forwardWindow.maximumContextGapMinutes,
  recent24hHourlyBuckets: buckets.size,
  recent24hCoverage: buckets.size / 24
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!["HEALTHY", "NO_DATA"].includes(status)) process.exitCode = 1;
