#!/usr/bin/env node

import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  identifyPerpetualProductIdFromFunding,
  validateInternalCarryPerpetualSpec,
  validateInternalCarrySpotSpec
} from "./lib/bitnomial-internal-carry-identity.js";
import { normalizeBookSnapshot } from "./lib/bitnomial-book.js";

const MANIFEST = "research/crypto/manifests/bitnomial-internal-carry-v1.json";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "TheOldTrader-Research/Trial9-Connectivity" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 250)}`);
    return { json: JSON.parse(text), hash: sha256(text) };
  } finally {
    clearTimeout(timer);
  }
}

function rows(json) {
  return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
}

async function getBookSnapshots({ url, specs, timeoutSeconds }) {
  if (typeof WebSocket !== "function") throw new Error("Trial 9 connectivity requires Node with global WebSocket support (Node 22+ recommended)");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const wanted = new Map(specs.map((spec) => [String(spec.symbol), spec]));
    const books = new Map();
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Timed out waiting for Bitnomial book snapshots: got ${[...books.keys()].join(",") || "none"}`));
    }, timeoutSeconds * 1000);
    const fail = (error) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    ws.addEventListener("open", () => {
      const symbols = [...wanted.keys()];
      ws.send(JSON.stringify({
        type: "subscribe",
        product_codes: symbols,
        channels: [{ name: "book", product_codes: symbols }]
      }));
    });
    ws.addEventListener("message", async (event) => {
      try {
        const text = typeof event.data === "string" ? event.data : await event.data.text?.() ?? String(event.data);
        const payload = JSON.parse(text);
        const messages = Array.isArray(payload) ? payload : [payload];
        for (const message of messages) {
          if (message?.type !== "book" || !wanted.has(String(message.symbol))) continue;
          const spec = wanted.get(String(message.symbol));
          const book = normalizeBookSnapshot(message, {
            symbol: spec.symbol,
            priceIncrement: spec.price_increment,
            contractSizeBtc: spec.contract_size
          });
          books.set(spec.symbol, book);
        }
        if (books.size === wanted.size) {
          clearTimeout(timer);
          try { ws.close(1000, "trial9-connectivity-complete"); } catch {}
          resolve(books);
        }
      } catch (error) {
        fail(error);
      }
    });
    ws.addEventListener("error", () => fail(new Error("Bitnomial WebSocket connection error")));
  });
}

async function main() {
  const manifestBytes = await fs.readFile(MANIFEST);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.experimentId !== "bitnomial-internal-carry-v1" || manifest.trialNumber !== 9 || manifest.status !== "DEVELOPMENT_UNFROZEN") {
    throw new Error("Trial 9 connectivity checker expects the unfrozen development manifest");
  }

  const restBase = manifest.publicData.restBase.replace(/\/$/, "");
  const fundingUrl = `${manifest.publicData.fundingEndpoint}?base_symbol=${encodeURIComponent(manifest.venues.perpetualShort.fundingBaseSymbol)}&begin_time=${encodeURIComponent(new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString())}&limit=100&order=desc`;
  const spotSpecsUrl = `${restBase}/product/specs/?active=true&base_symbol=BTCUSD`;
  const [fundingRaw, spotSpecsRaw] = await Promise.all([fetchJson(fundingUrl), fetchJson(spotSpecsUrl)]);

  const perpId = identifyPerpetualProductIdFromFunding(fundingRaw.json);
  const perpSpecRaw = await fetchJson(`${restBase}/product/spec/${perpId}`);
  const perpSpec = validateInternalCarryPerpetualSpec(Array.isArray(perpSpecRaw.json) ? perpSpecRaw.json[0] : perpSpecRaw.json, perpId);
  const spotCandidates = rows(spotSpecsRaw.json).filter((spec) => String(spec.symbol ?? "").toUpperCase() === "BTCUSD");
  if (spotCandidates.length !== 1) throw new Error(`Expected one active Bitnomial BTCUSD spot spec, found ${spotCandidates.length}`);
  const spotSpec = validateInternalCarrySpotSpec(spotCandidates[0]);

  const books = await getBookSnapshots({
    url: manifest.publicData.websocket,
    specs: [spotSpec, perpSpec],
    timeoutSeconds: manifest.publicData.bookSnapshotTimeoutSeconds
  });

  for (const spec of [spotSpec, perpSpec]) {
    const book = books.get(spec.symbol);
    if (!book || !book.bids.length || !book.asks.length) throw new Error(`Missing validated book for ${spec.symbol}`);
  }

  process.stdout.write(`${JSON.stringify({
    connectivityOnly: true,
    candidateValuesExposed: false,
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    manifestSha256: sha256(manifestBytes),
    fundingEndpointValid: true,
    spotIdentityValid: true,
    perpetualIdentityValid: true,
    perpetualProductIdResolvedFromFunding: true,
    publicWebSocketValid: true,
    spotBookValid: true,
    perpetualBookValid: true,
    productsResolved: 2
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
