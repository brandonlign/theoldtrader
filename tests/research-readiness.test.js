import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dec } from "../src/decimal.js";
import { simulateCompleteSetExecution } from "../src/paper/realistic-simulator.js";
import { applyPaperExecution, defaultPaperPortfolio } from "../src/paper/portfolio.js";
import { JsonPaperStore } from "../src/paper/state-store.js";
import { walkForwardEvaluate } from "../src/whales/walk-forward.js";
import { createHealthReport } from "../src/monitoring/health.js";
import { findMultiOutcomeOpportunity, validateMultiOutcomeEvent } from "../src/strategy/multi-outcome.js";

const D = (value) => new Dec(value);
const zeroFees = { rate: D(0), exponent: 2, takerOnly: true };

function book(token, asks, bids = [], timestampMs = 10_000) {
  return {
    assetId: token,
    timestampMs,
    asks: asks.map(([price, size]) => ({ price: D(price), size: D(size) })),
    bids: bids.map(([price, size]) => ({ price: D(price), size: D(size) })),
    minOrderSize: D(1),
    hash: `${token}-hash`
  };
}

function event(overrides = {}) {
  return {
    id: "event-1",
    title: "Who wins?",
    slug: "who-wins",
    active: true,
    closed: false,
    negRisk: true,
    negRiskAugmented: false,
    enableNegRisk: false,
    markets: [
      { id: "a", conditionId: "ca", question: "Will A win?", groupItemTitle: "A", yesTokenId: "ya", active: true, closed: false, acceptingOrders: true, negRisk: true, negRiskMarketId: "group" },
      { id: "b", conditionId: "cb", question: "Will B win?", groupItemTitle: "B", yesTokenId: "yb", active: true, closed: false, acceptingOrders: true, negRisk: true, negRiskMarketId: "group" },
      { id: "c", conditionId: "cc", question: "Will C win?", groupItemTitle: "C", yesTokenId: "yc", active: true, closed: false, acceptingOrders: true, negRisk: true, negRiskMarketId: "group" }
    ],
    ...overrides
  };
}

test("multi-outcome complete set finds a depth-aware edge", () => {
  const books = new Map([
    ["ya", book("ya", [["0.40", 100]])],
    ["yb", book("yb", [["0.35", 100]])],
    ["yc", book("yc", [["0.21", 100]])]
  ]);
  const schedules = new Map([["ca", zeroFees], ["cb", zeroFees], ["cc", zeroFees]]);
  const result = findMultiOutcomeOpportunity(event(), books, schedules, {
    nowMs: 10_500,
    maxShares: D(100),
    minNetProfitUsd: D("0.01"),
    minRoiBps: D(0),
    safetyBufferBps: D(0),
    fixedCostUsd: D(0),
    maxBookAgeMs: 1_000
  });
  assert.ok(result.opportunity);
  assert.equal(result.opportunity.netProfit.toString(), "4");
  assert.equal(result.opportunity.outcomeCount, 3);
});

test("multi-outcome detector rejects augmented and Other sets", () => {
  const candidate = event({ negRiskAugmented: true });
  candidate.markets[2].groupItemTitle = "Other";
  candidate.markets[2].negRiskOther = true;
  const validation = validateMultiOutcomeEvent(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.some((reason) => reason.includes("augmented")));
  assert.ok(validation.reasons.some((reason) => reason.includes("unstable-other")));
});

test("realistic complete-set simulation models delay and a full fill", () => {
  const execution = simulateCompleteSetExecution({
    id: "full",
    direction: "BUY_AND_MERGE",
    shares: D(10),
    detectedAt: 0,
    executedAt: 2_000,
    yesTokenId: "yes",
    noTokenId: "no",
    yesBook: book("yes", [["0.46", 20]], [], 2_000),
    noBook: book("no", [["0.51", 20]], [], 2_000),
    feeSchedule: zeroFees
  }, {
    executionDelayMs: 1_000,
    liquidityHaircut: 1,
    minPairedFillRatio: 0.9,
    maxBookAgeMs: 1_000
  });
  assert.equal(execution.status, "FILLED");
  assert.equal(execution.guaranteedProfit.toString(), "0.3");
  assert.equal(execution.openInventory.length, 0);
});

