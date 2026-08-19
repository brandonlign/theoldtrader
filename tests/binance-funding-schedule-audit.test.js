import test from "node:test";
import assert from "node:assert/strict";
import { auditBinanceFundingSchedule } from "../research/crypto/lib/binance-funding-schedule-audit.js";

const HOUR = 3_600_000;
const START = Date.parse("2026-08-20T00:00:00Z");
const END = START + 24 * HOUR;

function row(hour, nextFundingHour, events = [], minuteOffset = 2) {
  return {
    recordedAt: new Date(START + hour * HOUR + minuteOffset * 60_000).toISOString(),
    sources: {
      binance: {
        nextFundingTime: START + nextFundingHour * HOUR,
        events: events.map((eventHour) => ({ time: START + eventHour * HOUR, rate: 0.0001, markPrice: 100 }))
      }
    }
  };
}

function exitRow(events = [24]) {
  return {
    recordedAt: new Date(END + 2 * 60_000).toISOString(),
    sources: {
      binance: {
        nextFundingTime: END + 8 * HOUR,
        events: events.map((eventHour) => ({ time: START + eventHour * HOUR, rate: 0.0001, markPrice: 100 }))
      }
    }
  };
}

test("announced Binance nextFundingTime events through the exit boundary must settle", () => {
  const records = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const next = hour < 8 ? 8 : hour < 16 ? 16 : 24;
    const events = [];
    if (hour >= 8) events.push(8);
    if (hour >= 16) events.push(16);
    records.push(row(hour, next, events));
  }
  records.push(exitRow([8, 16, 24]));
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, true);
  assert.deepEqual(audit.announcedFundingTimes, [
    "2026-08-20T08:00:00.000Z",
    "2026-08-20T16:00:00.000Z",
    "2026-08-21T00:00:00.000Z"
  ]);
  assert.deepEqual(audit.missingAnnouncedEvents, []);
});

test("missing an announced settled event fails regardless of observed gap size", () => {
  const records = [
    row(0, 4), row(1, 4), row(2, 4), row(3, 4), row(4, 12), row(5, 12),
    row(12, 20, [12]), row(20, 24, [12, 20]), exitRow([12, 20, 24])
  ];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, false);
  assert.deepEqual(audit.missingAnnouncedEvents, ["2026-08-20T04:00:00.000Z"]);
});

test("adjusted non-eight-hour schedule passes when official announced events settle", () => {
  const records = [
    row(0, 4), row(1, 4), row(2, 4), row(3, 4), row(4, 8, [4]), row(5, 8, [4]),
    row(8, 12, [4, 8]), row(12, 16, [4, 8, 12]), row(16, 20, [4, 8, 12, 16]),
    row(20, 24, [4, 8, 12, 16, 20]), exitRow([4, 8, 12, 16, 20, 24])
  ];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, true);
  assert.equal(audit.missingAnnouncedEvents.length, 0);
});

test("end-boundary announcement fails if the post-boundary exit poll does not contain the settlement", () => {
  const records = [row(16, 24, [16]), row(23, 24, [16]), exitRow([16])];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, false);
  assert.deepEqual(audit.missingAnnouncedEvents, ["2026-08-21T00:00:00.000Z"]);
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

test("post-boundary contexts do not create new announcements, but may carry settled history", () => {
  const records = [
    row(0, 8), row(8, 16, [8]), row(16, 24, [8, 16]),
    exitRow([8, 16, 24]),
    {
      recordedAt: new Date(END + HOUR).toISOString(),
      sources: { binance: { nextFundingTime: END - HOUR, events: [] } }
    }
  ];
  const audit = auditBinanceFundingSchedule(records, { startMs: START, endMs: END });
  assert.equal(audit.pass, true);
  assert.equal(audit.staleScheduleRows.length, 0);
  assert.equal(audit.contextRows, 3);
});
