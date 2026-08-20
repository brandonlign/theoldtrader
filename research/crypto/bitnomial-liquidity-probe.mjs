#!/usr/bin/env node

import fs from "node:fs/promises";
import {
  identifyPerpetualProductIdFromFunding,
  validateInternalCarryPerpetualSpec,
  validateInternalCarrySpotSpec
} from "./lib/bitnomial-internal-carry-identity.js";
import { executableVwap, normalizeBookSnapshot } from "./lib/bitnomial-book.js";

const MANIFEST_PATH = "research/crypto/manifests/bitnomial-internal-carry-v1.json";
const PROBE_SECONDS = Math.max(30, Math.min(180, Number(process.env.TRIAL9_PROBE_SECONDS ?? 120)));
const TEST_SIZES_BTC = [0.01, 0.02];

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "TheOldTrader-Research/Trial9-Liquidity-Probe" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 250)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
function rows(json) { return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []; }
async function wsText(data) {
  if (typeof data === "string") return data;
  if (data && typeof data.text === "function") return data.text();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

function newStats() {
  return {
    bookSnapshots: 0,
    emptySideSnapshots: 0,
    twoSidedSnapshots: 0,
    crossedOrMalformedSnapshots: 0,
    sizes: Object.fromEntries(TEST_SIZES_BTC.map((size) => [String(size), { buyExecutable: 0, sellExecutable: 0, bothExecutable: 0 }]))
  };
}

async function resolveSpecs(manifest) {
  const rest = manifest.publicData.restBase.replace(/\/$/, "");
  const fundingUrl = `${manifest.publicData.fundingEndpoint}?base_symbol=BTCUC&begin_time=${encodeURIComponent(new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString())}&limit=100&order=desc`;
  const [funding, spotSpecs] = await Promise.all([
    fetchJson(fundingUrl),
    fetchJson(`${rest}/product/specs/?active=true&base_symbol=BTCUSD`)
  ]);
  const perpId = identifyPerpetualProductIdFromFunding(funding);
  const perpRaw = await fetchJson(`${rest}/product/spec/${perpId}`);
  const perp = validateInternalCarryPerpetualSpec(Array.isArray(perpRaw) ? perpRaw[0] : perpRaw, perpId);
  const spotCandidates = rows(spotSpecs).filter((spec) => String(spec.symbol ?? "").toUpperCase() === "BTCUSD");
  if (spotCandidates.length !== 1) throw new Error(`Expected one active BTCUSD spot spec, found ${spotCandidates.length}`);
  const spot = validateInternalCarrySpotSpec(spotCandidates[0]);
  return [spot, perp];
}

async function probe(manifest, specs) {
  if (typeof WebSocket !== "function") throw new Error(`Liquidity probe requires global WebSocket; Node=${process.version}`);
  return new Promise((resolve, reject) => {
    const wanted = new Map(specs.map((spec) => [String(spec.symbol), spec]));
    const stats = Object.fromEntries([...wanted.keys()].map((symbol) => [symbol, newStats()]));
    const ws = new WebSocket(manifest.publicData.websocket);
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(1000, "trial9-liquidity-probe-complete"); } catch {}
      resolve(stats);
    };
    const fail = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    ws.addEventListener("open", () => {
      const symbols = [...wanted.keys()];
      ws.send(JSON.stringify({ type: "subscribe", product_codes: [], channels: [{ name: "book", product_codes: symbols }] }));
      timer = setTimeout(finish, PROBE_SECONDS * 1000);
    });
    ws.addEventListener("message", async (event) => {
      try {
        const payload = JSON.parse(await wsText(event.data));
        const messages = Array.isArray(payload) ? payload : [payload];
        for (const message of messages) {
          if (message?.type === "disconnect") return fail(new Error(`Bitnomial WebSocket disconnected: ${message.reason ?? "unknown"}`));
          const symbol = String(message?.symbol ?? "");
          if (message?.type !== "book" || !wanted.has(symbol)) continue;
          const s = stats[symbol];
          s.bookSnapshots += 1;
          if (!Array.isArray(message.asks) || !Array.isArray(message.bids)) {
            s.crossedOrMalformedSnapshots += 1;
            continue;
          }
          if (message.asks.length === 0 || message.bids.length === 0) {
            s.emptySideSnapshots += 1;
            continue;
          }
          let book;
          try {
            const spec = wanted.get(symbol);
            book = normalizeBookSnapshot(message, { symbol, priceIncrement: spec.price_increment, contractSizeBtc: spec.contract_size });
          } catch {
            s.crossedOrMalformedSnapshots += 1;
            continue;
          }
          s.twoSidedSnapshots += 1;
          for (const size of TEST_SIZES_BTC) {
            const buy = executableVwap(book, { action: "BUY", btcQuantity: size }).pass;
            const sell = executableVwap(book, { action: "SELL", btcQuantity: size }).pass;
            const slot = s.sizes[String(size)];
            if (buy) slot.buyExecutable += 1;
            if (sell) slot.sellExecutable += 1;
            if (buy && sell) slot.bothExecutable += 1;
          }
        }
      } catch (error) {
        fail(error);
      }
    });
    ws.addEventListener("error", () => fail(new Error("Bitnomial WebSocket error during liquidity probe")));
  });
}

function summarize(stats) {
  return Object.fromEntries(Object.entries(stats).map(([symbol, s]) => {
    const sizes = Object.fromEntries(Object.entries(s.sizes).map(([size, x]) => [size, {
      buyExecutableSnapshotFraction: s.bookSnapshots ? x.buyExecutable / s.bookSnapshots : 0,
      sellExecutableSnapshotFraction: s.bookSnapshots ? x.sellExecutable / s.bookSnapshots : 0,
      bothExecutableSnapshotFraction: s.bookSnapshots ? x.bothExecutable / s.bookSnapshots : 0
    }]));
    return [symbol, {
      bookSnapshots: s.bookSnapshots,
      twoSidedSnapshotFraction: s.bookSnapshots ? s.twoSidedSnapshots / s.bookSnapshots : 0,
      emptySideSnapshotFraction: s.bookSnapshots ? s.emptySideSnapshots / s.bookSnapshots : 0,
      malformedSnapshotFraction: s.bookSnapshots ? s.crossedOrMalformedSnapshots / s.bookSnapshots : 0,
      sizes
    }];
  }));
}

const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
if (manifest.status !== "DEVELOPMENT_UNFROZEN" || manifest.trialNumber !== 9) throw new Error("Trial 9 liquidity probe is development-only");
const specs = await resolveSpecs(manifest);
const stats = await probe(manifest, specs);
process.stdout.write(`${JSON.stringify({
  developmentProbeOnly: true,
  candidateValuesExposed: false,
  pricesExposed: false,
  fundingExposed: false,
  pnlCalculated: false,
  probeSeconds: PROBE_SECONDS,
  fixedTestSizesBtc: TEST_SIZES_BTC,
  products: summarize(stats)
}, null, 2)}\n`);