test("failed second leg creates exposure instead of invented profit", () => {
  const execution = simulateCompleteSetExecution({
    id: "partial",
    direction: "BUY_AND_MERGE",
    shares: D(10),
    detectedAt: 0,
    executedAt: 2_000,
    yesTokenId: "yes",
    noTokenId: "no",
    yesBook: book("yes", [["0.46", 10]], [], 2_000),
    noBook: book("no", [["0.51", 4]], [], 2_000),
    feeSchedule: zeroFees
  }, {
    executionDelayMs: 1_000,
    liquidityHaircut: 1,
    minPairedFillRatio: 0.3,
    maxBookAgeMs: 1_000,
    legOrder: "YES_FIRST"
  });
  assert.equal(execution.status, "PARTIAL_EXPOSURE");
  assert.equal(execution.pairedShares.toString(), "4");
  assert.equal(execution.openInventory[0].shares.toString(), "6");
});

test("paper portfolio persists and deduplicates executions", async () => {
  const execution = simulateCompleteSetExecution({
    id: "persist",
    direction: "BUY_AND_MERGE",
    shares: D(10),
    detectedAt: 0,
    executedAt: 2_000,
    yesTokenId: "yes",
    noTokenId: "no",
    yesBook: book("yes", [["0.46", 20]], [], 2_000),
    noBook: book("no", [["0.51", 20]], [], 2_000),
    feeSchedule: zeroFees
  }, { liquidityHaircut: 1, minPairedFillRatio: 0.9, maxBookAgeMs: 1_000 });
  const state = applyPaperExecution(defaultPaperPortfolio(100), execution);
  assert.equal(String(state.cash), "100.3");
  assert.throws(() => applyPaperExecution(state, execution), /already applied/);
  const directory = await mkdtemp(join(tmpdir(), "moneymog-"));
  const path = join(directory, "paper.json");
  const store = new JsonPaperStore(path, 100);
  await store.save(state);
  const loaded = await store.load();
  assert.equal(loaded.cash, "100.3");
  assert.ok((await readFile(path, "utf8")).includes('"persist"'));
});

function positions(pnls) {
  return pnls.map((realizedPnl, index) => ({
    realizedPnl,
    totalBought: 100,
    avgPrice: 0.5,
    timestamp: index + 1,
    title: "Election market"
  }));
}

test("walk-forward evaluation distinguishes repeatability from collapse", () => {
  const stable = walkForwardEvaluate(positions([5,4,3,2,4,3,2,3,2,4,2,3,2,2,3,2,2,3,2,2,3,2,2,3,2]));
  assert.equal(stable.eligible, true);
  const collapse = walkForwardEvaluate(positions([50,4,3,2,4,3,2,3,2,4,-8,-7,-9,-6,-8,-5,-7,-8,-9,-6]));
  assert.equal(collapse.eligible, false);
  assert.ok(collapse.rejectionReasons.includes("non-positive-forward-pnl"));
});

test("health report surfaces lag, errors, and persistence failure", () => {
  const report = createHealthReport({
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    latestSourceTimestampMs: Date.parse("2025-12-31T23:40:00Z"),
    walletsExpected: 10,
    walletsChecked: 4,
    errors: [{ error: "upstream" }],
    persistenceSucceeded: false
  }, { maxSourceLagSeconds: 300, maxDurationMs: 30_000 });
  assert.equal(report.status, "UNHEALTHY");
  assert.ok(report.reasons.includes("source-data-lagging"));
  assert.ok(report.reasons.includes("state-not-persisted"));
});
