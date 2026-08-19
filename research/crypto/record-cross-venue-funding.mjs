#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DEFAULT_MANIFEST = "research/crypto/manifests/cross-venue-funding-v1.json";
const DEFAULT_OUTPUT = "research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const BINANCE_PREMIUM = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
const BINANCE_FUNDING = "https://fapi.binance.com/fapi/v1/fundingRate";
const LOOKBACK_MS = 130 * 60_000;

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchRawJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${rawText.slice(0, 300)}`);
    return {
      json: JSON.parse(rawText),
      rawText,
      sha256: sha256(rawText),
      status: response.status
    };
  } finally {
    clearTimeout(timer);
  }
}

async function hyperliquidSnapshot(nowMs) {
  const metaRequestBody = JSON.stringify({ type: "metaAndAssetCtxs" });
  const meta = await fetchRawJson(HL_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: metaRequestBody
  });
  if (!Array.isArray(meta.json) || meta.json.length !== 2) {
    throw new Error("Unexpected Hyperliquid metaAndAssetCtxs response");
  }
  const [universeMeta, contexts] = meta.json;
  const index = universeMeta?.universe?.findIndex((asset) => asset?.name === "BTC");
  if (!Number.isInteger(index) || index < 0 || !contexts?.[index]) {
    throw new Error("BTC missing from Hyperliquid perpetual metadata");
  }
  const context = contexts[index];
  const mark = Number(context.markPx);
  const oracle = Number(context.oraclePx);
  const currentFunding = Number(context.funding);
  if (!(mark > 0) || !(oracle > 0) || !Number.isFinite(currentFunding)) {
    throw new Error("Invalid Hyperliquid BTC mark/oracle/funding context");
  }

  const fundingRequestBody = JSON.stringify({
    type: "fundingHistory",
    coin: "BTC",
    startTime: nowMs - LOOKBACK_MS,
    endTime: nowMs
  });
  const funding = await fetchRawJson(HL_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: fundingRequestBody
  });
  const events = (Array.isArray(funding.json) ? funding.json : [])
    .map((row) => ({
      time: Number(row.time),
      rate: Number(row.fundingRate),
      premium: row.premium == null ? null : Number(row.premium)
    }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.rate));

  return {
    compact: {
      mark,
      oracle,
      currentFunding,
      events,
      hashes: {
        metaAndAssetCtxsSha256: meta.sha256,
        fundingHistorySha256: funding.sha256
      }
    },
    raw: [
      {
        source: "hyperliquid-metaAndAssetCtxs",
        url: HL_INFO,
        method: "POST",
        requestBody: metaRequestBody,
        status: meta.status,
        sha256: meta.sha256,
        rawText: meta.rawText
      },
      {
        source: "hyperliquid-fundingHistory",
        url: HL_INFO,
        method: "POST",
        requestBody: fundingRequestBody,
        status: funding.status,
        sha256: funding.sha256,
        rawText: funding.rawText
      }
    ]
  };
}

async function binanceSnapshot(nowMs) {
  const premium = await fetchRawJson(BINANCE_PREMIUM);
  const fundingUrl = `${BINANCE_FUNDING}?symbol=BTCUSDT&startTime=${nowMs - LOOKBACK_MS}&endTime=${nowMs}&limit=100`;
  const funding = await fetchRawJson(fundingUrl);

  const mark = Number(premium.json?.markPrice);
  const indexPrice = Number(premium.json?.indexPrice);
  const lastFundingRate = Number(premium.json?.lastFundingRate);
  const nextFundingTime = Number(premium.json?.nextFundingTime);
  if (!(mark > 0) || !(indexPrice > 0) || !Number.isFinite(lastFundingRate) || !Number.isFinite(nextFundingTime)) {
    throw new Error("Invalid Binance BTCUSDT premium-index snapshot");
  }
  const events = (Array.isArray(funding.json) ? funding.json : [])
    .map((row) => ({
      time: Number(row.fundingTime),
      rate: Number(row.fundingRate),
      markPrice: row.markPrice == null ? null : Number(row.markPrice),
      rateType: row.rateType ?? null
    }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.rate));
  if (events.some((event) => !(event.markPrice > 0))) {
    throw new Error("Binance funding event missing official markPrice");
  }

  return {
    compact: {
      mark,
      indexPrice,
      lastFundingRate,
      nextFundingTime,
      events,
      hashes: {
        premiumIndexSha256: premium.sha256,
        fundingHistorySha256: funding.sha256
      }
    },
    raw: [
      {
        source: "binance-premiumIndex",
        url: BINANCE_PREMIUM,
        method: "GET",
        requestBody: null,
        status: premium.status,
        sha256: premium.sha256,
        rawText: premium.rawText
      },
      {
        source: "binance-fundingRate",
        url: fundingUrl,
        method: "GET",
        requestBody: null,
        status: funding.status,
        sha256: funding.sha256,
        rawText: funding.rawText
      }
    ]
  };
}

async function loadManifest(manifestPath) {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 manifest identity");
  }
  if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
    throw new Error("Recorder only supports frozen paper-only Trial 7");
  }
  return { manifest, sha256: sha256(bytes) };
}

function rawOutputPath(output) {
  return output.endsWith(".ndjson") ? output.replace(/\.ndjson$/, ".raw.ndjson.gz") : `${output}.raw.ndjson.gz`;
}

async function appendRawMembers(rawPath, envelope) {
  for (const raw of envelope) {
    const line = `${JSON.stringify(raw)}\n`;
    await appendFile(rawPath, gzipSync(Buffer.from(line, "utf8")));
  }
}

async function recordOnce({ output, manifestPath, allowPrestartConnectivity = false }) {
  const frozen = await loadManifest(manifestPath);
  const scientificStartMs = Date.parse(frozen.manifest.forwardWindow.startInclusive);
  const startedAt = Date.now();
  if (!allowPrestartConnectivity && startedAt < scientificStartMs) {
    throw new Error(`Scientific Trial 7 collection is sealed until ${frozen.manifest.forwardWindow.startInclusive}`);
  }

  const [hyperliquid, binance] = await Promise.all([
    hyperliquidSnapshot(startedAt),
    binanceSnapshot(startedAt)
  ]);
  const finishedAt = Date.now();

  if (allowPrestartConnectivity) {
    process.stdout.write(`${JSON.stringify({
      connectivityOnly: true,
      manifestSha256: frozen.sha256,
      hyperliquidSchemaValid: true,
      binanceSchemaValid: true,
      collectionLatencyMs: finishedAt - startedAt
    })}\n`);
    return;
  }

  const rawPath = rawOutputPath(output);
  await mkdir(path.dirname(output), { recursive: true });
  const rawEnvelope = [...hyperliquid.raw, ...binance.raw].map((row) => ({
    schema: "theoldtrader-cross-venue-funding-v1-raw-v1",
    recordedAt: new Date(finishedAt).toISOString(),
    manifestSha256: frozen.sha256,
    ...row
  }));
  await appendRawMembers(rawPath, rawEnvelope);

  const record = {
    schema: "theoldtrader-cross-venue-funding-v1-record-v2",
    experimentId: frozen.manifest.experimentId,
    trialNumber: frozen.manifest.trialNumber,
    manifestSha256: frozen.sha256,
    recordedAt: new Date(finishedAt).toISOString(),
    collectionLatencyMs: finishedAt - startedAt,
    sources: {
      hyperliquid: hyperliquid.compact,
      binance: binance.compact
    }
  };
  await appendFile(output, `${JSON.stringify(record)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output,
    rawOutput: rawPath,
    recordedAt: record.recordedAt,
    manifestSha256: frozen.sha256,
    hyperliquidEvents: hyperliquid.compact.events.length,
    binanceEvents: binance.compact.events.length
  })}\n`);
}

function msUntilNextCollection(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(2, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

async function main() {
  const output = argValue("--output", DEFAULT_OUTPUT);
  const manifestPath = argValue("--manifest", DEFAULT_MANIFEST);
  const once = process.argv.includes("--once");
  const connectivityOnly = process.argv.includes("--connectivity-only");
  const durationHours = Number(argValue("--duration-hours", "0"));

  if (connectivityOnly) {
    return recordOnce({ output, manifestPath, allowPrestartConnectivity: true });
  }
  if (once) return recordOnce({ output, manifestPath });

  const frozen = await loadManifest(manifestPath);
  const scientificStartMs = Date.parse(frozen.manifest.forwardWindow.startInclusive);
  if (Date.now() < scientificStartMs) {
    await new Promise((resolve) => setTimeout(resolve, scientificStartMs - Date.now()));
  }
  const deadline = durationHours > 0 ? Date.now() + durationHours * 3_600_000 : Infinity;
  while (Date.now() < deadline) {
    const wait = msUntilNextCollection();
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      await recordOnce({ output, manifestPath });
    } catch (error) {
      console.error(`[cross-venue-funding-v1] ${new Date().toISOString()} collection failed:`, error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
