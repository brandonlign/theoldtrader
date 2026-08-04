import assert from "node:assert/strict";
import test from "node:test";
import { allocateHero } from "../src/hero-allocator.js";

const portfolio = { startingCash: 10_000, cash: 10_000 };

test("prioritizes structural arbitrage and caps whale allocation", () => {
  const result = allocateHero({
    portfolio,
    candidates: [
      { id: "whale", strategy: "WHALE_COPY", asset: "a", estimatedCost: 500, decision: "COPY_CANDIDATE", walletScore: 82, walkForward: { eligible: true, forwardRoi: 0.12, profitableFoldRate: 0.8 }, detectionDelaySeconds: 20, slippageBps: 20, availableLiquidityUsd: 5000, price: 0.55 },
      { id: "binary", strategy: "BINARY_COMPLETE_SET", conditionId: "b", capitalRequired: 500, netProfit: 3, roiBps: 60 },
      { id: "multi", strategy: "MULTI_OUTCOME_COMPLETE_SET", eventId: "m", capitalRequired: 500, netProfit: 4, roiBps: 80, stable: true }
    ]
  });
  assert.deepEqual(result.decisions.map((d) => d.id), ["multi", "binary", "whale"]);
  assert.equal(result.decisions[0].selected, true);
  assert.equal(result.decisions[1].selected, true);
  assert.equal(result.decisions[2].selected, true);
  assert.ok(result.decisions[2].allocatedCapital <= 75);
  assert.ok(result.structuralAllocated > result.whaleAllocated);
});

test("rejects whales without walk-forward evidence", () => {
  const result = allocateHero({
    portfolio,
    candidates: [{ id: "w", strategy: "WHALE_COPY", asset: "a", estimatedCost: 50, decision: "COPY_CANDIDATE", walletScore: 90, detectionDelaySeconds: 10, slippageBps: 10, availableLiquidityUsd: 500, price: 0.5 }]
  });
  assert.equal(result.decisions[0].selected, false);
  assert.ok(result.decisions[0].reasons.includes("walk-forward-not-eligible"));
});

test("blocks duplicate and concentrated opportunities", () => {
  const candidate = { id: "x", strategy: "BINARY_COMPLETE_SET", conditionId: "same", direction: "BUY_AND_MERGE", capitalRequired: 100, netProfit: 1, roiBps: 40 };
  const first = allocateHero({ portfolio, candidates: [candidate] });
  const second = allocateHero({ portfolio, candidates: [candidate], executedKeys: [first.decisions[0].duplicateKey] });
  assert.equal(second.decisions[0].selected, false);
  assert.ok(second.decisions[0].reasons.includes("duplicate-opportunity"));
});

test("preserves cash reserve through run budget", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    id: `a${index}`,
    strategy: "BINARY_COMPLETE_SET",
    conditionId: `m${index}`,
    capitalRequired: 500,
    netProfit: 10,
    roiBps: 100
  }));
  const result = allocateHero({ portfolio, candidates });
  assert.ok(result.structuralAllocated + result.whaleAllocated <= 1200 + 1e-9);
});
