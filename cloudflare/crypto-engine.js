import { CoinbasePublicClient } from "../src/crypto/coinbase-public.js";
import { estimateExitCostPct, estimateRoundTripCostPct, riskSizedNotional } from "../src/crypto/risk.js";
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

function strategyConfig(env, costs = {}) {
  return {
    fastPeriod: finite(env.CRYPTO_FAST_EMA, 12),
    slowPeriod: finite(env.CRYPTO_SLOW_EMA, 36),
    regimePeriod: finite(env.CRYPTO_REGIME_EMA, 72),
    regimeLookback: finite(env.CRYPTO_REGIME_LOOKBACK, 8),
    momentumPeriod: finite(env.CRYPTO_MOMENTUM_PERIOD, 12),
    rsiPeriod: finite(env.CRYPTO_RSI_PERIOD, 14),
    minTrend: finite(env.CRYPTO_MIN_TREND, 0.0018),
    minMomentum: finite(env.CRYPTO_MIN_MOMENTUM, 0.004),
    minRsi: finite(env.CRYPTO_MIN_RSI, 53),
    maxRsi: finite(env.CRYPTO_MAX_RSI, 68),
    exitRsi: finite(env.CRYPTO_EXIT_RSI, 46),
    minRegimeSlope: finite(env.CRYPTO_MIN_REGIME_SLOPE, 0.0008),
    maxEntryVolatility: finite(env.CRYPTO_MAX_ATR_PCT, 0.03),
    stopLossPct: finite(env.CRYPTO_STOP_LOSS_PCT, 0.035),
    takeProfitPct: finite(env.CRYPTO_TAKE_PROFIT_PCT, 0.075),
    trailingStopPct: finite(env.CRYPTO_TRAILING_STOP_PCT, 0.028),
    minVolumeRatio: finite(env.CRYPTO_MIN_VOLUME_RATIO, 0.9),
    requiredChecks: finite(env.CRYPTO_REQUIRED_CHECKS, 7),
    minEdgeToCost: finite(env.CRYPTO_MIN_EDGE_TO_COST, 1.8),
    minProjectedEdge: finite(env.CRYPTO_MIN_PROJECTED_EDGE, 0.01),
    minHoldMinutes: finite(env.CRYPTO_MIN_HOLD_MINUTES, 180),
    roundTripCostPct: finite(costs.roundTripCostPct),
    exitCostPct: finite(costs.exitCostPct)
  };
}

function executionConfig(env) {
  return {
    riskPct: Math.max(0.001, Math.min(0.02, finite(env.CRYPTO_RISK_PCT, 0.004))),
    maxPositionPct: Math.max(0.02, Math.min(0.4, finite(env.CRYPTO_MAX_POSITION_PCT, 0.15))),
    maxExposurePct: Math.max(0.1, Math.min(0.9, finite(env.CRYPTO_MAX_EXPOSURE_PCT, 0.45))),
    cashReservePct: Math.max(0.05, Math.min(0.6, finite(env.CRYPTO_CASH_RESERVE_PCT, 0.25))),
    minTradeUsd: Math.max(5, finite(env.CRYPTO_MIN_TRADE_USD, 25)),
    maxTradeUsd: Math.max(25, finite(env.CRYPTO_MAX_TRADE_USD, 2_000)),
    feeBps: Math.max(0, finite(env.CRYPTO_FEE_BPS, 60)),
    slippageBps: Math.max(0, finite(env.CRYPTO_SLIPPAGE_BPS, 5)),
    maxSpreadBps: Math.max(1, finite(env.CRYPTO_MAX_SPREAD_BPS, 35)),
    cooldownMinutes: Math.max(0, finite(env.CRYPTO_COOLDOWN_MINUTES, 360))
  };
}

function spreadBps(book) {
  if (!book?.bestBid || !book?.bestAsk || book.mid <= 0) return Infinity;
  return ((book.bestAsk - book.bestBid) / book.mid) * 10_000;
}

function cooldownRemainingMinutes(lastExit, cooldownMinutes) {
  if (!lastExit?.executedAt || cooldownMinutes <= 0) return 0;
  const exitedAt = Date.parse(lastExit.executedAt);
  if (!Number.isFinite(exitedAt)) return 0;
  return Math.max(0, cooldownMinutes - (Date.now() - exitedAt) / 60_000);
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
      const [candles, book, position, lastExit] = await Promise.all([
        client.getCandles(productId, { granularity: finite(env.CRYPTO_CANDLE_SECONDS, 900) }),
        client.getBook(productId),
        store.loadPosition(productId),
        store.loadLastExit(productId)
      ]);
      const currentSpreadBps = spreadBps(book);
      const costs = {
        roundTripCostPct: estimateRoundTripCostPct({
          feeBps: config.feeBps,
          slippageBps: config.slippageBps,
          spreadBps: currentSpreadBps
        }),
        exitCostPct: estimateExitCostPct({
          feeBps: config.feeBps,
          slippageBps: config.slippageBps,
          spreadBps: currentSpreadBps
        })
      };
      const signalConfig = strategyConfig(env, costs);
      const signal = deriveCryptoSignal({ productId, candles, position, config: signalConfig });
      signal.book = book;
      signal.spreadBps = currentSpreadBps;

      if (signal.spreadBps > config.maxSpreadBps && signal.action !== "HOLD") {
        signal.reasons = [...(signal.reasons ?? []), "spread-too-wide"];
        signal.action = "HOLD";
      }

      const remainingCooldown = cooldownRemainingMinutes(lastExit, config.cooldownMinutes);
      if (signal.action === "BUY" && remainingCooldown > 0) {
        signal.reasons = [...(signal.reasons ?? []), `cooldown-active-${Math.ceil(remainingCooldown)}m`];
        signal.action = "HOLD";
        signal.score = Math.min(64, finite(signal.score));
      }

      const signalId = await store.recordSignal(runId, signal);
      await store.updateMark(productId, book.mid || signal.price);
      signals.push(signal);

      if (!enabled) continue;
      if (signal.action === "BUY" && !position) {
        const portfolio = await store.loadPortfolio(startingCash);
        const notional = riskSizedNotional({
          equity: portfolio.equity,
          cash: portfolio.cash,
          openPositionValue: portfolio.openPositionValue,
          stopLossPct: signal.metrics?.effectiveStopLossPct ?? signalConfig.stopLossPct,
          riskPct: config.riskPct,
          maxPositionPct: config.maxPositionPct,
          maxExposurePct: config.maxExposurePct,
          cashReservePct: config.cashReservePct,
          maxTradeUsd: config.maxTradeUsd,
          feeBps: config.feeBps
        });
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
  const [portfolio, performance] = await Promise.all([
    store.loadPortfolio(startingCash),
    store.performanceSummary()
  ]);
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
    portfolio: {
      equity: portfolio.equity,
      cash: portfolio.cash,
      openPositionValue: portfolio.openPositionValue,
      realizedPnl: portfolio.realizedPnl
    },
    performance,
    config: {
      candleSeconds: finite(env.CRYPTO_CANDLE_SECONDS, 900),
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      riskPct: config.riskPct,
      maxPositionPct: config.maxPositionPct,
      maxExposurePct: config.maxExposurePct,
      cooldownMinutes: config.cooldownMinutes,
      minEdgeToCost: finite(env.CRYPTO_MIN_EDGE_TO_COST, 1.8)
    }
  };
  await store.finishRun(runId, summary);
  return { runId, ...summary };
}
