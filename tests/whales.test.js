import assert from "node:assert/strict";
import test from "node:test";
import { Dec } from "../src/decimal.js";
import { DataApiClient } from "../src/clients/data-api.js";
import { scoreWallet } from "../src/whales/scoring.js";
import { discoverWhales } from "../src/whales/discovery.js";
import { WhaleMonitor, defaultWhaleState, tradeKey } from "../src/whales/monitor.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const walletA = "0x1111111111111111111111111111111111111111";
const walletB = "0x2222222222222222222222222222222222222222";

function closedSeries(values) {
  return values.map((pnl, index) => ({
    asset: `asset-${index}`,
    conditionId: `condition-${index}`,
    realizedPnl: pnl,
    totalBought: 100,
    avgPrice: 0.5,
    timestamp: index + 1
  }));
}

function config(overrides = {}) {
  return {
    tradeLookback: 100,
    maxNewTradesPerWallet: 10,
    seenKeyLimit: 500,
    recentSignalLimit: 500,
    bookBatchSize: 100,
    minWhaleTradeUsd: 100,
    minRelativeConviction: 0.5,
    minWalletScore: 60,
    maxDetectionDelaySeconds: 300,
    maxOppositeTurnoverRatio: 0.55,
    copyFraction: 0.02,
    minCopyUsd: 10,
    maxCopyUsd: 100,
    maxPriceDeterioration: 0.02,
    maxEntryPrice: 0.9,
    maxBookAgeMs: 15_000,
    requiredConsensus: 1,
    ...overrides
  };
}

function book(asset, ask = "0.41", size = "1000", timestampMs = 1_000_000) {
  return {
    market: "0x" + "a".repeat(64),
    assetId: asset,
    timestampMs,
    bids: [{ price: new Dec("0.39"), size: new Dec(size) }],
    asks: [{ price: new Dec(ask), size: new Dec(size) }],
    minOrderSize: new Dec(1),
    tickSize: new Dec("0.01"),
    negRisk: false
  };
}

test("Data API client sends wallet filters and normalizes trades", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/trades");
    assert.equal(parsed.searchParams.get("user"), walletA);
    return response([{
      proxyWallet: walletA,
      side: "BUY",
      asset: "asset-1",
      conditionId: "0x" + "a".repeat(64),
      size: 250,
      price: 0.4,
      timestamp: 100,
      title: "Example",
      outcome: "Yes",
      transactionHash: "0xabc"
    }]);
  };
  const trades = await new DataApiClient("https://data.example", 1000).trades(walletA);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].size, 250);
  assert.equal(trades[0].side, "BUY");
});

test("wallet scoring rewards repeatability and rejects one-hit wonders", () => {
  const consistent = scoreWallet({
    wallet: walletA,
    leaderboardEntries: [{ category: "OVERALL", rank: 8 }],
    closedPositions: closedSeries([30, 20, -10, 25, 15, -5, 20, 10, 15, 25, -5, 10]),
    tradedCount: 60
  });
  const oneHit = scoreWallet({
    wallet: walletB,
    leaderboardEntries: [{ category: "OVERALL", rank: 1 }],
    closedPositions: closedSeries([1000, -50, -60, -70, -40, -30, -20, -10, -10, -10, -10, -10]),
    tradedCount: 20
  });
  assert.equal(consistent.eligible, true);
  assert.equal(oneHit.eligible, false);
  assert.ok(consistent.score > oneHit.score);
  assert.ok(oneHit.rejectionReasons.includes("one-hit-concentration"));
});

test("discovery merges category leaderboards and returns ranked wallets", async () => {
  const client = {
    leaderboard: async ({ category }) => [{ proxyWallet: walletA, rank: category === "OVERALL" ? 3 : 7, pnl: 1000, category, userName: "steady" }],
    closedPositions: async () => closedSeries([20, 20, -5, 15, 15, -5, 15, 10, 10, 10, 10, 10]),
    tradedCount: async () => 70
  };
  const result = await discoverWhales(client, { categories: ["OVERALL", "POLITICS"], maxCandidates: 5, recommendedCount: 5 });
  assert.equal(result.candidatesEvaluated, 1);
  assert.equal(result.recommended.length, 1);
  assert.deepEqual(result.recommended[0].categories.sort(), ["OVERALL", "POLITICS"]);
});

