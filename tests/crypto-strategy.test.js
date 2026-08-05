import assert from "node:assert/strict";
import test from "node:test";
import { deriveCryptoSignal, ema, rsi } from "../src/crypto/strategy.js";

function candles({ start = 100, drift = 0.001, count = 100, shock = 0 } = {}) {
  const rows = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index / 4) * 0.0015;
    const open = price;
    price *= 1 + drift + wave;
    if (index === count - 1) price *= 1 + shock;
    rows.push({
      time: 1_700_000_000 + index * 300,
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

test("trend strategy buys a controlled breakout", () => {
  const signal = deriveCryptoSignal({
    productId: "BTC-USD",
    candles: candles({ drift: 0.0012 }),
    config: { requiredChecks: 5, maxRsi: 100 }
  });
  assert.equal(signal.action, "BUY");
  assert.ok(signal.score > 50);
});

test("open position exits on hard stop", () => {
  const series = candles({ drift: 0.0002, shock: -0.05 });
  const signal = deriveCryptoSignal({
    productId: "ETH-USD",
    candles: series,
    position: { units: 2, averageCost: series.at(-2).close, highestPrice: series.at(-2).close }
  });
  assert.equal(signal.action, "SELL");
  assert.ok(signal.reasons.includes("hard-stop-loss"));
});

test("flat noisy market remains a hold", () => {
  const signal = deriveCryptoSignal({
    productId: "SOL-USD",
    candles: candles({ drift: 0, count: 100 })
  });
  assert.equal(signal.action, "HOLD");
});
