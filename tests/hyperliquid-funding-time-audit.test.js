import test from "node:test";
import assert from "node:assert/strict";
import {
  HOUR_MS,
  normalizeHyperliquidFundingTimes
} from "../research/crypto/lib/hyperliquid-funding-time-audit.js";

const BASE = Date.parse("2026-08-20T01:00:00.000Z");

function record(events) {
  return {
    recordedAt: "2026-08-20T01:00:05.000Z",
    sources: {
      hyperliquid: { events },
      binance: { events: [] }
    }
  };
}

test("exact-hour Hyperliquid funding timestamp remains unchanged", () => {
  const input = [record([{ time: BASE, rate: 0.0001, premium: 0.001 }])];
  const result = normalizeHyperliquidFundingTimes(input);
  assert.equal(result.records[0].sources.hyperliquid.events[0].time, BASE);
  assert.equal(result.records[0].sources.hyperliquid.events[0].rawTime, BASE);
  assert.equal(result.records[0].sources.hyperliquid.events[0].rawTimestampSkewMs, 0);
  assert.equal(result.audit.maxAbsoluteSkewMs, 0);
});

test("millisecond and sub-minute skew normalize to nearest UTC hour while preserving raw time", () => {
  const raw = BASE + 30_123;
  const input = [record([{ time: raw, rate: 0.0001, premium: 0.001 }])];
  const result = normalizeHyperliquidFundingTimes(input, { toleranceMs: 60_000 });
  const event = result.records[0].sources.hyperliquid.events[0];
  assert.equal(event.time, BASE);
  assert.equal(event.rawTime, raw);
  assert.equal(event.rawTimestampSkewMs, 30_123);
  assert.equal(result.audit.maxAbsoluteSkewMs, 30_123);
});

test("negative skew within tolerance maps forward to the nearest hour", () => {
  const raw = BASE - 45_000;
  const result = normalizeHyperliquidFundingTimes([record([{ time: raw, rate: 0.0001, premium: null }])]);
  assert.equal(result.records[0].sources.hyperliquid.events[0].time, BASE);
  assert.equal(result.records[0].sources.hyperliquid.events[0].rawTimestampSkewMs, -45_000);
});

test("Hyperliquid funding timestamp beyond frozen ±60 seconds is rejected", () => {
  const raw = BASE + 60_001;
  assert.throws(
    () => normalizeHyperliquidFundingTimes([record([{ time: raw, rate: 0.0001, premium: null }])]),
    /exceeds frozen/
  );
});

test("two distinct raw timestamps cannot collide on one normalized hour", () => {
  const input = [record([
    { time: BASE - 10_000, rate: 0.0001, premium: 0.001 },
    { time: BASE + 10_000, rate: 0.0001, premium: 0.001 }
  ])];
  assert.throws(() => normalizeHyperliquidFundingTimes(input), /collision/);
});

test("repeated identical raw event from overlapping history is allowed and normalizes once", () => {
  const raw = BASE + 500;
  const input = [
    record([{ time: raw, rate: 0.0001, premium: 0.001 }]),
    {
      recordedAt: "2026-08-20T02:00:05.000Z",
      sources: {
        hyperliquid: { events: [{ time: raw, rate: 0.0001, premium: 0.001 }] },
        binance: { events: [] }
      }
    }
  ];
  const result = normalizeHyperliquidFundingTimes(input);
  assert.equal(result.audit.rawDistinctFundingEvents, 1);
  assert.equal(result.audit.normalizedDistinctFundingEvents, 1);
  assert.equal(result.records[0].sources.hyperliquid.events[0].time, BASE);
  assert.equal(result.records[1].sources.hyperliquid.events[0].time, BASE);
});

test("nearest-hour mapping is deterministic around half-hour boundaries", () => {
  const raw = BASE + Math.floor(HOUR_MS / 2);
  assert.throws(
    () => normalizeHyperliquidFundingTimes([record([{ time: raw, rate: 0.0001, premium: null }])]),
    /exceeds frozen/
  );
});
