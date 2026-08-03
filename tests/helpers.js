import { Dec } from "../src/decimal.js";

export const D = (value) => new Dec(value);
export const levels = (values) => values.map(([price, size]) => ({ price: D(price), size: D(size) }));

export function market() {
  return {
    id: "1",
    conditionId: "condition-1",
    question: "Will the test pass?",
    slug: "will-the-test-pass",
    yesTokenId: "yes-token",
    noTokenId: "no-token",
    active: true,
    closed: false,
    acceptingOrders: true,
    negRisk: false,
    feesEnabled: false
  };
}

export function book(assetId, bids, asks, timestampMs = 1_000) {
  return {
    market: "condition-1",
    assetId,
    timestampMs,
    hash: `${assetId}-hash`,
    bids,
    asks,
    minOrderSize: D(1),
    tickSize: D("0.01"),
    negRisk: false
  };
}
