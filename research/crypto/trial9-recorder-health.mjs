#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-internal-carry-v1.json";
const DEFAULT_RECORDING = "research/crypto/data-cache/bitnomial-internal-carry-v1-forward.ndjson";
const HOUR_MS = 3_600_000;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) records.push(JSON.parse(line));
  return records;
}

const [recordingPath = DEFAULT_RECORDING] = process.argv.slice(2);
const manifestBytes = fs.readFileSync(MANIFEST_PATH);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const manifestHash = sha256(manifestBytes);
const now = Date.now();
const rows = (await readRecords(recordingPath))
  .filter((row) => row.experimentId === "bitnomial-internal-carry-v1" && row.trialNumber === 9)
  .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
const mismatchRows = rows.filter((row) => row.manifestSha256 !== manifestHash).length;
const latest = rows.at(-1) ?? null;
const latestMs = latest ? Date.parse(latest.recordedAt) : null;
const latestAgeMinutes = latestMs == null || !Number.isFinite(latestMs) ? null : Math.max(0, (now - latestMs) / 60_000);
const maxAllowedAgeMinutes = Number(manifest.dataGates?.maximumObservationGapMinutes ?? 130);
const startMs = Date.parse(manifest.forwardWindow?.startInclusive);
const recentStart = Math.max(Number.isFinite(startMs) ? startMs : -Infinity, now - 24 * HOUR_MS);
const buckets = new Set(rows
  .filter((row) => row.manifestSha256 === manifestHash)
  .map((row) => Date.parse(row.recordedAt))
  .filter((time) => Number.isFinite(time) && time >= recentStart && time <= now)
  .map((time) => Math.floor(time / HOUR_MS)));

let status;
if (manifest.status !== "FROZEN_FORWARD_BEFORE_FIRST_TRIAL9_OBSERVATION") status = "DEVELOPMENT_NOT_STARTED";
else if (mismatchRows > 0) status = "INVALID_PROVENANCE";
else if (!rows.length) status = now < startMs ? "ARMED_WAITING_FOR_START" : "NO_DATA_AFTER_START";
else if (latestAgeMinutes > maxAllowedAgeMinutes) status = "STALE";
else status = "HEALTHY";

const elapsedHours = Number.isFinite(startMs) && now > startMs ? Math.min(24, Math.ceil((now - startMs) / HOUR_MS)) : 0;
process.stdout.write(`${JSON.stringify({
  status,
  sealedMonitoringOnly: true,
  candidateValuesExposed: false,
  manifestStatus: manifest.status,
  recordingPath,
  compactRows: rows.length,
  manifestMismatchRows: mismatchRows,
  latestRecordedAt: latest?.recordedAt ?? null,
  latestAgeMinutes,
  maxAllowedAgeMinutes,
  recentHourlyBuckets: buckets.size,
  recentExpectedHourlyBuckets: elapsedHours,
  recentCoverage: elapsedHours > 0 ? buckets.size / elapsedHours : null
}, null, 2)}\n`);

if (!["DEVELOPMENT_NOT_STARTED", "ARMED_WAITING_FOR_START", "HEALTHY"].includes(status)) process.exitCode = 1;
