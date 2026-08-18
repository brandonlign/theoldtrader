import assert from "node:assert/strict";
import test from "node:test";
import { Dec } from "../src/decimal.js";
import { GammaClient } from "../src/clients/gamma.js";
import { ClobClient } from "../src/clients/clob.js";
import { calculateTakerFee } from "../src/fees.js";
import { quoteLevels } from "../src/orderbook.js";
import { PaperBroker } from "../src/paper/paper-broker.js";
import { findCompleteSetOpportunities } from "../src/strategy/complete-set.js";
import { D, book, levels, market } from "./helpers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const options = {
  nowMs: 1_500,
  maxShares: D(1000),
  minNetProfitUsd: D("0.01"),
  minRoiBps: D(0),
  safetyBufferBps: D(0),
  fixedCostUsd: D(0),
  maxBookAgeMs: 10_000
};
const zeroFees = { rate: D(0), exponent: 2, takerOnly: true };

test("Gamma client normalizes JSON-encoded binary token metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/markets");
    assert.equal(parsed.searchParams.get("active"), "true");
    return jsonResponse([{
      id: "market-1", conditionId: "condition-1", question: "Will it work?", slug: "will-it-work",
      outcomes: '["Yes","No"]', clobTokenIds: '["yes-token","no-token"]',
      active: true, closed: false, acceptingOrders: true, negRisk: false, feesEnabled: true,
      feeSchedule: { rate: 0.04, exponent: 2, takerOnly: true }
    }]);
  };
  const markets = await new GammaClient("https://gamma.example", 1000).listActiveBinaryMarkets(1, 1);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].yesTokenId, "yes-token");
  assert.equal(markets[0].noTokenId, "no-token");
  assert.equal(markets[0].feeSchedule.rate.toString(), "0.04");
});

test("CLOB client posts batches and sorts book levels", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).pathname, "/books");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), [{ token_id: "yes-token" }]);
    return jsonResponse([{
      market: "condition-1", asset_id: "yes-token", timestamp: "1700000000000",
      bids: [{ price: "0.44", size: "10" }, { price: "0.45", size: "5" }],
      asks: [{ price: "0.48", size: "10" }, { price: "0.47", size: "5" }],
      min_order_size: "1", tick_size: "0.01", neg_risk: false
    }]);
  };
  const books = await new ClobClient("https://clob.example", 1000).getOrderBooks(["yes-token"], 100);
  const result = books.get("yes-token");
  assert.ok(result);
  assert.equal(result.bids[0].price.toString(), "0.45");
  assert.equal(result.asks[0].price.toString(), "0.47");
});

test("CLOB client reads the authoritative fee curve", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(new URL(String(url)).pathname, "/clob-markets/condition-1");
    return jsonResponse({ fd: { r: 0.05, e: 2, to: true } });
  };
  const schedule = await new ClobClient("https://clob.example", 1000).getFeeSchedule("condition-1");
  assert.equal(schedule.rate.toString(), "0.05");
  assert.equal(schedule.exponent, 2);
});

test("fixed decimal arithmetic avoids binary float errors", () => {
  assert.equal(new Dec("0.1").plus("0.2").toString(), "0.3");
  assert.equal(new Dec("0.46").plus("0.51").toString(), "0.97");
});

test("fixed decimal multiplication and rounding", () => {
  assert.equal(new Dec(100).mul("0.04").mul("0.25").toString(), "1");
  assert.equal(new Dec("1.23456789").toDecimalPlaces(5).toString(), "1.23457");
});

test("calculates documented p(1-p) taker fees", () => {
  const fee = calculateTakerFee(D(100), D("0.5"), { rate: D("0.04"), exponent: 2, takerOnly: true });
  assert.equal(fee.toString(), "1");
});

test("zero-rate market has zero fees", () => {
  assert.equal(calculateTakerFee(D(100), D("0.5"), zeroFees).toString(), "0");
});

test("walks multiple levels and calculates VWAP", () => {
  const quote = quoteLevels("yes", "BUY", levels([["0.45", 10], ["0.47", 20]]), D(15), zeroFees);
  assert.ok(quote);
  assert.equal(quote.notional.toString(), "6.85");
  assert.equal(quote.averagePrice.toFixed(6), "0.456667");
  assert.equal(quote.worstPrice.toString(), "0.47");
});

test("rejects unavailable depth", () => {
  assert.equal(quoteLevels("yes", "BUY", levels([["0.45", 10]]), D(11), zeroFees), null);
});

test("finds buy-and-merge complete-set arbitrage", () => {
  const opportunity = findCompleteSetOpportunities(
    market(),
    book("yes-token", levels([["0.45", 100]]), levels([["0.46", 100]])),
    book("no-token", levels([["0.50", 100]]), levels([["0.51", 100]])),
    zeroFees,
    options
  ).find((item) => item.direction === "BUY_AND_MERGE");
  assert.ok(opportunity);
  assert.equal(opportunity.shares.toString(), "100");
  assert.equal(opportunity.netProfit.toString(), "3");
});

test("finds split-and-sell complete-set arbitrage", () => {
  const opportunity = findCompleteSetOpportunities(
    market(),
    book("yes-token", levels([["0.53", 50]]), levels([["0.55", 50]])),
    book("no-token", levels([["0.50", 50]]), levels([["0.52", 50]])),
    zeroFees,
    options
  ).find((item) => item.direction === "SPLIT_AND_SELL");
  assert.ok(opportunity);
  assert.equal(opportunity.netProfit.toString(), "1.5");
});

test("rejects apparent arbitrage erased by fees", () => {
  const opportunities = findCompleteSetOpportunities(
    market(),
    book("yes-token", levels([["0.49", 100]]), levels([["0.49", 100]])),
    book("no-token", levels([["0.50", 100]]), levels([["0.50", 100]])),
    { rate: D("0.05"), exponent: 2, takerOnly: true },
    options
  );
  assert.equal(opportunities.some((item) => item.direction === "BUY_AND_MERGE"), false);
});

test("chooses profitable depth instead of blindly taking the full book", () => {
  const opportunity = findCompleteSetOpportunities(
    market(),
    book("yes-token", levels([["0.44", 100]]), levels([["0.45", 10], ["0.55", 100]])),
    book("no-token", levels([["0.50", 100]]), levels([["0.50", 100]])),
    zeroFees,
    options
  ).find((item) => item.direction === "BUY_AND_MERGE");
  assert.ok(opportunity);
  assert.equal(opportunity.shares.toString(), "10");
  assert.equal(opportunity.netProfit.toString(), "0.5");
});

test("rejects stale books", () => {
  const opportunities = findCompleteSetOpportunities(
    market(),
    book("yes-token", [], levels([["0.46", 100]]), 1_000),
    book("no-token", [], levels([["0.51", 100]]), 1_000),
    zeroFees,
    { ...options, nowMs: 20_000, maxBookAgeMs: 1_000 }
  );
  assert.deepEqual(opportunities, []);
});

test("paper broker realizes modeled profit once", () => {
  const opportunity = findCompleteSetOpportunities(
    market(),
    book("yes-token", [], levels([["0.46", 10]])),
    book("no-token", [], levels([["0.51", 10]])),
    zeroFees,
    { ...options, maxShares: D(10), minNetProfitUsd: D(0) }
  )[0];
  assert.ok(opportunity);
  const broker = new PaperBroker(D(100));
  broker.execute(opportunity);
  assert.equal(broker.snapshot().cash.toString(), "100.3");
  assert.throws(() => broker.execute(opportunity), /already paper-filled/);
});
