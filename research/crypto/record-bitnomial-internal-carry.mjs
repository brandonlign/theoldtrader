#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  identifyPerpetualProductIdFromFunding,
  validateInternalCarryPerpetualSpec,
  validateInternalCarrySpotSpec
} from "./lib/bitnomial-internal-carry-identity.js";
import { normalizeBookSnapshot } from "./lib/bitnomial-book.js";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-internal-carry-v1.json";
const DEFAULT_OUTPUT = "research/crypto/data-cache/bitnomial-internal-carry-v1-forward.ndjson";
const LOOKBACK_MS = 13 * 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const argValue = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
};

async function fetchRawJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "TheOldTrader-Research/Trial9" } });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${rawText.slice(0, 300)}`);
    return { json: JSON.parse(rawText), rawText, sha256: sha256(rawText), status: response.status, url };
  } finally {
    clearTimeout(timer);
  }
}
function rows(json) { return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []; }
function positive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !(n > 0)) throw new Error(`Invalid ${label}`);
  return n;
}
async function loadManifest() {
  const bytes = await fs.readFile(MANIFEST_PATH);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.experimentId !== "bitnomial-internal-carry-v1" || manifest.trialNumber !== 9 || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
    throw new Error("Unexpected Trial 9 manifest identity");
  }
  return { manifest, bytes, hash: sha256(bytes) };
}
function normalizeFunding(json, productId) {
  return rows(json)
    .filter((row) => Number(row.product_id) === Number(productId))
    .map((row) => ({
      productId: Number(row.product_id),
      priceIndex: positive(row.price_index, "funding price_index"),
      markPrice: positive(row.mark_price, "funding mark_price"),
      interestRate: Number(row.interest_rate),
      fundingRate: Number(row.funding_rate),
      intervalStart: new Date(row.interval_start).toISOString(),
      intervalEnd: new Date(row.interval_end).toISOString()
    }))
    .sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
function dataRow(json, productId) {
  const candidates = rows(json).length ? rows(json) : [json];
  const row = candidates.find((item) => Number(item?.product_id) === Number(productId));
  if (!row) throw new Error(`Missing Bitnomial product data for product ${productId}`);
  return row;
}

async function getInitialBooks({ websocketUrl, specs, timeoutSeconds }) {
  if (typeof WebSocket !== "function") throw new Error("Trial 9 recorder requires Node with global WebSocket support (Node 22+ recommended)");
  return new Promise((resolve, reject) => {
    const wanted = new Map(specs.map((spec) => [String(spec.symbol), spec]));
    const result = new Map();
    const ws = new WebSocket(websocketUrl);
    let done = false;
    const finishError = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => finishError(new Error(`Timed out waiting for Bitnomial initial books: ${[...result.keys()].join(",") || "none"}`)), timeoutSeconds * 1000);
    ws.addEventListener("open", () => {
      const symbols = [...wanted.keys()];
      ws.send(JSON.stringify({ type: "subscribe", product_codes: [], channels: [{ name: "book", product_codes: symbols }] }));
    });
    ws.addEventListener("message", async (event) => {
      try {
        let rawText;
        if (typeof event.data === "string") rawText = event.data;
        else if (event.data && typeof event.data.text === "function") rawText = await event.data.text();
        else if (event.data instanceof ArrayBuffer) rawText = Buffer.from(event.data).toString("utf8");
        else if (ArrayBuffer.isView(event.data)) rawText = Buffer.from(event.data.buffer, event.data.byteOffset, event.data.byteLength).toString("utf8");
        else rawText = String(event.data);
        const payload = JSON.parse(rawText);
        const messages = Array.isArray(payload) ? payload : [payload];
        for (const message of messages) {
          if (message?.type === "disconnect") return finishError(new Error(`Bitnomial WebSocket disconnected: ${message.reason ?? "unknown"}`));
          if (message?.type !== "book" || !wanted.has(String(message.symbol))) continue;
          const spec = wanted.get(String(message.symbol));
          const book = normalizeBookSnapshot(message, {
            symbol: spec.symbol,
            priceIncrement: spec.price_increment,
            contractSizeBtc: spec.contract_size
          });
          if (!result.has(spec.symbol)) {
            result.set(spec.symbol, { book, rawText, sha256: sha256(rawText) });
          }
        }
        if (!done && result.size === wanted.size) {
          done = true;
          clearTimeout(timer);
          try { ws.close(1000, "trial9-snapshot-complete"); } catch {}
          resolve(result);
        }
      } catch (error) {
        finishError(error);
      }
    });
    ws.addEventListener("error", () => finishError(new Error("Bitnomial WebSocket error")));
  });
}

async function snapshot(nowMs, manifest) {
  const rest = manifest.publicData.restBase.replace(/\/$/, "");
  const fundingUrl = `${manifest.publicData.fundingEndpoint}?base_symbol=${encodeURIComponent(manifest.venues.perpetualShort.fundingBaseSymbol)}&begin_time=${encodeURIComponent(new Date(nowMs - LOOKBACK_MS).toISOString())}&end_time=${encodeURIComponent(new Date(nowMs + 60_000).toISOString())}&limit=100&order=asc`;
  const spotSpecsUrl = `${rest}/product/specs/?active=true&base_symbol=BTCUSD`;
  const [fundingRaw, spotSpecsRaw] = await Promise.all([fetchRawJson(fundingUrl), fetchRawJson(spotSpecsUrl)]);
  const perpId = identifyPerpetualProductIdFromFunding(fundingRaw.json);
  const perpSpecRaw = await fetchRawJson(`${rest}/product/spec/${perpId}`);
  const perpSpec = validateInternalCarryPerpetualSpec(Array.isArray(perpSpecRaw.json) ? perpSpecRaw.json[0] : perpSpecRaw.json, perpId);
  const spotCandidates = rows(spotSpecsRaw.json).filter((spec) => String(spec.symbol ?? "").toUpperCase() === "BTCUSD");
  if (spotCandidates.length !== 1) throw new Error(`Expected one active Bitnomial BTCUSD spot spec, found ${spotCandidates.length}`);
  const spotSpec = validateInternalCarrySpotSpec(spotCandidates[0]);

  const [spotDataRaw, perpDataRaw, books] = await Promise.all([
    fetchRawJson(`${rest}/product/data/${spotSpec.product_id}`),
    fetchRawJson(`${rest}/product/data/${perpId}`),
    getInitialBooks({ websocketUrl: manifest.publicData.websocket, specs: [spotSpec, perpSpec], timeoutSeconds: manifest.publicData.bookSnapshotTimeoutSeconds })
  ]);
  const spotData = dataRow(spotDataRaw.json, spotSpec.product_id);
  const perpData = dataRow(perpDataRaw.json, perpId);
  const spotBook = books.get(spotSpec.symbol);
  const perpBook = books.get(perpSpec.symbol);
  if (!spotBook || !perpBook) throw new Error("Trial 9 did not obtain both initial order books");
  const spotLast = positive(spotData.last_price, "spot last_price ticks") * positive(spotSpec.price_increment, "spot price increment");
  const perpLast = positive(perpData.last_price, "perpetual last_price ticks") * positive(perpSpec.price_increment, "perpetual price increment");

  const compact = {
    spot: {
      productId: Number(spotSpec.product_id),
      symbol: String(spotSpec.symbol),
      productName: String(spotSpec.product_name),
      contractSizeBtc: Number(spotSpec.contract_size),
      priceIncrement: Number(spotSpec.price_increment),
      lastPriceUsd: spotLast,
      lastPriceTime: spotData.last_price_time ? new Date(spotData.last_price_time).toISOString() : null,
      book: spotBook.book,
      hashes: { spec: spotSpecsRaw.sha256, productData: spotDataRaw.sha256, book: spotBook.sha256 }
    },
    perpetual: {
      productId: Number(perpId),
      symbol: String(perpSpec.symbol),
      productName: String(perpSpec.product_name),
      contractSizeBtc: Number(perpSpec.contract_size),
      priceIncrement: Number(perpSpec.price_increment),
      lastPriceUsd: perpLast,
      lastPriceTime: perpData.last_price_time ? new Date(perpData.last_price_time).toISOString() : null,
      book: perpBook.book,
      fundingEvents: normalizeFunding(fundingRaw.json, perpId),
      hashes: { spec: perpSpecRaw.sha256, productData: perpDataRaw.sha256, funding: fundingRaw.sha256, book: perpBook.sha256 }
    }
  };
  const raw = [
    { source: "bitnomial-spot-specs", ...spotSpecsRaw },
    { source: "bitnomial-perpetual-spec", ...perpSpecRaw },
    { source: "bitnomial-spot-product-data", ...spotDataRaw },
    { source: "bitnomial-perpetual-product-data", ...perpDataRaw },
    { source: "bitnomial-funding-rates", ...fundingRaw },
    { source: "bitnomial-spot-book", url: manifest.publicData.websocket, status: 101, rawText: spotBook.rawText, sha256: spotBook.sha256 },
    { source: "bitnomial-perpetual-book", url: manifest.publicData.websocket, status: 101, rawText: perpBook.rawText, sha256: perpBook.sha256 }
  ].map(({ json, ...item }) => item);
  return { compact, raw };
}

const rawPathFor = (output) => output.endsWith(".ndjson") ? output.replace(/\.ndjson$/, ".raw.ndjson.gz") : `${output}.raw.ndjson.gz`;

async function recordOnce({ output = DEFAULT_OUTPUT, connectivityOnly = false } = {}) {
  const frozen = await loadManifest();
  const started = Date.now();
  if (!connectivityOnly) {
    if (frozen.manifest.status !== "FROZEN_FORWARD_BEFORE_FIRST_TRIAL9_OBSERVATION") throw new Error("Trial 9 recording is disabled until the manifest is formally frozen");
    const startMs = Date.parse(frozen.manifest.forwardWindow?.startInclusive);
    if (!Number.isFinite(startMs) || started < startMs) throw new Error(`Trial 9 collection is sealed until ${frozen.manifest.forwardWindow?.startInclusive ?? "a frozen future boundary"}`);
  }
  const snap = await snapshot(started, frozen.manifest);
  const finished = Date.now();
  if (connectivityOnly) {
    process.stdout.write(`${JSON.stringify({ connectivityOnly: true, candidateValuesExposed: false, experimentId: frozen.manifest.experimentId, trialNumber: 9, manifestSha256: frozen.hash, spotIdentityValid: true, perpetualIdentityValid: true, fundingFeedValid: true, spotBookValid: true, perpetualBookValid: true, rawSourcesValidated: snap.raw.length, collectionLatencyMs: finished - started })}\n`);
    return;
  }
  const recordedAt = new Date(finished).toISOString();
  const rawOutput = rawPathFor(output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  for (const row of snap.raw) {
    const envelope = { schema: "theoldtrader-bitnomial-internal-carry-v1-raw-v1", experimentId: frozen.manifest.experimentId, trialNumber: 9, manifestSha256: frozen.hash, recordedAt, source: row.source, url: row.url, status: row.status, sha256: row.sha256, rawText: row.rawText };
    await fs.appendFile(rawOutput, gzipSync(Buffer.from(`${JSON.stringify(envelope)}\n`)));
  }
  const compact = {
    schema: "theoldtrader-bitnomial-internal-carry-v1-record-v1",
    experimentId: frozen.manifest.experimentId,
    trialNumber: 9,
    manifestSha256: frozen.hash,
    acquisition: { type: "PRIMARY_LIVE", collector: "theoldtrader-trial9-recorder-v1" },
    recordedAt,
    collectionLatencyMs: finished - started,
    sources: snap.compact
  };
  await fs.appendFile(output, `${JSON.stringify(compact)}\n`);
  process.stdout.write(`${JSON.stringify({ output, rawOutput, recordedAt, spotProductId: compact.sources.spot.productId, perpetualProductId: compact.sources.perpetual.productId })}\n`);
}

function msUntilNextHour(offsetSeconds) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, offsetSeconds, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

async function main() {
  const output = argValue("--output", DEFAULT_OUTPUT);
  if (process.argv.includes("--connectivity-only")) return recordOnce({ output, connectivityOnly: true });
  if (process.argv.includes("--once")) return recordOnce({ output });
  const frozen = await loadManifest();
  if (frozen.manifest.status !== "FROZEN_FORWARD_BEFORE_FIRST_TRIAL9_OBSERVATION") throw new Error("Trial 9 continuous recorder refuses the unfrozen development manifest");
  const startMs = Date.parse(frozen.manifest.forwardWindow.startInclusive);
  if (Date.now() < startMs) await new Promise((resolve) => setTimeout(resolve, startMs - Date.now()));
  const offset = Number(frozen.manifest.forwardWindow.primaryCollectionOffsetSecondsAfterUtcHour);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, msUntilNextHour(offset)));
    try { await recordOnce({ output }); }
    catch (error) { console.error(`[Trial9] ${new Date().toISOString()} collection failed:`, error); }
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
