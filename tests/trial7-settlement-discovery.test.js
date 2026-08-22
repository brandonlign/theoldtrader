import test from "node:test";
import assert from "node:assert/strict";
import { projectLateSettlementsIntoContext } from "../research/crypto/lib/trial7-settlement-discovery.js";

const HOUR = 3_600_000;
const START = Date.parse("2026-08-20T00:00:00Z");
const END = START + 24 * HOUR;

function record(recordedAtMs, { hlEvents = [], bnEvents = [], mark = 100 } = {}) {
  return {
    recordedAt: new Date(recordedAtMs).toISOString(),
    sources: {
      hyperliquid: {
        mark,
        oracle: mark + 1,
        currentFunding: 0.1,
        events: hlEvents,
        hashes: { fundingHistorySha256: "a".repeat(64) }
      },
      binance: {
        mark,
        indexPrice: mark - 1,
        nextFundingTime: END + HOUR,
        events: bnEvents,
        hashes: { fundingHistorySha256: "b".repeat(64) }
      }
    }
  };
}

test("late first-party poll may prove end-boundary settlements without contributing its market context", () => {
  const exit = record(END + 5_000, { mark: 100 });
  const late = record(END + HOUR + 5_000, {
    mark: 999999,
    hlEvents: [{ time: END, rate: 0.01, premium: 0 }],
    bnEvents: [{ time: END, rate: 0.02, markPrice: 101, rateType: "Regular" }]
  });
  const result = projectLateSettlementsIntoContext({
    records: [exit, late],
    startMs: START,
    endMs: END,
    contextToleranceMinutes: 10,
    discoveryLookaheadMinutes: 70
  });
  assert.equal(result.audit.pass, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sources.hyperliquid.mark, 100);
  assert.equal(result.records[0].sources.binance.mark, 100);
  assert.equal(result.records[0].sources.hyperliquid.events[0].time, END);
  assert.equal(result.records[0].sources.binance.events[0].time, END);
  assert.equal(result.audit.postWindowMarketFieldsUsed, false);
  assert.equal(result.audit.appendedHyperliquidEvents, 1);
  assert.equal(result.audit.appendedBinanceEvents, 1);
});

test("post-window funding events are never projected backward", () => {
  const exit = record(END + 5_000);
  const late = record(END + HOUR + 5_000, {
    hlEvents: [{ time: END + HOUR, rate: 999, premium: 0 }],
    bnEvents: [{ time: END + HOUR, rate: 999, markPrice: 999999, rateType: "Regular" }]
  });
  const result = projectLateSettlementsIntoContext({
    records: [exit, late],
    startMs: START,
    endMs: END,
    contextToleranceMinutes: 10,
    discoveryLookaheadMinutes: 70
  });
  assert.equal(result.audit.appendedHyperliquidEvents, 0);
  assert.equal(result.audit.appendedBinanceEvents, 0);
  assert.deepEqual(result.records[0].sources.hyperliquid.events, []);
  assert.deepEqual(result.records[0].sources.binance.events, []);
});

test("late duplicate settlement is not appended when exit poll already contains it", () => {
  const event = { time: END, rate: 0.01, premium: 0 };
  const exit = record(END + 5_000, { hlEvents: [event] });
  const late = record(END + HOUR + 5_000, { hlEvents: [event] });
  const result = projectLateSettlementsIntoContext({
    records: [exit, late],
    startMs: START,
    endMs: END,
    contextToleranceMinutes: 10,
    discoveryLookaheadMinutes: 70
  });
  assert.equal(result.records[0].sources.hyperliquid.events.length, 1);
  assert.equal(result.audit.appendedHyperliquidEvents, 0);
});

test("polls beyond the frozen discovery cutoff cannot contribute settlements", () => {
  const exit = record(END + 5_000);
  const tooLate = record(END + 71 * 60_000, {
    hlEvents: [{ time: END, rate: 0.01, premium: 0 }]
  });
  const result = projectLateSettlementsIntoContext({
    records: [exit, tooLate],
    startMs: START,
    endMs: END,
    contextToleranceMinutes: 10,
    discoveryLookaheadMinutes: 70
  });
  assert.equal(result.audit.lateDiscoveryRows, 0);
  assert.equal(result.audit.appendedHyperliquidEvents, 0);
});
