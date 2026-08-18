import { Dec } from "./decimal.js";

// Stable local defaults belong in source, not environment variables. The hosted
// Cloudflare worker has its own deployment configuration in wrangler.toml.
export function loadConfig() {
  return {
    gammaBaseUrl: "https://gamma-api.polymarket.com",
    clobBaseUrl: "https://clob.polymarket.com",
    maxMarkets: 500,
    maxMultiOutcomeEvents: 50,
    marketPageSize: 100,
    bookBatchSize: 100,
    maxShares: new Dec("1000"),
    minNetProfitUsd: new Dec("0.05"),
    minRoiBps: new Dec("5"),
    safetyBufferBps: new Dec("10"),
    fixedCostUsd: new Dec("0"),
    maxBookAgeMs: 15_000,
    requestTimeoutMs: 10_000,
    paperStartingCash: new Dec("10000"),
    paperStatePath: ".theoldtrader/paper-state.json",
    paperExecutionDelayMs: 2_000,
    paperLiquidityHaircut: 0.8,
    paperMinPairedFillRatio: new Dec("0.9")
  };
}
