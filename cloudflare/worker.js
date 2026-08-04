import { ClobClient } from "../src/clients/clob.js";
import { DataApiClient } from "../src/clients/data-api.js";
import { WhaleMonitor } from "../src/whales/monitor.js";
import { D1WhaleStore } from "./d1-store.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function parseWallets(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw.split(",").map((wallet) => ({ wallet: wallet.trim(), score: 70 })); }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => typeof item === "string" ? { wallet: item, score: 70 } : item)
    .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(String(item.wallet ?? "")))
    .map((item) => ({ ...item, wallet: String(item.wallet).toLowerCase(), score: number(item.score, 70) }));
}

function monitorConfig(env) {
  return {
    tradeLookback: number(env.WHALE_TRADE_LOOKBACK, 100),
    maxNewTradesPerWallet: number(env.WHALE_MAX_NEW_TRADES, 10),
    seenKeyLimit: 500,
    recentSignalLimit: 500,
    bookBatchSize: 100,
    minWhaleTradeUsd: number(env.WHALE_MIN_TRADE_USD, 100),
    minRelativeConviction: number(env.WHALE_MIN_RELATIVE_SIZE, 0.5),
    minWalletScore: number(env.WHALE_MIN_SCORE, 60),
    maxDetectionDelaySeconds: number(env.WHALE_MAX_DELAY_SECONDS, 300),
    maxOppositeTurnoverRatio: number(env.WHALE_MAX_CHURN, 0.55),
    copyFraction: number(env.WHALE_COPY_FRACTION, 0.02),
    minCopyUsd: number(env.WHALE_MIN_COPY_USD, 10),
    maxCopyUsd: number(env.WHALE_MAX_COPY_USD, 100),
    maxPriceDeterioration: number(env.WHALE_MAX_PRICE_MOVE, 0.02),
    maxEntryPrice: number(env.WHALE_MAX_ENTRY_PRICE, 0.9),
    maxBookAgeMs: number(env.MAX_BOOK_AGE_MS, 15_000),
    requiredConsensus: Math.max(1, Math.trunc(number(env.WHALE_REQUIRED_CONSENSUS, 1)))
  };
}

function selectWalletBatch(wallets, env, now = new Date()) {
  const batchSize = Math.max(1, Math.min(wallets.length || 1, Math.trunc(number(env.WHALE_BATCH_SIZE, 5))));
  if (wallets.length <= batchSize) return wallets;
  const batchCount = Math.ceil(wallets.length / batchSize);
  const batchIndex = now.getUTCMinutes() % batchCount;
  return wallets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
}

async function runMonitor(env) {
  if (!bool(env.MONITOR_ENABLED)) return { skipped: true, reason: "monitor-disabled" };
  const wallets = selectWalletBatch(parseWallets(env.WHALE_WALLETS), env);
  if (!wallets.length) return { skipped: true, reason: "no-wallets-configured" };

  const startedAt = new Date().toISOString();
  const store = new D1WhaleStore(env.DB);
  const state = await store.load(wallets);
  const monitor = new WhaleMonitor({
    dataApi: new DataApiClient(env.DATA_API_BASE_URL ?? "https://data-api.polymarket.com", number(env.REQUEST_TIMEOUT_MS, 10_000)),
    clob: new ClobClient(env.CLOB_BASE_URL ?? "https://clob.polymarket.com", number(env.REQUEST_TIMEOUT_MS, 10_000)),
    config: monitorConfig(env)
  });
  const result = await monitor.observeOnce(wallets, state);
  const runId = await store.save(result, startedAt);
  return {
    runId,
    observedAt: result.observedAt,
    walletsChecked: result.walletsChecked,
    baselined: result.baselined.length,
    newTrades: result.newTrades,
    copyCandidates: result.signals.filter((signal) => signal.decision === "COPY_CANDIDATE").length,
    rejected: result.signals.filter((signal) => signal.decision === "REJECTED").length,
    errors: result.errors
  };
}

function authorized(request, env) {
  if (!env.API_TOKEN) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.API_TOKEN}`;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const store = new D1WhaleStore(env.DB);
      return json({
        ok: true,
        enabled: bool(env.MONITOR_ENABLED),
        configuredWallets: parseWallets(env.WHALE_WALLETS).length,
        ...(await store.status())
      });
    }

    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
    const store = new D1WhaleStore(env.DB);
    if (url.pathname === "/api/whales" && request.method === "GET") {
      return json({ signals: await store.signals(url.searchParams.get("limit")) });
    }
    if (url.pathname === "/api/run" && request.method === "POST") {
      return json(await runMonitor(env));
    }
    return json({ error: "not-found" }, 404);
  }
};
