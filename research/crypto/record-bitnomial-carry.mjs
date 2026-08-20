#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-carry-v1.json";
const DEFAULT_OUTPUT = "research/crypto/data-cache/bitnomial-carry-v1-forward.ndjson";
const COINBASE_TICKER = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
const BITNOMIAL_PROD_BASE = "https://bitnomial.com/exchange/api/v1/prod";
const SPECS_URL = `${BITNOMIAL_PROD_BASE}/product/specs/?active=true`;
const FUNDING_BASE_URL = "https://bitnomial.com/exchange/api/v1/funding-rates/";
const LOOKBACK_MS = 13 * 60 * 60 * 1000;

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function fetchRawJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "TheOldTrader-Research/Trial8" } });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${rawText.slice(0, 300)}`);
    return { json: JSON.parse(rawText), rawText, sha256: sha256(rawText), status: response.status, url };
  } finally {
    clearTimeout(timer);
  }
}
function positive(value, label) {
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}
function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}
function identifyBitnomialSpec(specs, manifest) {
  if (!Array.isArray(specs)) throw new Error("Bitnomial product specs response is not an array");
  const expected = manifest.venues.perpetualShort;
  const candidates = specs.filter((spec) => {
    const name = String(spec?.product_name ?? "").toLowerCase();
    const symbol = String(spec?.symbol ?? "").toUpperCase();
    const base = String(spec?.base_symbol ?? "").toUpperCase();
    return spec?.product_status === "active"
      && String(spec?.type ?? "").toLowerCase() === "future"
      && (symbol === expected.productCode || base === expected.productCode || name.includes("bitcoin us dollar centi perpetual"));
  });
  if (candidates.length !== 1) throw new Error(`Expected exactly one active Bitnomial BTC centi perpetual, found ${candidates.length}`);
  const spec = candidates[0];
  if (Math.abs(Number(spec.contract_size) - expected.contractSizeBtc) > 1e-12 || String(spec.contract_size_unit).toLowerCase() !== "bitcoin") {
    throw new Error("Bitnomial BTC perpetual contract size/unit does not match frozen Trial 8 identity");
  }
  positive(spec.price_increment, "Bitnomial price increment");
  return spec;
}
function normalizeFunding(json, productId) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return rows
    .filter((row) => Number(row.product_id) === Number(productId))
    .map((row) => ({
      productId: Number(row.product_id),
      priceIndex: positive(row.price_index, "Bitnomial funding price_index"),
      markPrice: positive(row.mark_price, "Bitnomial funding mark_price"),
      interestRate: finite(row.interest_rate, "Bitnomial funding interest_rate"),
      fundingRate: finite(row.funding_rate, "Bitnomial funding_rate"),
      intervalStart: new Date(row.interval_start).toISOString(),
      intervalEnd: new Date(row.interval_end).toISOString()
    }))
    .sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
async function loadManifest() {
  const bytes = await fs.readFile(MANIFEST_PATH);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.experimentId !== "bitnomial-carry-v1" || manifest.trialNumber !== 8 || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
    throw new Error("Unexpected Trial 8 canonical manifest");
  }
  return { manifest, bytes, hash: sha256(bytes) };
}
async function snapshot(nowMs, manifest) {
  const specsRaw = await fetchRawJson(SPECS_URL);
  const spec = identifyBitnomialSpec(specsRaw.json, manifest);
  const productDataUrl = `${BITNOMIAL_PROD_BASE}/product/data/${encodeURIComponent(spec.product_id)}`;
  const begin = new Date(nowMs - LOOKBACK_MS).toISOString();
  const end = new Date(nowMs + 60_000).toISOString();
  const fundingUrl = `${FUNDING_BASE_URL}?base_symbol=${encodeURIComponent(manifest.venues.perpetualShort.fundingBaseSymbol)}&begin_time=${encodeURIComponent(begin)}&end_time=${encodeURIComponent(end)}&limit=100&order=asc`;
  const [coinbaseRaw, dataRaw, fundingRaw] = await Promise.all([
    fetchRawJson(COINBASE_TICKER),
    fetchRawJson(productDataUrl),
    fetchRawJson(fundingUrl)
  ]);

  const cb = coinbaseRaw.json;
  const bid = positive(cb.bid, "Coinbase bid");
  const ask = positive(cb.ask, "Coinbase ask");
  const last = positive(cb.price, "Coinbase last");
  const tickerTime = new Date(cb.time);
  if (!Number.isFinite(tickerTime.getTime())) throw new Error("Invalid Coinbase ticker time");
  if (ask < bid) throw new Error("Coinbase ask below bid");

  const data = Array.isArray(dataRaw.json) ? dataRaw.json.find((row) => Number(row.product_id) === Number(spec.product_id)) : dataRaw.json;
  if (!data || Number(data.product_id) !== Number(spec.product_id)) throw new Error("Bitnomial product data identity mismatch");
  const lastTicks = positive(data.last_price, "Bitnomial last price ticks");
  const priceIncrement = positive(spec.price_increment, "Bitnomial price increment");
  const perpetualLastUsd = lastTicks * priceIncrement;
  const lastPriceTime = new Date(data.last_price_time);
  if (!Number.isFinite(lastPriceTime.getTime())) throw new Error("Bitnomial last_price_time is missing or invalid");
  const fundingEvents = normalizeFunding(fundingRaw.json, spec.product_id);

  return {
    compact: {
      coinbase: {
        product: "BTC-USD",
        bid,
        ask,
        last,
        tickerTime: tickerTime.toISOString(),
        hash: coinbaseRaw.sha256
      },
      bitnomial: {
        productId: Number(spec.product_id),
        symbol: String(spec.symbol),
        baseSymbol: String(spec.base_symbol),
        productName: String(spec.product_name),
        contractSizeBtc: Number(spec.contract_size),
        priceIncrement,
        lastPriceUsd: perpetualLastUsd,
        lastPriceTime: lastPriceTime.toISOString(),
        fundingEvents,
        hashes: {
          specs: specsRaw.sha256,
          productData: dataRaw.sha256,
          funding: fundingRaw.sha256
        }
      }
    },
    raw: [
      { source: "coinbase-btc-usd-ticker", ...coinbaseRaw },
      { source: "bitnomial-product-specs", ...specsRaw },
      { source: "bitnomial-product-data", ...dataRaw },
      { source: "bitnomial-funding-rates", ...fundingRaw }
    ].map(({ json, ...row }) => row)
  };
}
function rawPathFor(output) {
  return output.endsWith(".ndjson") ? output.replace(/\.ndjson$/, ".raw.ndjson.gz") : `${output}.raw.ndjson.gz`;
}
async function appendRaw(rawPath, rows) {
  for (const row of rows) await fs.appendFile(rawPath, gzipSync(Buffer.from(`${JSON.stringify(row)}\n`)));
}
async function recordOnce({ connectivityOnly = false, output = DEFAULT_OUTPUT } = {}) {
  const frozen = await loadManifest();
  const now = Date.now();
  const startMs = Date.parse(frozen.manifest.forwardWindow.startInclusive);
  if (!connectivityOnly && now < startMs) throw new Error(`Trial 8 scientific collection is sealed until ${frozen.manifest.forwardWindow.startInclusive}`);
  const started = Date.now();
  const result = await snapshot(started, frozen.manifest);
  const finished = Date.now();
  if (connectivityOnly) {
    process.stdout.write(`${JSON.stringify({
      connectivityOnly: true,
      experimentId: frozen.manifest.experimentId,
      trialNumber: 8,
      manifestSha256: frozen.hash,
      coinbaseSchemaValid: true,
      bitnomialSchemaValid: true,
      bitnomialProductIdentityValid: true,
      collectionLatencyMs: finished - started
    })}\n`);
    return;
  }
  const recordedAt = new Date(finished).toISOString();
  await fs.mkdir(path.dirname(output), { recursive: true });
  const rawPath = rawPathFor(output);
  const rawRows = result.raw.map((row) => ({
    schema: "theoldtrader-bitnomial-carry-v1-raw-v1",
    experimentId: frozen.manifest.experimentId,
    trialNumber: 8,
    manifestSha256: frozen.hash,
    recordedAt,
    source: row.source,
    url: row.url,
    status: row.status,
    sha256: row.sha256,
    rawText: row.rawText
  }));
  await appendRaw(rawPath, rawRows);
  const compact = {
    schema: "theoldtrader-bitnomial-carry-v1-record-v1",
    experimentId: frozen.manifest.experimentId,
    trialNumber: 8,
    manifestSha256: frozen.hash,
    acquisition: { type: "PRIMARY_LIVE", collector: "theoldtrader-trial8-recorder-v1" },
    recordedAt,
    collectionLatencyMs: finished - started,
    sources: result.compact
  };
  await fs.appendFile(output, `${JSON.stringify(compact)}\n`);
  process.stdout.write(`${JSON.stringify({ output, rawOutput: rawPath, recordedAt, productId: compact.sources.bitnomial.productId })}\n`);
}
function msUntilNextCollection(now = new Date(), offsetSeconds = 15) {
  const target = new Date(now);
  target.setUTCMinutes(0, offsetSeconds, 0);
  if (target <= now) target.setUTCHours(target.getUTCHours() + 1);
  return target.getTime() - now.getTime();
}
async function main() {
  const connectivityOnly = process.argv.includes("--connectivity-only");
  const once = process.argv.includes("--once");
  const output = argValue("--output", DEFAULT_OUTPUT);
  if (connectivityOnly) return recordOnce({ connectivityOnly: true, output });
  if (once) return recordOnce({ output });
  const frozen = await loadManifest();
  const startMs = Date.parse(frozen.manifest.forwardWindow.startInclusive);
  if (Date.now() < startMs) await new Promise((resolve) => setTimeout(resolve, startMs - Date.now()));
  for (;;) {
    const wait = msUntilNextCollection(new Date(), frozen.manifest.forwardWindow.primaryCollectionOffsetSecondsAfterUtcHour);
    await new Promise((resolve) => setTimeout(resolve, wait));
    try { await recordOnce({ output }); }
    catch (error) { console.error(`[Trial8] ${new Date().toISOString()} collection failed:`, error); }
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
