import assert from "node:assert/strict";
import test from "node:test";
import { deriveCryptoSignal, ema, rsi } from "../src/crypto/strategy.js";

function candles({ start = 100, drift = 0.001, count = 120, shock = 0 } = {}) {
  const rows = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index / 4) * 0.0015;
    const open = price;
    price *= 1 + drift + wave;
    if (index === count - 1) price *= 1 + shock;
    rows.push({
      time: 1_700_000_000 + index * 900,
      open,
      close: price,
      high: Math.max(open, price) * 1.002,
      low: Math.min(open, price) * 0.998,
      volume: 100 + index
    });
  }
  return rows;
}

test("ema favors recent prices", () => {
  assert.ok(ema([1, 1, 1, 2, 3], 3) > ema([1, 1, 1, 2, 3], 10));
});

test("rsi rises in a persistent uptrend", () => {
  assert.ok(rsi([1, 2, 3, 4, 5, 6, 7], 6) > 90);
});

test("trend strategy buys only when a controlled breakout clears trading costs", () => {
  const signal = deriveCryptoSignal({
    productId: "BTC-USD",
    candles: candles({ drift: 0.0012 }),
    config: {
      requiredChecks: 7,
      maxRsi: 100,
      roundTripCostPct: 0.002,
      exitCostPct: 0.001,
      minEdgeToCost: 1.5
    }
  });
  assert.equal(signal.action, "BUY");
  assert.ok(signal.score > 65);
  assert.ok(signal.metrics.directionalEdge > signal.metrics.requiredEdge);
});

test("otherwise bullish setup is rejected when its edge cannot pay the round trip", () => {
  const signal = deriveCryptoSignal({
    productId: "BTC-USD",
    candles: candles({ drift: 0.0012 }),
    config: {
      requiredChecks: 7,
      maxRsi: 100,
      roundTripCostPct: 0.03,
      minEdgeToCost: 2
    }
  });
  assert.equal(signal.action, "HOLD");
  assert.ok(signal.reasons.includes("edge-not-confirmed"));
  assert.ok(signal.score <= 64);
});

test("open position exits on a cost-aware hard stop", () => {
  const series = candles({ drift: 0.0002, shock: -0.07 });
  const signal = deriveCryptoSignal({
    productId: "ETH-USD",
    candles: series,
    position: {
      units: 2,
      averageCost: series.at(-2).close,
      highestPrice: series.at(-2).close,
      openedAt: new Date((series.at(-20).time) * 1000).toISOString()
    },
    config: { roundTripCostPct: 0.013, exitCostPct: 0.0065 }
  });
  assert.equal(signal.action, "SELL");
  assert.ok(signal.reasons.includes("hard-stop-loss"));
  assert.ok(signal.metrics.netReturnPct < signal.metrics.grossReturnPct);
});

test("flat noisy market remains a hold and cannot show fake 100 confidence", () => {
  const signal = deriveCryptoSignal({
    productId: "SOL-USD",
    candles: candles({ drift: 0, count: 120 }),
    config: { roundTripCostPct: 0.013 }
  });
  assert.equal(signal.action, "HOLD");
  assert.ok(signal.score <= 64);
});
