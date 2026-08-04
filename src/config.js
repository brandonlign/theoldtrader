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
    maxMultiOutcomeEvents: numberEnv("MONEYMOG_MAX_MULTI_OUTCOME_EVENTS", 50),
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
    paperStartingCash: decimalEnv("MONEYMOG_PAPER_STARTING_CASH", "10000"),
    paperStatePath: process.env.MONEYMOG_PAPER_STATE_PATH ?? ".moneymog/paper-state.json",
    paperExecutionDelayMs: numberEnv("MONEYMOG_PAPER_EXECUTION_DELAY_MS", 2_000),
    paperLiquidityHaircut: numberEnv("MONEYMOG_PAPER_LIQUIDITY_HAIRCUT", 0.8),
    paperMinPairedFillRatio: decimalEnv("MONEYMOG_PAPER_MIN_PAIRED_FILL_RATIO", "0.9")
  };

  if (!Number.isInteger(config.maxMarkets) || config.maxMarkets <= 0) throw new Error("MONEYMOG_MAX_MARKETS must be a positive integer");
  if (!Number.isInteger(config.maxMultiOutcomeEvents) || config.maxMultiOutcomeEvents <= 0 || config.maxMultiOutcomeEvents > 100) throw new Error("MONEYMOG_MAX_MULTI_OUTCOME_EVENTS must be an integer from 1 to 100");
  if (!Number.isInteger(config.marketPageSize) || config.marketPageSize <= 0) throw new Error("MONEYMOG_MARKET_PAGE_SIZE must be a positive integer");
  if (!Number.isInteger(config.bookBatchSize) || config.bookBatchSize <= 0 || config.bookBatchSize > 500) throw new Error("MONEYMOG_BOOK_BATCH_SIZE must be an integer from 1 to 500");
  if (config.maxShares.lte(0)) throw new Error("MONEYMOG_MAX_SHARES must be positive");
  if (config.minNetProfitUsd.lt(0)) throw new Error("MONEYMOG_MIN_NET_PROFIT_USD cannot be negative");
  if (config.minRoiBps.lt(0)) throw new Error("MONEYMOG_MIN_ROI_BPS cannot be negative");
  if (config.safetyBufferBps.lt(0)) throw new Error("MONEYMOG_SAFETY_BUFFER_BPS cannot be negative");
  if (config.maxBookAgeMs <= 0) throw new Error("MONEYMOG_MAX_BOOK_AGE_MS must be positive");
  if (config.paperExecutionDelayMs < 0) throw new Error("MONEYMOG_PAPER_EXECUTION_DELAY_MS cannot be negative");
  if (config.paperLiquidityHaircut <= 0 || config.paperLiquidityHaircut > 1) throw new Error("MONEYMOG_PAPER_LIQUIDITY_HAIRCUT must be greater than 0 and at most 1");
  if (config.paperMinPairedFillRatio.lte(0) || config.paperMinPairedFillRatio.gt(1)) throw new Error("MONEYMOG_PAPER_MIN_PAIRED_FILL_RATIO must be greater than 0 and at most 1");

  return config;
}
