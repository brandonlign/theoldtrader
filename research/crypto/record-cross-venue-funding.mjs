#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT = "research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const BINANCE_PREMIUM = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
const BINANCE_FUNDING = "https://fapi.binance.com/fapi/v1/fundingRate";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function hyperliquidSnapshot(nowMs) {
  const metaAndCtx = await fetchJson(HL_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" })
  });
  if (!Array.isArray(metaAndCtx) || metaAndCtx.length !== 2) throw new Error("Unexpected Hyperliquid metaAndAssetCtxs response");
  const [meta, contexts] = metaAndCtx;
  const index = meta?.universe?.findIndex((asset) => asset?.name === "BTC");
  if (!Number.isInteger(index) || index < 0 || !contexts?.[index]) throw new Error("BTC missing from Hyperliquid perpetual metadata");
  const rawBtc = { universe: meta.universe[index], context: contexts[index] };

  const fundingRaw = await fetchJson(HL_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "fundingHistory",
      coin: "BTC",
      startTime: nowMs - 20 * 60_000,
      endTime: nowMs
    })
  });
  const events = (Array.isArray(fundingRaw) ? fundingRaw : []).map((row) => ({
    time: Number(row.time),
    rate: Number(row.fundingRate),
    premium: row.premium == null ? null : Number(row.premium)
  })).filter((row) => Number.isFinite(row.time) && Number.isFinite(row.rate));

  const mark = Number(rawBtc.context.markPx);
  const currentFunding = Number(rawBtc.context.funding);
  if (!(mark > 0) || !Number.isFinite(currentFunding)) throw new Error("Invalid Hyperliquid BTC mark/funding snapshot");

  return {
    mark,
    currentFunding,
    events,
    raw: {
      btcMetaAndContext: rawBtc,
      fundingHistory: fundingRaw
    },
    hashes: {
      btcMetaAndContextSha256: sha256(rawBtc),
      fundingHistorySha256: sha256(fundingRaw)
    }
  };
}

async function binanceSnapshot(nowMs) {
  const premiumRaw = await fetchJson(BINANCE_PREMIUM);
  const fundingUrl = `${BINANCE_FUNDING}?symbol=BTCUSDT&startTime=${nowMs - 20 * 60_000}&endTime=${nowMs}&limit=10`;
  const fundingRaw = await fetchJson(fundingUrl);
  const events = (Array.isArray(fundingRaw) ? fundingRaw : []).map((row) => ({
    time: Number(row.fundingTime),
    rate: Number(row.fundingRate),
    markPrice: row.markPrice == null ? null : Number(row.markPrice)
  })).filter((row) => Number.isFinite(row.time) && Number.isFinite(row.rate));

  const mark = Number(premiumRaw.markPrice);
  const lastFundingRate = Number(premiumRaw.lastFundingRate);
  const nextFundingTime = Number(premiumRaw.nextFundingTime);
  if (!(mark > 0) || !Number.isFinite(lastFundingRate) || !Number.isFinite(nextFundingTime)) {
    throw new Error("Invalid Binance BTCUSDT premium-index snapshot");
  }

  return {
    mark,
    lastFundingRate,
    nextFundingTime,
    events,
    raw: { premiumIndex: premiumRaw, fundingHistory: fundingRaw },
    hashes: {
      premiumIndexSha256: sha256(premiumRaw),
      fundingHistorySha256: sha256(fundingRaw)
    }
  };
}

async function recordOnce(output) {
  const startedAt = Date.now();
  const [hyperliquid, binance] = await Promise.all([
    hyperliquidSnapshot(startedAt),
    binanceSnapshot(startedAt)
  ]);
  const finishedAt = Date.now();
  const record = {
    schema: "theoldtrader-cross-venue-funding-v1-record",
    recordedAt: new Date(finishedAt).toISOString(),
    collectionLatencyMs: finishedAt - startedAt,
    sources: {
      hyperliquid: {
        infoEndpoint: HL_INFO,
        mark: hyperliquid.mark,
        currentFunding: hyperliquid.currentFunding,
        events: hyperliquid.events,
        raw: hyperliquid.raw,
        hashes: hyperliquid.hashes
      },
      binance: {
        premiumIndexEndpoint: BINANCE_PREMIUM,
        fundingHistoryEndpoint: BINANCE_FUNDING,
        mark: binance.mark,
        lastFundingRate: binance.lastFundingRate,
        nextFundingTime: binance.nextFundingTime,
        events: binance.events,
        raw: binance.raw,
        hashes: binance.hashes
      }
    }
  };
  await mkdir(path.dirname(output), { recursive: true });
  await appendFile(output, `${JSON.stringify(record)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ output, recordedAt: record.recordedAt, hyperliquidMark: hyperliquid.mark, binanceMark: binance.mark, hyperliquidEvents: hyperliquid.events.length, binanceEvents: binance.events.length })}\n`);
}

function msUntilNextCollection(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(2, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

async function main() {
  const output = argValue("--output", DEFAULT_OUTPUT);
  const once = process.argv.includes("--once");
  const durationHours = Number(argValue("--duration-hours", "0"));
  if (once) return recordOnce(output);

  const deadline = durationHours > 0 ? Date.now() + durationHours * 3_600_000 : Infinity;
  while (Date.now() < deadline) {
    const wait = msUntilNextCollection();
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      await recordOnce(output);
    } catch (error) {
      console.error(`[cross-venue-funding-v1] ${new Date().toISOString()} collection failed:`, error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
