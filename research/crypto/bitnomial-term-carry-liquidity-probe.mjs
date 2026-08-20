#!/usr/bin/env node

import { normalizeBookSnapshot, displayedDepthPass } from "./lib/bitnomial-book.js";

const REST = "https://bitnomial.com/exchange/api/v1/prod";
const FUNDING = "https://bitnomial.com/exchange/api/v1/funding-rates/";
const WS = "wss://bitnomial.com/exchange/ws";
const PROBE_SECONDS = Number(process.env.TRIAL10_PROBE_SECONDS || 120);
const ONE_CONTRACT_BTC = 0.01;
const MIN_DAYS = 60;
const MAX_DAYS = 180;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "TheOldTrader-Research/Trial10-Feasibility" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 250)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
const rows = (json) => Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];

function validatePerp(spec, productId) {
  if (Number(spec?.product_id) !== Number(productId)) throw new Error("Trial 10 perpetual product ID mismatch");
  if (String(spec?.product_status ?? "active").toLowerCase() !== "active") throw new Error("Trial 10 perpetual is not active");
  if (String(spec?.type).toLowerCase() !== "perpetual") throw new Error(`Trial 10 expected type=perpetual, got ${spec?.type}`);
  if (String(spec?.base_symbol).toUpperCase() !== "BTCUC") throw new Error("Trial 10 perpetual base_symbol mismatch");
  const machine = `${spec?.symbol ?? ""} ${spec?.cqg_symbol ?? ""}`.toUpperCase();
  if (!machine.includes("PBTCUC")) throw new Error("Trial 10 perpetual symbol mismatch");
  if (Math.abs(Number(spec?.contract_size) - ONE_CONTRACT_BTC) > 1e-12) throw new Error("Trial 10 perpetual contract size mismatch");
  return spec;
}

function chooseDatedFuture(specs, nowMs) {
  const candidates = rows(specs).filter((spec) => {
    if (String(spec?.type).toLowerCase() !== "future") return false;
    if (String(spec?.product_status).toLowerCase() !== "active") return false;
    if (String(spec?.base_symbol).toUpperCase() !== "BUC") return false;
    if (Math.abs(Number(spec?.contract_size) - ONE_CONTRACT_BTC) > 1e-12) return false;
    const settle = Date.parse(spec?.final_settle_time);
    if (!Number.isFinite(settle)) return false;
    const days = (settle - nowMs) / 86_400_000;
    return days >= MIN_DAYS && days <= MAX_DAYS;
  }).sort((a, b) => Date.parse(a.final_settle_time) - Date.parse(b.final_settle_time));
  if (!candidates.length) throw new Error(`Trial 10 found no active 0.01 BTC BUC future with ${MIN_DAYS}-${MAX_DAYS} days remaining`);
  return candidates[0];
}

async function resolveProducts() {
  const now = Date.now();
  const begin = new Date(now - 13 * 60 * 60 * 1000).toISOString();
  const [funding, futures] = await Promise.all([
    fetchJson(`${FUNDING}?base_symbol=BTCUC&begin_time=${encodeURIComponent(begin)}&limit=100&order=desc`),
    fetchJson(`${REST}/product/specs/?active=true&base_symbol=BUC`)
  ]);
  const fundingRows = rows(funding).filter((row) => Number.isFinite(Number(row?.product_id)));
  if (!fundingRows.length) throw new Error("Trial 10 could not resolve PBTCUC from funding history");
  fundingRows.sort((a, b) => Date.parse(b.interval_end ?? b.intervalEnd ?? 0) - Date.parse(a.interval_end ?? a.intervalEnd ?? 0));
  const perpId = Number(fundingRows[0].product_id);
  const rawPerpSpec = await fetchJson(`${REST}/product/spec/${perpId}`);
  const perpSpec = validatePerp(Array.isArray(rawPerpSpec) ? rawPerpSpec[0] : rawPerpSpec, perpId);
  const datedSpec = chooseDatedFuture(futures, now);
  return { datedSpec, perpSpec, now };
}

function decodeEventData(data) {
  if (typeof data === "string") return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data).toString("utf8"));
  if (ArrayBuffer.isView(data)) return Promise.resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"));
  if (data && typeof data.text === "function") return data.text();
  return Promise.resolve(String(data));
}

