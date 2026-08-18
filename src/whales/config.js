function numberEnv(name, fallback) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}
function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function parseWallets(raw) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { value = raw.split(",").map((wallet) => ({ wallet: wallet.trim() })); }
  if (!Array.isArray(value)) throw new Error("THEOLDTRADER_WHALE_WALLETS must be a JSON array or comma-separated wallet list");
  return value.map((item) => typeof item === "string" ? { wallet: item, score: 70 } : item)
    .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(String(item.wallet ?? "")))
    .map((item) => ({ ...item, wallet: String(item.wallet).toLowerCase(), score: numberValue(item.score, 70) }));
}
export function loadWhaleConfig() {
  return {
    enabled: boolEnv("THEOLDTRADER_WHALE_MONITOR_ENABLED", false),
    dataApiBaseUrl: process.env.DATA_API_BASE_URL ?? "https://data-api.polymarket.com",
    clobBaseUrl: process.env.CLOB_BASE_URL ?? "https://clob.polymarket.com",
    requestTimeoutMs: numberEnv("THEOLDTRADER_REQUEST_TIMEOUT_MS", 10_000),
    wallets: parseWallets(process.env.THEOLDTRADER_WHALE_WALLETS),
    statePath: process.env.THEOLDTRADER_WHALE_STATE_PATH ?? ".theoldtrader/whale-state.json",
    tradeLookback: Math.max(20, Math.min(500, numberEnv("THEOLDTRADER_WHALE_TRADE_LOOKBACK", 100))),
    maxNewTradesPerWallet: Math.max(1, Math.min(25, numberEnv("THEOLDTRADER_WHALE_MAX_NEW_TRADES", 10))),
    seenKeyLimit: Math.max(50, numberEnv("THEOLDTRADER_WHALE_SEEN_KEY_LIMIT", 500)),
    recentSignalLimit: Math.max(50, numberEnv("THEOLDTRADER_WHALE_RECENT_SIGNAL_LIMIT", 500)),
    bookBatchSize: Math.max(1, Math.min(500, numberEnv("THEOLDTRADER_BOOK_BATCH_SIZE", 100))),
    minWhaleTradeUsd: Math.max(0, numberEnv("THEOLDTRADER_WHALE_MIN_TRADE_USD", 100)),
    minRelativeConviction: Math.max(0, numberEnv("THEOLDTRADER_WHALE_MIN_RELATIVE_SIZE", 0.5)),
    minWalletScore: Math.max(0, Math.min(100, numberEnv("THEOLDTRADER_WHALE_MIN_SCORE", 60))),
    maxDetectionDelaySeconds: Math.max(1, numberEnv("THEOLDTRADER_WHALE_MAX_DELAY_SECONDS", 300)),
    maxOppositeTurnoverRatio: Math.max(0, Math.min(1, numberEnv("THEOLDTRADER_WHALE_MAX_CHURN", 0.55))),
    copyFraction: Math.max(0.001, Math.min(1, numberEnv("THEOLDTRADER_WHALE_COPY_FRACTION", 0.02))),
    minCopyUsd: Math.max(1, numberEnv("THEOLDTRADER_WHALE_MIN_COPY_USD", 10)),
    maxCopyUsd: Math.max(1, numberEnv("THEOLDTRADER_WHALE_MAX_COPY_USD", 100)),
    maxPriceDeterioration: Math.max(0, numberEnv("THEOLDTRADER_WHALE_MAX_PRICE_MOVE", 0.02)),
    maxEntryPrice: Math.max(0.01, Math.min(0.99, numberEnv("THEOLDTRADER_WHALE_MAX_ENTRY_PRICE", 0.9))),
    maxBookAgeMs: Math.max(1000, numberEnv("THEOLDTRADER_MAX_BOOK_AGE_MS", 15_000)),
    requiredConsensus: Math.max(1, Math.trunc(numberEnv("THEOLDTRADER_WHALE_REQUIRED_CONSENSUS", 1)))
  };
}
