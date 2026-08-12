import assert from "node:assert/strict";
import test from "node:test";
import { estimateExitCostPct, estimateRoundTripCostPct, riskSizedNotional } from "../src/crypto/risk.js";

test("round-trip cost includes both fees, both slippage legs, and one spread crossing", () => {
  const cost = estimateRoundTripCostPct({ feeBps: 60, slippageBps: 5, spreadBps: 4 });
  assert.equal(cost, 0.0134);
  assert.equal(estimateExitCostPct({ feeBps: 60, slippageBps: 5, spreadBps: 4 }), 0.0067);
});

test("risk sizing cuts a 20 percent fixed bet down to the stop-risk budget", () => {
  const notional = riskSizedNotional({
    equity: 10_000,
    cash: 10_000,
    openPositionValue: 0,
    stopLossPct: 0.035,
    riskPct: 0.004,
    maxPositionPct: 0.15,
    maxExposurePct: 0.45,
    cashReservePct: 0.25,
    maxTradeUsd: 2_000,
    feeBps: 60
  });
  assert.ok(notional > 1_140 && notional < 1_145);
});

test("risk sizing respects remaining portfolio exposure", () => {
  const notional = riskSizedNotional({
    equity: 10_000,
    cash: 6_000,
    openPositionValue: 4_400,
    stopLossPct: 0.035,
    riskPct: 0.004,
    maxPositionPct: 0.15,
    maxExposurePct: 0.45,
    cashReservePct: 0.25,
    maxTradeUsd: 2_000
  });
  assert.equal(notional, 100);
});
