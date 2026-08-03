import { Dec } from "./decimal.js";

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function decimalEnv(name, fallback) {
  return new Dec(process.env[name] ?? fallback);
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadConfig() {
  const config = {
    gammaBaseUrl: process.env.GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
    clobBaseUrl: process.env.CLOB_BASE_URL ?? "https://clob.polymarket.com",
    maxMarkets: numberEnv("MONEYMOG_MAX_MARKETS", 500),
    marketPageSize: numberEnv("MONEYMOG_MARKET_PAGE_SIZE", 100),
    bookBatchSize: numberEnv("MONEYMOG_BOOK_BATCH_SIZE", 100),
    maxShares: decimalEnv("MONEYMOG_MAX_SHARES", "1000"),
    minNetProfitUsd: decimalEnv("MONEYMOG_MIN_NET_PROFIT_USD", "0.05"),
    minRoiBps: decimalEnv("MONEYMOG_MIN_ROI_BPS", "5"),
    safetyBufferBps: decimalEnv("MONEYMOG_SAFETY_BUFFER_BPS", "10"),
    fixedCostUsd: decimalEnv("MONEYMOG_FIXED_COST_USD", "0"),
    maxBookAgeMs: numberEnv("MONEYMOG_MAX_BOOK_AGE_MS", 15_000),
    requestTimeoutMs: numberEnv("MONEYMOG_REQUEST_TIMEOUT_MS", 10_000),
    paperEnabled: booleanEnv("MONEYMOG_PAPER_ENABLED", false),
    paperStartingCash: decimalEnv("MONEYMOG_PAPER_STARTING_CASH", "10000")
  };

  if (!Number.isInteger(config.maxMarkets) || config.maxMarkets <= 0) throw new Error("MONEYMOG_MAX_MARKETS must be a positive integer");
  if (!Number.isInteger(config.marketPageSize) || config.marketPageSize <= 0) throw new Error("MONEYMOG_MARKET_PAGE_SIZE must be a positive integer");
  if (!Number.isInteger(config.bookBatchSize) || config.bookBatchSize <= 0 || config.bookBatchSize > 500) throw new Error("MONEYMOG_BOOK_BATCH_SIZE must be an integer from 1 to 500");
  if (config.maxShares.lte(0)) throw new Error("MONEYMOG_MAX_SHARES must be positive");
  if (config.minNetProfitUsd.lt(0)) throw new Error("MONEYMOG_MIN_NET_PROFIT_USD cannot be negative");
  if (config.minRoiBps.lt(0)) throw new Error("MONEYMOG_MIN_ROI_BPS cannot be negative");
  if (config.safetyBufferBps.lt(0)) throw new Error("MONEYMOG_SAFETY_BUFFER_BPS cannot be negative");
  if (config.maxBookAgeMs <= 0) throw new Error("MONEYMOG_MAX_BOOK_AGE_MS must be positive");

  return config;
}
