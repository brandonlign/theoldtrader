#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { evaluateCrossVenueFunding } from "./lib/cross-venue-funding.js";
import { auditCompactAgainstRaw } from "./lib/cross-venue-raw-audit.js";
import { auditBinanceFundingSchedule } from "./lib/binance-funding-schedule-audit.js";
import { normalizeHyperliquidFundingTimes } from "./lib/hyperliquid-funding-time-audit.js";
import { projectLateSettlementsIntoContext } from "./lib/trial7-settlement-discovery.js";

const DEFAULT_MANIFEST = "research/crypto/manifests/cross-venue-funding-v1.json";
const ACQUISITION_TYPES = new Set(["PRIMARY_LIVE", "OFFICIAL_RECOVERY"]);

function usage() {
  throw new Error("Usage: node research/crypto/cross-venue-funding-evaluate.mjs screening|final <compact.ndjson> <raw.ndjson.gz>");
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function acquisitionType(record, label) {
  const type = String(record?.acquisition?.type ?? "");
  if (!ACQUISITION_TYPES.has(type)) throw new Error(`${label} has invalid acquisition type: ${type || "missing"}`);
  return type;
}
function compactRawHashes(record) {
  return [
    record.sources?.hyperliquid?.hashes?.metaAndAssetCtxsSha256,
    record.sources?.hyperliquid?.hashes?.fundingHistorySha256,
    record.sources?.binance?.hashes?.premiumIndexSha256,
    record.sources?.binance?.hashes?.fundingHistorySha256
  ].map((value) => String(value ?? "").toLowerCase());
}

async function readCompact(path) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    acquisitionType(record, `Trial 7 compact row ${records.length + 1}`);
    records.push(record);
  }
  if (!records.length) throw new Error("Trial 7 compact recording is empty");
  return records;
}

async function readAndVerifyRaw(path, expectedManifestHash) {
  const hashes = new Set();
  const acquisitionByHash = new Map();
  const rawRowsByHash = new Map();
  const acquisitionRows = { PRIMARY_LIVE: 0, OFFICIAL_RECOVERY: 0 };
  let rows = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(path).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows += 1;
    const record = JSON.parse(line);
    if (record.schema !== "theoldtrader-cross-venue-funding-v1-raw-v1") throw new Error(`Unexpected Trial 7 raw schema at raw row ${rows}`);
    if (record.manifestSha256 !== expectedManifestHash) throw new Error(`Trial 7 raw row ${rows} was collected under a different manifest hash`);
    const type = acquisitionType(record, `Trial 7 raw row ${rows}`);
    acquisitionRows[type] += 1;
    if (!/^[0-9a-f]{64}$/i.test(String(record.sha256 ?? ""))) throw new Error(`Trial 7 raw row ${rows} has an invalid SHA-256 field`);
    const recomputed = sha256(String(record.rawText ?? ""));
    if (recomputed !== String(record.sha256).toLowerCase()) throw new Error(`Trial 7 raw-response SHA-256 mismatch at raw row ${rows}`);
    hashes.add(recomputed);
    if (!acquisitionByHash.has(recomputed)) acquisitionByHash.set(recomputed, new Set());
    acquisitionByHash.get(recomputed).add(type);
    if (!rawRowsByHash.has(recomputed)) rawRowsByHash.set(recomputed, []);
    rawRowsByHash.get(recomputed).push(record);
  }
  if (!rows) throw new Error("Trial 7 raw-response archive is empty");
  return { hashes, rows, acquisitionByHash, rawRowsByHash, acquisitionRows };
}

