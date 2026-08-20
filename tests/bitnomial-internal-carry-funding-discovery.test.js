import test from "node:test";
import assert from "node:assert/strict";
import { projectLateFundingIntoContext } from "../research/crypto/lib/bitnomial-internal-carry-funding-discovery.js";

const START = Date.parse("2026-01-01T00:00:00Z");
const END = START + 7 * 24 * 60 * 60 * 1000;
const HASH = "a".repeat(64);

function record(time, fundingEvents = [], marker = 100) {
  return {
    recordedAt: new Date(time).toISOString(),
    sources: {
      spot: { book: { midpointUsd: marker } },
      perpetual: { book: { midpointUsd: marker }, fundingEvents, hashes: { funding: HASH } }
    }
  };
}

const event = {
  productId: 5614,
  markPrice: 100000,
  priceIndex: 100000,
  fundingRate: 0.0001,
  interestRate: 0,
  intervalStart: new Date(END - 8 * 60 * 60 * 1000).toISOString(),
  intervalEnd: new Date(END).toISOString()
};

test("late history poll may prove an end-boundary funding settlement without importing its book", () => {
  const exit = record(END + 15_000, [], 100);
  const late = record(END + 60 * 60 * 1000 + 15_000, [event], 999999);
  const result = projectLateFundingIntoContext({ records: [exit, late], startMs: START, endMs: END, contextToleranceMinutes: 10, discoveryLookaheadMinutes: 70 });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sources.spot.book.midpointUsd, 100);
  assert.equal(result.records[0].sources.perpetual.book.midpointUsd, 100);
  assert.equal(result.records[0].sources.perpetual.fundingEvents.length, 1);
  assert.equal(result.audit.appendedFundingEvents, 1);
  assert.equal(result.audit.lateBooksUsed, false);
  assert.equal(result.audit.provenance[0].fundingHistorySha256, HASH);
});

test("post-window funding event cannot be projected backward", () => {
  const exit = record(END + 15_000);
  const post = { ...event, intervalStart: event.intervalEnd, intervalEnd: new Date(END + 8 * 60 * 60 * 1000).toISOString() };
  const late = record(END + 60 * 60 * 1000, [post]);
  const result = projectLateFundingIntoContext({ records: [exit, late], startMs: START, endMs: END, contextToleranceMinutes: 10, discoveryLookaheadMinutes: 70 });
  assert.equal(result.audit.appendedFundingEvents, 0);
});

test("rows beyond the frozen discovery cutoff are ignored", () => {
  const exit = record(END + 15_000);
  const tooLate = record(END + 71 * 60_000, [event]);
  const result = projectLateFundingIntoContext({ records: [exit, tooLate], startMs: START, endMs: END, contextToleranceMinutes: 10, discoveryLookaheadMinutes: 70 });
  assert.equal(result.audit.lateDiscoveryRows, 0);
  assert.equal(result.audit.appendedFundingEvents, 0);
});
