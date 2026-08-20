#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { evaluateBitnomialCarry } from "./lib/bitnomial-carry.js";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-carry-v1.json";
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function usage() { throw new Error("Usage: node research/crypto/evaluate-bitnomial-carry.mjs screening|final <compact.ndjson> <raw.ndjson.gz>"); }
function close(a, b, label, tolerance = 1e-10) {
  const left = Number(a), right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > tolerance * Math.max(1, Math.abs(left), Math.abs(right))) {
    throw new Error(`Trial 8 raw semantic mismatch for ${label}: ${a} vs ${b}`);
  }
}
function identifySpec(specs, productId) {
  if (!Array.isArray(specs)) throw new Error("Raw Bitnomial specs are not an array");
  const matches = specs.filter((spec) => Number(spec.product_id) === Number(productId));
  if (matches.length !== 1) throw new Error(`Raw Bitnomial spec identity count ${matches.length}`);
  return matches[0];
}
async function readCompact(file, startMs, discoveryEndMs) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const time = Date.parse(record.recordedAt);
    if (Number.isFinite(time) && time >= startMs && time <= discoveryEndMs) records.push(record);
  }
  if (!records.length) throw new Error("Trial 8 compact evidence window is empty");
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
    if (row.schema !== "theoldtrader-bitnomial-carry-v1-raw-v1" || row.experimentId !== "bitnomial-carry-v1" || row.trialNumber !== 8) throw new Error(`Unexpected Trial 8 raw row ${rows}`);
    if (row.manifestSha256 !== expectedManifestHash) throw new Error(`Trial 8 raw row ${rows} manifest mismatch`);
    const computed = sha256(String(row.rawText ?? ""));
    if (computed !== String(row.sha256).toLowerCase()) throw new Error(`Trial 8 raw SHA-256 mismatch at row ${rows}`);
    hashes.add(computed);
    if (!rowsByHash.has(computed)) rowsByHash.set(computed, []);
    rowsByHash.get(computed).push(row);
  }
  if (!rows) throw new Error("Trial 8 raw archive is empty");
  return { rows, hashes, rowsByHash };
}
function rawFor(record, source, hash, rowsByHash) {
  const candidates = (rowsByHash.get(String(hash).toLowerCase()) ?? []).filter((row) => row.source === source && row.recordedAt === record.recordedAt);
  if (candidates.length !== 1) throw new Error(`Trial 8 expected one raw ${source} row at ${record.recordedAt}, found ${candidates.length}`);
  return candidates[0];
}
function normalizeRawFunding(json, productId) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return rows.filter((row) => Number(row.product_id) === Number(productId)).map((row) => ({
    productId: Number(row.product_id),
    priceIndex: Number(row.price_index),
    markPrice: Number(row.mark_price),
    interestRate: Number(row.interest_rate),
    fundingRate: Number(row.funding_rate),
    intervalStart: new Date(row.interval_start).toISOString(),
    intervalEnd: new Date(row.interval_end).toISOString()
  })).sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
function auditSemantics(records, rowsByHash) {
  for (const record of records) {
    const cb = record.sources.coinbase;
    const bt = record.sources.bitnomial;
    const cbRaw = JSON.parse(rawFor(record, "coinbase-btc-usd-ticker", cb.hash, rowsByHash).rawText);
    close(cb.bid, cbRaw.bid, "Coinbase bid");
    close(cb.ask, cbRaw.ask, "Coinbase ask");
    close(cb.last, cbRaw.price, "Coinbase last");
    if (new Date(cbRaw.time).toISOString() !== cb.tickerTime) throw new Error("Trial 8 Coinbase ticker timestamp semantic mismatch");

    const specsRaw = JSON.parse(rawFor(record, "bitnomial-product-specs", bt.hashes.specs, rowsByHash).rawText);
    const spec = identifySpec(specsRaw, bt.productId);
    close(bt.contractSizeBtc, spec.contract_size, "Bitnomial contract size");
    close(bt.priceIncrement, spec.price_increment, "Bitnomial price increment");
    if (String(bt.symbol) !== String(spec.symbol) || String(bt.productName) !== String(spec.product_name)) throw new Error("Trial 8 Bitnomial spec semantic mismatch");

    const dataJson = JSON.parse(rawFor(record, "bitnomial-product-data", bt.hashes.productData, rowsByHash).rawText);
    const data = Array.isArray(dataJson) ? dataJson.find((row) => Number(row.product_id) === Number(bt.productId)) : dataJson;
    if (!data) throw new Error("Trial 8 raw Bitnomial product data missing product");
    close(bt.lastPriceUsd, Number(data.last_price) * Number(spec.price_increment), "Bitnomial last price USD");
    if (new Date(data.last_price_time).toISOString() !== bt.lastPriceTime) throw new Error("Trial 8 Bitnomial last-price timestamp semantic mismatch");

    const rawFunding = normalizeRawFunding(JSON.parse(rawFor(record, "bitnomial-funding-rates", bt.hashes.funding, rowsByHash).rawText), bt.productId);
    if (rawFunding.length !== bt.fundingEvents.length) throw new Error("Trial 8 funding event count semantic mismatch");
    for (let i = 0; i < rawFunding.length; i += 1) {
      const a = bt.fundingEvents[i], b = rawFunding[i];
      if (a.intervalStart !== b.intervalStart || a.intervalEnd !== b.intervalEnd || a.productId !== b.productId) throw new Error(`Trial 8 funding identity mismatch at ${i}`);
      close(a.priceIndex, b.priceIndex, `funding priceIndex[${i}]`);
      close(a.markPrice, b.markPrice, `funding markPrice[${i}]`);
      close(a.interestRate, b.interestRate, `funding interestRate[${i}]`);
      close(a.fundingRate, b.fundingRate, `funding rate[${i}]`);
    }
  }
  return { pass: true, compactRowsAudited: records.length };
}

async function main() {
  const [mode, compactPath, rawPath] = process.argv.slice(2);
  if (!["screening", "final"].includes(mode) || !compactPath || !rawPath || process.argv.slice(2).length !== 3) usage();
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifestHash = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const startMs = Date.parse(manifest.forwardWindow.startInclusive);
  const endMs = Date.parse(mode === "screening" ? manifest.forwardWindow.screeningEndExclusive : manifest.forwardWindow.finalEndExclusive);
  const discoveryEndMs = endMs + manifest.forwardWindow.fundingDiscoveryLookaheadMinutes * 60_000;
  const notBefore = endMs + manifest.forwardWindow.earliestEvaluationDelayMinutesAfterBoundary * 60_000;
  if (Date.now() < notBefore) throw new Error(`Refusing Trial 8 ${mode} evaluation before ${new Date(notBefore).toISOString()}`);
  const records = await readCompact(compactPath, startMs, discoveryEndMs);
  const raw = await readRaw(rawPath, manifestHash);
  const semanticAudit = auditSemantics(records, raw.rowsByHash);
  const result = evaluateBitnomialCarry({ manifest, manifestHash, records, availableRawHashes: raw.hashes, mode, evaluationNowMs: Date.now() });
  const output = {
    ...result,
    provenance: {
      manifestPath: MANIFEST_PATH,
      manifestSha256: manifestHash,
      compactPath,
      compactSha256: sha256(fs.readFileSync(compactPath)),
      rawPath,
      rawArchiveSha256: sha256(fs.readFileSync(rawPath)),
      rawRows: raw.rows,
      rawSemanticAudit: semanticAudit,
      discoveryCutoff: new Date(discoveryEndMs).toISOString(),
      firstPartyOnly: true
    }
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
