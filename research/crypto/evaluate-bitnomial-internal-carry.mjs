#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { evaluateInternalCarry, DAY_MS } from "./lib/bitnomial-internal-carry.js";
import { auditInternalCarryRaw } from "./lib/bitnomial-internal-carry-raw-audit.js";
import { projectLateFundingIntoContext } from "./lib/bitnomial-internal-carry-funding-discovery.js";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-internal-carry-v1.json";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
function usage() { throw new Error("Usage: node research/crypto/evaluate-bitnomial-internal-carry.mjs screen|primary|extended <compact.ndjson> <raw.ndjson.gz>"); }

async function readCompact(file, startMs, discoveryCutoffMs) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const time = Date.parse(record.recordedAt);
    if (Number.isFinite(time) && time >= startMs && time <= discoveryCutoffMs) records.push(record);
  }
  if (!records.length) throw new Error("Trial 9 compact evidence window is empty");
  return records;
}

async function readRaw(file, expectedManifestHash) {
  const rowsByHash = new Map();
  const hashes = new Set();
  let rows = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows += 1;
    const row = JSON.parse(line);
    if (row.schema !== "theoldtrader-bitnomial-internal-carry-v1-raw-v1" || row.experimentId !== "bitnomial-internal-carry-v1" || row.trialNumber !== 9) throw new Error(`Unexpected Trial 9 raw row ${rows}`);
    if (row.manifestSha256 !== expectedManifestHash) throw new Error(`Trial 9 raw row ${rows} manifest mismatch`);
    const computed = sha256(String(row.rawText ?? ""));
    if (computed !== String(row.sha256 ?? "").toLowerCase()) throw new Error(`Trial 9 raw SHA-256 mismatch at row ${rows}`);
    hashes.add(computed);
    if (!rowsByHash.has(computed)) rowsByHash.set(computed, []);
    rowsByHash.get(computed).push(row);
  }
  if (!rows) throw new Error("Trial 9 raw archive is empty");
  return { rows, rowsByHash, hashes };
}

async function main() {
  const [mode, compactPath, rawPath] = process.argv.slice(2);
  if (!["screen", "primary", "extended"].includes(mode) || !compactPath || !rawPath || process.argv.slice(2).length !== 3) usage();

  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifestHash = sha256(manifestBytes);
  if (manifest.experimentId !== "bitnomial-internal-carry-v1" || manifest.trialNumber !== 9 || manifest.status !== "FROZEN_FORWARD_BEFORE_FIRST_TRIAL9_OBSERVATION") {
    throw new Error("Trial 9 evaluator refuses an unfrozen or unexpected manifest");
  }
  if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false || manifest.dataGates?.requireRawSemanticAudit !== true) throw new Error("Trial 9 safety/provenance configuration changed");

  const startMs = Date.parse(manifest.forwardWindow?.startInclusive);
  if (!Number.isFinite(startMs)) throw new Error("Trial 9 frozen start is missing");
  const days = mode === "screen" ? manifest.evidenceDesign.viabilityScreenDays : mode === "primary" ? manifest.evidenceDesign.primaryForwardDays : manifest.evidenceDesign.extendedValidationDays;
  const endMs = startMs + Number(days) * DAY_MS;
  const discoveryCutoffMs = endMs + Number(manifest.dataGates.fundingDiscoveryLookaheadMinutes) * 60_000;
  if (Date.now() < discoveryCutoffMs) throw new Error(`Refusing Trial 9 ${mode} evaluation before ${new Date(discoveryCutoffMs).toISOString()}`);

  const discoveryRecords = await readCompact(compactPath, startMs, discoveryCutoffMs);
  const raw = await readRaw(rawPath, manifestHash);
  const semanticAudit = auditInternalCarryRaw(discoveryRecords, raw.rowsByHash);
  const projection = projectLateFundingIntoContext({
    records: discoveryRecords,
    startMs,
    endMs,
    contextToleranceMinutes: manifest.dataGates.entryExitToleranceMinutes,
    discoveryLookaheadMinutes: manifest.dataGates.fundingDiscoveryLookaheadMinutes
  });
  if (!projection.audit.pass || projection.audit.lateBooksUsed || projection.audit.lateProductDataUsed) throw new Error("Trial 9 late funding projection violated market-context isolation");

  const result = evaluateInternalCarry({
    manifest,
    manifestHash,
    records: projection.records,
    availableRawHashes: raw.hashes,
    mode,
    evaluationNowMs: Date.now()
  });
  result.dataGate = {
    ...result.dataGate,
    rawSemanticAuditPass: semanticAudit.pass,
    lateFundingIsolationPass: projection.audit.pass,
    pass: Boolean(result.dataGate?.pass) && semanticAudit.pass && projection.audit.pass
  };

  const intermediaryVerified = manifest.executionModel.intermediaryFeeStatus === "VERIFIED";
  if (result.classification === "PROMOTION_ELIGIBLE_RESEARCH_ONLY" && manifest.evidenceDesign.promotionRequiresVerifiedActualIntermediaryFeeSchedule && !intermediaryVerified) {
    result.classification = "PROMISING_90D_BLOCKED_INTERMEDIARY_FEE_VERIFICATION";
    result.promotionBlockedReason = "Actual applicable FCM/intermediary customer commission schedule remains unverified.";
  }

  process.stdout.write(`${JSON.stringify({
    ...result,
    provenance: {
      manifestPath: MANIFEST_PATH,
      manifestSha256: manifestHash,
      compactPath,
      compactSha256: sha256(fs.readFileSync(compactPath)),
      compactRowsInDiscoveryWindow: discoveryRecords.length,
      rawPath,
      rawArchiveSha256: sha256(fs.readFileSync(rawPath)),
      rawRows: raw.rows,
      rawSemanticAudit: semanticAudit,
      lateFundingProjection: projection.audit,
      firstPartyOnly: true,
      contextCutoff: projection.audit.contextCutoff,
      discoveryCutoff: projection.audit.discoveryCutoff,
      intermediaryFeeStatus: manifest.executionModel.intermediaryFeeStatus
    }
  }, null, 2)}\n`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
