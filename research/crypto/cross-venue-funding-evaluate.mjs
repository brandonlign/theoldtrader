#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { evaluateCrossVenueFunding } from "./lib/cross-venue-funding.js";

const DEFAULT_MANIFEST = "research/crypto/manifests/cross-venue-funding-v1.json";

function usage() {
  throw new Error(
    "Usage: node research/crypto/cross-venue-funding-evaluate.mjs screening|final <compact.ndjson> <raw.ndjson.gz> [manifest.json]"
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readCompact(path) {
  const records = [];
  const input = fs.createReadStream(path);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  if (!records.length) throw new Error("Trial 7 compact recording is empty");
  return records;
}

async function readAndVerifyRaw(path, expectedManifestHash) {
  const hashes = new Set();
  let rows = 0;
  const input = fs.createReadStream(path).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows += 1;
    const record = JSON.parse(line);
    if (record.schema !== "theoldtrader-cross-venue-funding-v1-raw-v1") {
      throw new Error(`Unexpected Trial 7 raw schema at raw row ${rows}`);
    }
    if (record.manifestSha256 !== expectedManifestHash) {
      throw new Error(`Trial 7 raw row ${rows} was collected under a different manifest hash`);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(record.sha256 ?? ""))) {
      throw new Error(`Trial 7 raw row ${rows} has an invalid SHA-256 field`);
    }
    const recomputed = sha256(String(record.rawText ?? ""));
    if (recomputed !== String(record.sha256).toLowerCase()) {
      throw new Error(`Trial 7 raw-response SHA-256 mismatch at raw row ${rows}`);
    }
    hashes.add(recomputed);
  }
  if (!rows) throw new Error("Trial 7 raw-response archive is empty");
  return { hashes, rows };
}

async function main() {
  const [mode, compactPath, rawPath, manifestPath = DEFAULT_MANIFEST] = process.argv.slice(2);
  if (!['screening', 'final'].includes(mode) || !compactPath || !rawPath) usage();

  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestHash = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 manifest identity");
  }
  if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
    throw new Error("Trial 7 evaluator only accepts the frozen paper-only manifest");
  }

  const records = await readCompact(compactPath);
  const raw = await readAndVerifyRaw(rawPath, manifestHash);
  const compactHash = sha256(fs.readFileSync(compactPath));
  const rawArchiveHash = sha256(fs.readFileSync(rawPath));

  const result = evaluateCrossVenueFunding({
    manifest,
    manifestHash,
    records,
    availableRawHashes: raw.hashes,
    mode,
    evaluationNowMs: Date.now()
  });

  const output = {
    ...result,
    provenance: {
      manifestPath,
      manifestSha256: manifestHash,
      compactPath,
      compactSha256: compactHash,
      compactRows: records.length,
      rawPath,
      rawArchiveSha256: rawArchiveHash,
      rawRows: raw.rows,
      verifiedDistinctRawResponseHashes: raw.hashes.size
    }
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
