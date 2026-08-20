import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_SECONDS,
  annualizedTrailingVolatility,
  backtestTsmom,
  exactMomentumReturn,
  targetWeightForProduct
} from "../research/crypto/lib/tsmom.js";

const manifest = {
  portfolio: { startingCash: 10000 },
  data: { products: ["BTC-USD", "ETH-USD", "SOL-USD"] },
  signal: { momentumLookbackDays: [30, 90, 180] },
  risk: {
    realizedVolLookbackDays: 60,
    annualizationDays: 365,
    targetAnnualizedVol: 0.50,
    maxAssetWeight: 0.15,
    maxTotalExposure: 0.45
  },
  costModel: { totalBpsPerDollarTurnover: 70 }
};

function dailyCandles(startIso, days, priceFn) {
  const start = Date.parse(startIso) / 1000;
  return Array.from({ length: days }, (_, index) => {
    const time = start + index * DAY_SECONDS;
    const close = priceFn(index);
    return { time, open: close, high: close, low: close, close, volume: 1000 };
  });
}

function toMap(candles) {
  return new Map(candles.map((candle) => [candle.time, candle]));
}

test("Trial 5 momentum signal never reads the decision-day close", () => {
  const candles = dailyCandles("2021-01-01T00:00:00.000Z", 400, (index) => 100 + index);
  const decisionTime = Date.parse("2022-01-01T00:00:00.000Z") / 1000;
  const map = toMap(candles);
  const before = exactMomentumReturn(map, decisionTime, 30);
  map.get(decisionTime).close = 1_000_000;
  const after = exactMomentumReturn(map, decisionTime, 30);
  assert.equal(after, before);
  assert.ok(before > 0);
});

test("Trial 5 exact lookback fails closed instead of interpolating", () => {
  const candles = dailyCandles("2021-01-01T00:00:00.000Z", 400, (index) => 100 + index);
  const decisionTime = Date.parse("2022-01-01T00:00:00.000Z") / 1000;
  const map = toMap(candles);
  map.delete(decisionTime - DAY_SECONDS - 90 * DAY_SECONDS);
  const decision = targetWeightForProduct(map, decisionTime, manifest);
  assert.equal(decision.weight, 0);
  assert.equal(decision.reason, "missing_exact_momentum_lookback");
});

test("volatility management can only reduce a positive momentum weight", () => {
  const candles = dailyCandles("2021-01-01T00:00:00.000Z", 400, (index) => {
    const trend = 100 * Math.exp(index * 0.002);
    const alternatingShock = index % 2 === 0 ? 1.08 : 0.92;
    return trend * alternatingShock;
  });
  const decisionTime = Date.parse("2022-01-01T00:00:00.000Z") / 1000;
  const map = toMap(candles);
  const unscaled = targetWeightForProduct(map, decisionTime, manifest, { volatilityScaling: false });
  const scaled = targetWeightForProduct(map, decisionTime, manifest, { volatilityScaling: true });
  assert.ok(unscaled.weight > 0);
  assert.ok(scaled.weight >= 0);
  assert.ok(scaled.weight <= unscaled.weight + 1e-12);
  assert.ok(scaled.weight <= manifest.risk.maxAssetWeight + 1e-12);
});

test("annualized volatility uses only the frozen trailing window", () => {
  const candles = dailyCandles("2021-01-01T00:00:00.000Z", 400, (index) => 100 * Math.exp(index * 0.001 + 0.01 * Math.sin(index)));
  const decisionTime = Date.parse("2022-01-01T00:00:00.000Z") / 1000;
  const map = toMap(candles);
  const before = annualizedTrailingVolatility(map, decisionTime, 60, 365);
  map.get(decisionTime).close = 1;
  const after = annualizedTrailingVolatility(map, decisionTime, 60, 365);
  assert.equal(after, before);
  assert.ok(before > 0);
});

test("monthly backtest respects exposure cap and charges 70 bps on every traded dollar", () => {
  const candles = dailyCandles("2021-01-01T00:00:00.000Z", 550, (index) => 100 * Math.exp(index * 0.001));
  const dataset = {
    products: {
      "BTC-USD": candles.map((row) => ({ ...row })),
      "ETH-USD": candles.map((row) => ({ ...row, open: row.open * 2, high: row.high * 2, low: row.low * 2, close: row.close * 2 })),
      "SOL-USD": candles.map((row) => ({ ...row, open: row.open * 0.5, high: row.high * 0.5, low: row.low * 0.5, close: row.close * 0.5 }))
    }
  };
  const state = backtestTsmom(dataset, manifest, {
    start: "2022-01-01T00:00:00.000Z",
    end: "2022-07-01T00:00:00.000Z",
    volatilityScaling: true
  });
  assert.ok(state.rebalances.length >= 5);
  for (const rebalance of state.rebalances) assert.ok(rebalance.totalTargetWeight <= 0.45 + 1e-12);
  assert.ok(Math.abs(state.transactionCostsUsd - state.turnoverUsd * 0.007) < 1e-7);
  assert.ok(state.cash >= 0);
});
