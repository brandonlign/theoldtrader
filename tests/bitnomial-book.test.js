import test from "node:test";
import assert from "node:assert/strict";
import { executableVwap, normalizeBookSnapshot, validateBookFreshness } from "../research/crypto/lib/bitnomial-book.js";

const RAW = {
  type: "book",
  ack_id: "123",
  symbol: "BTCUSD",
  timestamp: "2026-08-20T05:00:00.000Z",
  asks: [[10001000, 1000], [10002000, 2000]],
  bids: [[9999000, 1200], [9998000, 2000]]
};

function book() {
  return normalizeBookSnapshot(RAW, { symbol: "BTCUSD", priceIncrement: 0.01, contractSizeBtc: 0.00001 });
}

test("normalizes Bitnomial tick prices and contract quantities into USD/BTC", () => {
  const normalized = book();
  assert.equal(normalized.bestAskUsd, 100010);
  assert.equal(normalized.bestBidUsd, 99990);
  assert.equal(normalized.asks[0].btcQuantity, 0.01);
  assert.equal(normalized.bids[0].btcQuantity, 0.012);
  assert.ok(normalized.spreadBps > 0);
});

test("BUY VWAP walks asks for the exact BTC quantity", () => {
  const result = executableVwap(book(), { action: "BUY", btcQuantity: 0.02 });
  assert.equal(result.pass, true);
  assert.equal(result.levelsConsumed, 2);
  assert.equal(result.filledBtc, 0.02);
  assert.equal(result.vwapUsd, (0.01 * 100010 + 0.01 * 100020) / 0.02);
});

test("SELL VWAP walks bids and does not use ask liquidity", () => {
  const result = executableVwap(book(), { action: "SELL", btcQuantity: 0.02 });
  assert.equal(result.pass, true);
  assert.equal(result.levelsConsumed, 2);
  assert.equal(result.vwapUsd, (0.012 * 99990 + 0.008 * 99980) / 0.02);
});

test("insufficient displayed depth fails rather than extrapolating a fill", () => {
  const result = executableVwap(book(), { action: "BUY", btcQuantity: 0.04 });
  assert.equal(result.pass, false);
  assert.equal(result.vwapUsd, null);
  assert.ok(result.unfilledBtc > 0);
});

test("crossed, empty, wrong-symbol and malformed books fail closed", () => {
  assert.throws(() => normalizeBookSnapshot({ ...RAW, symbol: "ETHUSD" }, { symbol: "BTCUSD", priceIncrement: 0.01, contractSizeBtc: 0.00001 }), /symbol mismatch/);
  assert.throws(() => normalizeBookSnapshot({ ...RAW, asks: [] }, { symbol: "BTCUSD", priceIncrement: 0.01, contractSizeBtc: 0.00001 }), /empty side/);
  assert.throws(() => normalizeBookSnapshot({ ...RAW, asks: [[9990000, 1]] }, { symbol: "BTCUSD", priceIncrement: 0.01, contractSizeBtc: 0.00001 }), /crossed/);
});

test("book freshness rejects stale and future snapshots", () => {
  const normalized = book();
  assert.equal(validateBookFreshness(normalized, "2026-08-20T05:00:10Z", 30).pass, true);
  assert.equal(validateBookFreshness(normalized, "2026-08-20T05:00:31Z", 30).pass, false);
  assert.equal(validateBookFreshness(normalized, "2026-08-20T04:59:58Z", 30).pass, false);
});