function verifyCompactRawAcquisition(records, raw) {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const type = acquisitionType(record, `Trial 7 settlement-discovery compact row ${index + 1}`);
    for (const hash of compactRawHashes(record)) {
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Trial 7 settlement-discovery compact row ${index + 1} has invalid source hash`);
      const rawTypes = raw.acquisitionByHash.get(hash);
      if (!rawTypes?.has(type)) throw new Error(`Trial 7 compact/raw acquisition mismatch at discovery row ${index + 1}: ${type} compact source ${hash} has no raw payload with the same acquisition type`);
    }
  }
}

function frozenWindow(manifest, mode) {
  const startMs = Date.parse(manifest.forwardWindow?.startInclusive);
  const endIso = mode === "screening" ? manifest.forwardWindow?.screeningEndExclusive : manifest.forwardWindow?.finalEndExclusive;
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("Invalid frozen Trial 7 evaluation window");
  const evaluationDelayMs = Number(manifest.forwardWindow?.earliestEvaluationDelayMinutesAfterBoundary ?? 0) * 60_000;
  return {
    startMs,
    endMs,
    evaluationNotBeforeMs: endMs + evaluationDelayMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    evaluationNotBeforeIso: new Date(endMs + evaluationDelayMs).toISOString()
  };
}

function settlementDiscoveryWindow(records, manifest, window) {
  const lookaheadMs = Number(manifest.forwardWindow?.settlementDiscoveryLookaheadMinutes ?? 0) * 60_000;
  return records.filter((record) => {
    const time = Date.parse(record.recordedAt);
    return Number.isFinite(time) && time >= window.startMs && time <= window.endMs + lookaheadMs;
  });
}

function writeDataFailure({ manifest, mode, window, provenance, reason, extraGate = {} }) {
  process.stdout.write(`${JSON.stringify({
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    classification: "FAILED_DATA_GATE",
    frozenWindow: { startInclusive: window.startIso, endExclusive: window.endIso },
    dataGate: { pass: false, ...extraGate },
    economicsCalculated: false,
    interpretationConstraint: reason,
    antiLeakage: manifest.antiLeakage,
    provenance
  }, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) usage();
  const [mode, compactPath, rawPath] = args;
  if (!["screening", "final"].includes(mode) || !compactPath || !rawPath) usage();
  const manifestPath = DEFAULT_MANIFEST;

  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestHash = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) throw new Error("Unexpected Trial 7 manifest identity");
  if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false || manifest.sourceRules?.canonicalManifestOnly !== true) {
    throw new Error("Trial 7 evaluator only accepts the canonical frozen paper-only manifest");
  }

  const window = frozenWindow(manifest, mode);
  if (Date.now() < window.evaluationNotBeforeMs) {
    throw new Error(`Refusing to evaluate Trial 7 ${mode} before ${window.evaluationNotBeforeIso}; the frozen settlement-discovery buffer has not elapsed`);
  }

  const allRecords = await readCompact(compactPath);
  const discoveryRecords = settlementDiscoveryWindow(allRecords, manifest, window);
  if (!discoveryRecords.length) throw new Error("Trial 7 has no compact evidence rows inside the frozen settlement-discovery window");
  const raw = await readAndVerifyRaw(rawPath, manifestHash);
  verifyCompactRawAcquisition(discoveryRecords, raw);
  const semanticAudit = auditCompactAgainstRaw(discoveryRecords, raw.rawRowsByHash);
  const compactHash = sha256(fs.readFileSync(compactPath));
  const rawArchiveHash = sha256(fs.readFileSync(rawPath));

  const contextToleranceMinutes = Number(manifest.forwardWindow.entryExitPriceMatchToleranceMinutes);
  const discoveryLookaheadMinutes = Number(manifest.forwardWindow.settlementDiscoveryLookaheadMinutes);
  const provenanceBase = {
    manifestPath,
    manifestSha256: manifestHash,
    canonicalManifestVerified: true,
    compactPath,
    compactSha256: compactHash,
    compactRowsTotal: allRecords.length,
    compactRowsInSettlementDiscoveryWindow: discoveryRecords.length,
    contextEvidenceCutoff: new Date(window.endMs + contextToleranceMinutes * 60_000).toISOString(),
    settlementDiscoveryCutoff: new Date(window.endMs + discoveryLookaheadMinutes * 60_000).toISOString(),
    semanticAuditScope: "startInclusive<=recordedAt<=endBoundary+settlementDiscoveryLookahead; post-context-window market fields are integrity-audited but prohibited from economics",
    evaluationNotBefore: window.evaluationNotBeforeIso,
    rawPath,
    rawArchiveSha256: rawArchiveHash,
    rawRows: raw.rows,
    rawAcquisitionRows: raw.acquisitionRows,
    verifiedDistinctRawResponseHashes: raw.hashes.size,
    compactRawAcquisitionMatchVerified: true,
    rawSemanticAudit: semanticAudit
  };

  let normalized;
  try {
    normalized = normalizeHyperliquidFundingTimes(discoveryRecords, {
      toleranceMs: Number(manifest.sourceRules.hyperliquidFundingTimestampNormalization.maximumAbsoluteSkewMs)
    });
  } catch (error) {
    writeDataFailure({
      manifest, mode, window,
      provenance: { ...provenanceBase, hyperliquidFundingTimestampNormalization: { pass: false, error: String(error?.message ?? error) } },
      reason: "Trial 7 economics are intentionally not calculated when Hyperliquid settled-funding timestamps violate the frozen hourly-normalization rule.",
      extraGate: { hyperliquidFundingTimestampNormalization: { pass: false, error: String(error?.message ?? error) } }
    });
    return;
  }

  const normalizedRecords = normalized.records;
  const binanceFundingScheduleAudit = auditBinanceFundingSchedule(normalizedRecords, {
    startMs: window.startMs,
    endMs: window.endMs,
    maximumStaleAnnouncementLagMs: Number(manifest.sourceRules.binanceFundingScheduleAudit.maximumStaleAnnouncementLagMs)
  });
  const settlementProjection = projectLateSettlementsIntoContext({
    records: normalizedRecords,
    startMs: window.startMs,
    endMs: window.endMs,
    contextToleranceMinutes,
    discoveryLookaheadMinutes
  });
  const provenance = {
    ...provenanceBase,
    hyperliquidFundingTimestampNormalization: normalized.audit,
    binanceFundingScheduleAudit,
    settlementDiscoveryProjection: settlementProjection.audit
  };

  if (!binanceFundingScheduleAudit.pass || !settlementProjection.audit.pass) {
    writeDataFailure({
      manifest, mode, window, provenance,
      reason: !binanceFundingScheduleAudit.pass
        ? "Trial 7 economics are intentionally not calculated when the first-party Binance announced-funding schedule is incomplete."
        : "Trial 7 economics are intentionally not calculated when late settlement history cannot be projected into the frozen context window without using post-window market fields.",
      extraGate: {
        hyperliquidFundingTimestampNormalization: normalized.audit,
        binanceFundingScheduleAudit,
        settlementDiscoveryProjection: settlementProjection.audit
      }
    });
    return;
  }

  const result = evaluateCrossVenueFunding({
    manifest,
    manifestHash,
    records: settlementProjection.records,
    availableRawHashes: raw.hashes,
    mode,
    evaluationNowMs: Date.now()
  });
  result.dataGate = {
    ...result.dataGate,
    hyperliquidFundingTimestampNormalization: normalized.audit,
    binanceFundingScheduleAudit,
    settlementDiscoveryProjection: settlementProjection.audit,
    pass: Boolean(result.dataGate?.pass)
      && normalized.audit.pass
      && binanceFundingScheduleAudit.pass
      && settlementProjection.audit.pass
  };

  process.stdout.write(`${JSON.stringify({ ...result, provenance }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