test("first monitor pass only establishes a baseline", async () => {
  const trade = {
    proxyWallet: walletA,
    side: "BUY",
    asset: "asset-1",
    conditionId: "0x" + "a".repeat(64),
    size: 500,
    price: 0.4,
    timestamp: 900,
    title: "Will inflation fall?",
    outcome: "Yes",
    transactionHash: "0xabc"
  };
  const monitor = new WhaleMonitor({
    dataApi: { trades: async () => [trade], positions: async () => [] },
    clob: { getOrderBooks: async () => new Map(), getFeeSchedule: async () => ({ rate: new Dec(0), exponent: 2, takerOnly: true }) },
    config: config()
  });
  const result = await monitor.observeOnce([{ wallet: walletA, score: 80 }], defaultWhaleState(), 1_000_000);
  assert.deepEqual(result.baselined, [walletA]);
  assert.equal(result.signals.length, 0);
});

test("monitor identifies a timely, executable whale buy", async () => {
  const oldTrade = {
    proxyWallet: walletA, side: "BUY", asset: "asset-old", conditionId: "0x" + "b".repeat(64),
    size: 100, price: 0.5, timestamp: 900, title: "old", outcome: "Yes", transactionHash: "0xold"
  };
  const newTrade = {
    proxyWallet: walletA, side: "BUY", asset: "asset-1", conditionId: "0x" + "a".repeat(64),
    size: 500, price: 0.4, timestamp: 995, title: "Will inflation fall?", outcome: "Yes", transactionHash: "0xnew"
  };
  const dataApi = {
    trades: async () => [newTrade, oldTrade],
    positions: async () => [{ asset: "asset-1", size: 500 }]
  };
  const clob = {
    getOrderBooks: async () => new Map([["asset-1", book("asset-1", "0.41", "1000", 1_000_000)]]),
    getFeeSchedule: async () => ({ rate: new Dec(0), exponent: 2, takerOnly: true })
  };
  const state = { version: 1, wallets: { [walletA]: { lastTimestampMs: 900_000, seenKeys: [tradeKey(oldTrade)] } }, recentSignals: [] };
  const monitor = new WhaleMonitor({ dataApi, clob, config: config() });
  const result = await monitor.observeOnce([{ wallet: walletA, score: 80, categoryRanks: { ECONOMICS: 5 } }], state, 1_000_000);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].decision, "COPY_CANDIDATE");
  assert.equal(result.signals[0].category, "ECONOMICS");
  assert.ok(result.signals[0].estimatedCost >= 10);
});

test("monitor rejects a copied entry after excessive price movement", async () => {
  const newTrade = {
    proxyWallet: walletA, side: "BUY", asset: "asset-1", conditionId: "0x" + "a".repeat(64),
    size: 500, price: 0.4, timestamp: 995, title: "Will inflation fall?", outcome: "Yes", transactionHash: "0xnew"
  };
  const monitor = new WhaleMonitor({
    dataApi: { trades: async () => [newTrade], positions: async () => [{ asset: "asset-1", size: 500 }] },
    clob: {
      getOrderBooks: async () => new Map([["asset-1", book("asset-1", "0.45", "1000", 1_000_000)]]),
      getFeeSchedule: async () => ({ rate: new Dec(0), exponent: 2, takerOnly: true })
    },
    config: config()
  });
  const state = { version: 1, wallets: { [walletA]: { lastTimestampMs: 900_000, seenKeys: [] } }, recentSignals: [] };
  const result = await monitor.observeOnce([{ wallet: walletA, score: 80 }], state, 1_000_000);
  assert.equal(result.signals[0].decision, "REJECTED");
  assert.ok(result.signals[0].reasons.includes("price-moved-too-far"));
});

test("consensus requirement rejects a lone whale", async () => {
  const trade = {
    proxyWallet: walletA, side: "BUY", asset: "asset-1", conditionId: "0x" + "a".repeat(64),
    size: 500, price: 0.4, timestamp: 995, title: "Will inflation fall?", outcome: "Yes", transactionHash: "0xnew"
  };
  const monitor = new WhaleMonitor({
    dataApi: { trades: async () => [trade], positions: async () => [{ asset: "asset-1", size: 500 }] },
    clob: {
      getOrderBooks: async () => new Map([["asset-1", book("asset-1", "0.41", "1000", 1_000_000)]]),
      getFeeSchedule: async () => ({ rate: new Dec(0), exponent: 2, takerOnly: true })
    },
    config: config({ requiredConsensus: 2 })
  });
  const state = { version: 1, wallets: { [walletA]: { lastTimestampMs: 900_000, seenKeys: [] } }, recentSignals: [] };
  const result = await monitor.observeOnce([{ wallet: walletA, score: 80 }], state, 1_000_000);
  assert.equal(result.signals[0].decision, "REJECTED");
  assert.ok(result.signals[0].reasons.includes("insufficient-wallet-consensus"));
});
