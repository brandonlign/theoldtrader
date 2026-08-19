import test from "node:test";
import assert from "node:assert/strict";
import { auditBinanceFundingSchedule } from "../research/crypto/lib/binance-funding-schedule-audit.js";

const HOUR = 3_600_000;
const START = Date.parse("2026-08-20T00:00:00Z");
const END = START + 24 * HOUR;

function row(hour, nextFundingHour, events = []) {
  return {
    recordedAt: new Date(START + hour * HOUR + 2 * 60_000).toISOString(),
    sources: {
      binance: {
        nextFundingTime: START + nextFundingHour * HOUR,
        events: events.map((eventHour) => ({ time: START + eventHour * HOUR, rate: 0.0001, markPrice: 100 }))
      }
    }
  };
}

test("announced Binance nextFundingTime events must appear in settled history", () => {
  const records = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const next = hour < 8 ? 8 : hour < 16 ? 16 : 24;
    const events = [];
    if (hour >= 8) events.push(8);
    if (hour >= 16) events.push(16);
    records.push(row(hour, next, events));
  }
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, true);
  assert.deepEqual(audit.announcedFundingTimes, [
    "2026-08-20T08:00:00.000Z",
    "2026-08-20T16:00:00.000Z"
  ]);
  assert.deepEqual(audit.missingAnnouncedEvents, []);
});

test("missing an announced settled event fails regardless of observed gap size", () => {
  const records = [
    row(0, 4),
    row(1, 4),
    row(2, 4),
    row(3, 4),
    row(4, 12),
    row(5, 12),
    row(12, 20, [12]),
    row(20, 28, [12, 20])
  ];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, false);
  assert.deepEqual(audit.missingAnnouncedEvents, ["2026-08-20T04:00:00.000Z"]);
});

test("adjusted non-eight-hour schedule passes when official announced events settle", () => {
  const records = [
    row(0, 4),
    row(1, 4),
    row(2, 4),
    row(3, 4),
    row(4, 8, [4]),
    row(5, 8, [4]),
    row(8, 12, [4, 8]),
    row(12, 16, [4, 8, 12]),
    row(16, 20, [4, 8, 12, 16]),
    row(20, 24, [4, 8, 12, 16, 20])
  ];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, true);
  assert.equal(audit.missingAnnouncedEvents.length, 0);
});

test("stale nextFundingTime context is a provenance failure", () => {
  const records = [{
    recordedAt: new Date(START + 9 * HOUR).toISOString(),
    sources: { binance: { nextFundingTime: START + 8 * HOUR, events: [{ time: START + 8 * HOUR, rate: 0.1, markPrice: 100 }] } }
  }];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, false);
  assert.equal(audit.staleScheduleRows.length, 1);
});
