import assert from "node:assert/strict";
import test from "node:test";
import { Dec } from "../src/decimal.js";
import { simulateCompleteSetExecution } from "../src/paper/realistic-simulator.js";
import { simulateMultiOutcomeExecution } from "../src/paper/multi-outcome-simulator.js";
import { applyPaperExecution, defaultPaperPortfolio } from "../src/paper/portfolio.js";

const D = (value) => new Dec(value);
const fee = { rate: D(0), exponent: 2, takerOnly: true };

function book(tokenId, asks, timestampMs = 2_000) {
  return {
    assetId: tokenId,
    timestampMs,
    asks: asks.map(([price, size]) => ({ price: D(price), size: D(size) })),
    bids: [],
    minOrderSize: D(1)
  };
}

test("a completely missed second leg remains visible as open exposure", () => {
  const execution = simulateCompleteSetExecution({
    id: "one-leg-only",
    direction: "BUY_AND_MERGE",
    shares: D(10),
    detectedAt: 0,
    executedAt: 2_000,
    yesTokenId: "yes",
    noTokenId: "no",
    yesBook: book("yes", [["0.46", 10]]),
    noBook: book("no", []),
    feeSchedule: fee
  }, {
    liquidityHaircut: 1,
    minPairedFillRatio: 0.9,
    maxBookAgeMs: 1_000,
    legOrder: "YES_FIRST"
  });

  assert.equal(execution.status, "PARTIAL_EXPOSURE");
  assert.equal(execution.pairedShares.toString(), "0");
  assert.equal(execution.openInventory[0].shares.toString(), "10");
  const portfolio = applyPaperExecution(defaultPaperPortfolio(100), execution);
  assert.equal(portfolio.cash.toString(), "95.4");
  assert.equal(portfolio.positions.yes.shares.toString(), "10");
});

test("an incomplete multi-outcome fill preserves every unmatched leg", () => {
  const execution = simulateMultiOutcomeExecution({
    id: "multi-partial",
    detectedAt: 0,
    executedAt: 2_000,
    shares: D(10),
    legs: [
      { tokenId: "a", label: "A", book: book("a", [["0.40", 10]]), feeSchedule: fee },
      { tokenId: "b", label: "B", book: book("b", [["0.35", 10]]), feeSchedule: fee },
      { tokenId: "c", label: "C", book: book("c", []), feeSchedule: fee }
    ]
  }, {
    liquidityHaircut: 1,
    minPairedFillRatio: 0.9,
    maxBookAgeMs: 1_000
  });

  assert.equal(execution.status, "PARTIAL_EXPOSURE");
  assert.equal(execution.pairedShares.toString(), "0");
  assert.equal(execution.openInventory.length, 2);
  assert.equal(execution.cashDelta.toString(), "-7.5");
});