async function probe({ datedSpec, perpSpec }) {
  if (typeof WebSocket !== "function") throw new Error("Trial 10 probe requires Node 22+ global WebSocket");
  const specs = [datedSpec, perpSpec];
  const wanted = new Map(specs.map((spec) => [String(spec.symbol), spec]));
  const stats = Object.fromEntries(specs.map((spec) => [spec.symbol, {
    snapshots: 0,
    twoSided: 0,
    emptySide: 0,
    malformed: 0,
    buyExecutable: 0,
    sellExecutable: 0,
    bothExecutable: 0
  }]));

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    let done = false;
    const finish = (error = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(1000, "trial10-feasibility-complete"); } catch {}
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(), PROBE_SECONDS * 1000);
    ws.addEventListener("open", () => {
      const symbols = [...wanted.keys()];
      ws.send(JSON.stringify({ type: "subscribe", product_codes: [], channels: [{ name: "book", product_codes: symbols }] }));
    });
    ws.addEventListener("message", async (event) => {
      try {
        const payload = JSON.parse(await decodeEventData(event.data));
        for (const message of (Array.isArray(payload) ? payload : [payload])) {
          if (message?.type === "disconnect") return finish(new Error(`Bitnomial disconnected: ${message.reason ?? "unknown"}`));
          const symbol = String(message?.symbol ?? "");
          if (message?.type !== "book" || !wanted.has(symbol)) continue;
          const s = stats[symbol];
          s.snapshots += 1;
          if (!Array.isArray(message.asks) || !Array.isArray(message.bids)) { s.malformed += 1; continue; }
          if (!message.asks.length || !message.bids.length) { s.emptySide += 1; continue; }
          try {
            const spec = wanted.get(symbol);
            const book = normalizeBookSnapshot(message, { symbol, priceIncrement: spec.price_increment, contractSizeBtc: spec.contract_size });
            s.twoSided += 1;
            const depth = displayedDepthPass(book, ONE_CONTRACT_BTC);
            if (depth.buy) s.buyExecutable += 1;
            if (depth.sell) s.sellExecutable += 1;
            if (depth.buy && depth.sell) s.bothExecutable += 1;
          } catch {
            s.malformed += 1;
          }
        }
      } catch (error) {
        finish(error);
      }
    });
    ws.addEventListener("error", () => finish(new Error("Trial 10 Bitnomial WebSocket error")));
  });
  return stats;
}

const { datedSpec, perpSpec, now } = await resolveProducts();
const stats = await probe({ datedSpec, perpSpec });
const summarize = (symbol) => {
  const s = stats[symbol];
  const denom = s.snapshots || 1;
  return {
    snapshots: s.snapshots,
    twoSidedSnapshotFraction: s.twoSided / denom,
    emptySideSnapshotFraction: s.emptySide / denom,
    malformedSnapshotFraction: s.malformed / denom,
    oneContractBuyExecutableFraction: s.buyExecutable / denom,
    oneContractSellExecutableFraction: s.sellExecutable / denom,
    oneContractBothExecutableFraction: s.bothExecutable / denom
  };
};
const dated = summarize(datedSpec.symbol);
const perp = summarize(perpSpec.symbol);
const pass = dated.twoSidedSnapshotFraction > 0
  && dated.oneContractBothExecutableFraction > 0
  && perp.twoSidedSnapshotFraction > 0
  && perp.oneContractBothExecutableFraction > 0;
const result = {
  developmentProbeOnly: true,
  candidateValuesExposed: false,
  pricesExposed: false,
  fundingExposed: false,
  basisExposed: false,
  pnlCalculated: false,
  trialNumber: 10,
  selectionRule: `earliest active 0.01 BTC BUC future with ${MIN_DAYS}-${MAX_DAYS} days remaining`,
  selectedDatedFuture: {
    symbol: datedSpec.symbol,
    productId: Number(datedSpec.product_id),
    finalSettleTime: new Date(Date.parse(datedSpec.final_settle_time)).toISOString(),
    daysToSettleAtProbe: Number(((Date.parse(datedSpec.final_settle_time) - now) / 86_400_000).toFixed(2))
  },
  perpetual: { symbol: perpSpec.symbol, productId: Number(perpSpec.product_id) },
  probeSeconds: PROBE_SECONDS,
  oneContractBtc: ONE_CONTRACT_BTC,
  products: { [datedSpec.symbol]: dated, [perpSpec.symbol]: perp },
  feasibilityPass: pass
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!pass) process.exitCode = 2;
