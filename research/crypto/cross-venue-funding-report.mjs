#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildCrossVenueFundingReport } from "./lib/cross-venue-funding-report.js";
import {
  binanceFundingScheduleCsv,
  validateTrial7ReportArtifact
} from "./lib/trial7-report-guard.js";
import { verifyTrial7CanonicalManifestBytes } from "./lib/trial7-freeze-identity.js";

const CANONICAL_MANIFEST = "research/crypto/manifests/cross-venue-funding-v1.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function usage() {
  throw new Error("Usage: node research/crypto/cross-venue-funding-report.mjs <evaluation.json> <new-output-dir>");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function settlementDiscoveryCsv(audit) {
  if (!audit) {
    return "venue,event_time,source_recorded_at,source_funding_history_sha256\nnot_reached,,,\n";
  }
  const rows = [["venue", "event_time", "source_recorded_at", "source_funding_history_sha256"]];
  for (const venue of ["hyperliquid", "binance"]) {
    for (const row of audit.provenance?.[venue] ?? []) {
      rows.push([venue, row.eventTime, row.sourceRecordedAt, row.sourceFundingHistorySha256]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function verifyCanonicalManifestBinding(result) {
  const bytes = fs.readFileSync(CANONICAL_MANIFEST);
  verifyTrial7CanonicalManifestBytes(bytes);
  const canonicalHash = sha256(bytes);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
    throw new Error("Unexpected canonical Trial 7 manifest identity");
  }
  const provenance = result?.provenance;
  if (
    provenance?.manifestPath !== CANONICAL_MANIFEST
    || provenance?.manifestSha256 !== canonicalHash
    || provenance?.canonicalManifestVerified !== true
  ) {
    throw new Error("Trial 7 evaluation artifact is not bound to the canonical repository manifest");
  }
  return canonicalHash;
}

const args = process.argv.slice(2);
if (args.length !== 2) usage();
const [resultPath, outputDir] = args;
if (!resultPath || !outputDir) usage();
if (fs.existsSync(outputDir)) {
  throw new Error(`Refusing to overwrite existing Trial 7 report directory: ${outputDir}`);
}
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const canonicalManifestSha256 = verifyCanonicalManifestBinding(result);
const guarded = validateTrial7ReportArtifact(result);
const files = buildCrossVenueFundingReport(result);
files["binance-funding-schedule.csv"] = binanceFundingScheduleCsv(guarded.scheduleAudit);
files["settlement-discovery.csv"] = settlementDiscoveryCsv(guarded.settlementProjection);

const schedule = guarded.scheduleAudit;
const settlement = guarded.settlementProjection;
files["REPORT.md"] = `${files["REPORT.md"].trimEnd()}\n\n## Canonical manifest binding\n\n- Manifest: \`${CANONICAL_MANIFEST}\`\n- SHA-256: \`${canonicalManifestSha256}\`\n- Exact frozen-manifest byte verification: **PASS**\n- Evaluator canonical-manifest verification: **PASS**\n\n## Binance settled-funding schedule audit\n\n- Gate: **${schedule ? (schedule.pass ? "PASS" : "FAIL") : "NOT REACHED"}**\n- Mechanism: ${schedule?.sourceMechanism ?? "n/a"}\n- Announced in-window funding times: ${schedule?.announcedFundingTimes?.length ?? 0}\n- Settled in-window funding times observed: ${schedule?.observedFundingTimes?.length ?? 0}\n- Missing announced events: ${schedule?.missingAnnouncedEvents?.length ?? 0}\n- Stale next-funding schedule rows: ${schedule?.staleScheduleRows?.length ?? 0}\n\n## Post-boundary settlement discovery isolation\n\n- Gate: **${settlement ? (settlement.pass ? "PASS" : "FAIL") : "NOT REACHED"}**\n- Context cutoff: ${settlement?.contextCutoff ?? "n/a"}\n- Settlement-discovery cutoff: ${settlement?.settlementDiscoveryCutoff ?? "n/a"}\n- Late discovery rows: ${settlement?.lateDiscoveryRows ?? 0}\n- Hyperliquid late in-window events appended: ${settlement?.appendedHyperliquidEvents ?? 0}\n- Binance late in-window events appended: ${settlement?.appendedBinanceEvents ?? 0}\n- Post-window market fields used in economics: **${settlement?.postWindowMarketFieldsUsed === true ? "YES — INVALID" : settlement ? "NO" : "NOT REACHED"}**\n- Event-level late-source timestamps/hashes: \`settlement-discovery.csv\`\n\n`;

fs.mkdirSync(outputDir, { recursive: false });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outputDir, name), content, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({
  input: resultPath,
  outputDir,
  classification: result.classification,
  canonicalManifestSha256,
  binanceFundingSchedulePass: schedule?.pass ?? null,
  settlementDiscoveryPass: settlement?.pass ?? null,
  files: Object.keys(files).sort()
}, null, 2)}\n`);
