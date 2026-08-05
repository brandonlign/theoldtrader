import { CoinbasePublicClient } from "../src/crypto/coinbase-public.js";
import { deriveCryptoSignal } from "../src/crypto/strategy.js";
import { CryptoPaperStore } from "./crypto-store.js";

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function products(raw) {
  const source = raw || "BTC-USD,ETH-USD,SOL-USD";
  return [...new Set(String(source).split(",").map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z0-9]+-USD$/.test(item)))].slice(0, 6);
}

function strategyConfig(env) {
  return {
    fastPeriod: finite(env.CRYPTO_FAST_EMA, 12),
    slowPeriod: finite(env.CRYPTO_SLOW_EMA, 36),
    momentumPeriod: finite(env.CRYPTO_MOMENTUM_PERIOD, 12),
    rsiPeriod: finite(env.CRYPTO_RSI_PERIOD, 14),
    minTrend: finite(env.CRYPTO_MIN_TREND, 0.0015),
    minMomentum: finite(env.CRYPTO_MIN_MOMENTUM, 0.0025),
    minRsi: finite(env.CRYPTO_MIN_RSI, 52),
    maxRsi: finite(env.CRYPTO_MAX_RSI, 72),
    exitRsi: finite(env.CRYPTO_EXIT_RSI, 47),
    maxEntryVolatility: finite(env.CRYPTO_MAX_ATR_PCT, 0.035),
    stopLossPct: finite(env.CRYPTO_STOP_LOSS_PCT, 0.025),
    takeProfitPct: finite(env.CRYPTO_TAKE_PROFIT_PCT, 0.05),
    trailingStopPct: finite(env.CRYPTO_TRAILING_STOP_PCT, 0.02),
    minVolumeRatio: finite(env.CRYPTO_MIN_VOLUME_RATIO, 0.85),
    requiredChecks: finite(env.CRYPTO_REQUIRED_CHECKS, 6)
  };
}

function executionConfig(env) {
  return {
    positionPct: Math.max(0.02, Math.min(0.4, finite(env.CRYPTO_POSITION_PCT, 0.2))),
    maxExposurePct: Math.max(0.1, Math.min(0.9, finite(env.CRYPTO_MAX_EXPOSURE_PCT, 0.6))),
    cashReservePct: Math.max(0.05, Math.min(0.5, finite(env.CRYPTO_CASH_RESERVE_PCT, 0.15))),
    minTradeUsd: Math.max(5, finite(env.CRYPTO_MIN_TRADE_USD, 25)),
    maxTradeUsd: Math.max(25, finite(env.CRYPTO_MAX_TRADE_USD, 2_000)),
    feeBps: Math.max(0, finite(env.CRYPTO_FEE_BPS, 60)),
    slippageBps: Math.max(0, finite(env.CRYPTO_SLIPPAGE_BPS, 5)),
    maxSpreadBps: Math.max(1, finite(env.CRYPTO_MAX_SPREAD_BPS, 35))
  };
}

function spreadBps(book) {
  if (!book?.bestBid || !book?.bestAsk || book.mid <= 0) return Infinity;
  return ((book.bestAsk - book.bestBid) / book.mid) * 10_000;
}

export async function runCryptoCycle(env, options = {}) {
  const store = new CryptoPaperStore(env.DB);
  const runId = options.runId ? `${options.runId}:crypto` : crypto.randomUUID();
  const enabled = bool(env.CRYPTO_SIMULATION_ENABLED, true);
  const startingCash = finite(env.CRYPTO_STARTING_CASH, 10_000);
  await store.ensurePortfolio(startingCash);
  await store.startRun({ id: runId, enabled });

  const client = new CoinbasePublicClient({
    baseUrl: env.COINBASE_EXCHANGE_BASE_URL ?? "https://api.exchange.coinbase.com",
    timeoutMs: finite(env.REQUEST_TIMEOUT_MS, 10_000)
  });
  const list = products(env.CRYPTO_PRODUCTS);
  const config = executionConfig(env);
  const errors = [];
  const signals = [];
  const executions = [];

  for (const productId of list) {
    try {
      const [candles, book] = await Promise.all([
        client.getCandles(productId, { granularity: finite(env.CRYPTO_CANDLE_SECONDS, 300) }),
        client.getBook(productId)
      ]);
      const position = await store.loadPosition(productId);
      const signal = deriveCryptoSignal({ productId, candles, position, config: strategyConfig(env) });
      signal.book = book;
      signal.spreadBps = spreadBps(book);
      if (signal.spreadBps > config.maxSpreadBps && signal.action !== "HOLD") {
        signal.reasons = [...(signal.reasons ?? []), "spread-too-wide"];
        signal.action = "HOLD";
      }
      const signalId = await store.recordSignal(runId, signal);
      await store.updateMark(productId, book.mid || signal.price);
      signals.push(signal);

      if (!enabled) continue;
      if (signal.action === "BUY" && !position) {
        const portfolio = await store.loadPortfolio(startingCash);
        const maxExposure = portfolio.equity * config.maxExposurePct;
        const exposureRoom = Math.max(0, maxExposure - portfolio.openPositionValue);
        const reserve = portfolio.equity * config.cashReservePct;
        const spendableCash = Math.max(0, portfolio.cash - reserve);
        const notional = Math.min(
          portfolio.equity * config.positionPct,
          config.maxTradeUsd,
          exposureRoom,
          spendableCash / (1 + config.feeBps / 10_000)
        );
        if (notional >= config.minTradeUsd && book.bestAsk > 0) {
          const fillPrice = book.bestAsk * (1 + config.slippageBps / 10_000);
          executions.push(await store.executeBuy({
            runId, signalId, productId, notional, fillPrice,
            feeBps: config.feeBps, slippageBps: config.slippageBps,
            reasons: signal.reasons
          }));
        }
      } else if (signal.action === "SELL" && position && book.bestBid > 0) {
        const fillPrice = book.bestBid * (1 - config.slippageBps / 10_000);
        executions.push(await store.executeSell({
          runId, signalId, productId, fillPrice,
          feeBps: config.feeBps, slippageBps: config.slippageBps,
          reasons: signal.reasons
        }));
      }
    } catch (error) {
      errors.push(`${productId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const buySignals = signals.filter((item) => item.action === "BUY").length;
  const sellSignals = signals.filter((item) => item.action === "SELL").length;
  const holdSignals = signals.filter((item) => item.action === "HOLD").length;
  const appliedExecutions = executions.filter((item) => item.applied).length;
  const status = errors.length === 0 ? "HEALTHY" : errors.length < Math.max(1, list.length) ? "DEGRADED" : "UNHEALTHY";
  const summary = {
    status,
    health: status,
    simulationEnabled: enabled,
    products: list,
    productsChecked: signals.length,
    buySignals,
    sellSignals,
    holdSignals,
    executions: appliedExecutions,
    errors,
    config: {
      candleSeconds: finite(env.CRYPTO_CANDLE_SECONDS, 300),
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      positionPct: config.positionPct,
      maxExposurePct: config.maxExposurePct
    }
  };
  await store.finishRun(runId, summary);
  return { runId, ...summary };
}
