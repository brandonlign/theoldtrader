import test from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL7_COLLECTION_OFFSET_SECONDS,
  msUntilTrial7Collection,
  trial7CriticalBoundaryCatchUp
} from "../research/crypto/lib/trial7-collection-schedule.js";

const HOUR = 3_600_000;
const BOUNDARY = Date.parse("2026-08-20T00:00:00.000Z");

test("Trial 7 context sampling is frozen at five seconds after each UTC hour", () => {
  assert.equal(TRIAL7_COLLECTION_OFFSET_SECONDS, 5);
  const now = new Date("2026-08-20T12:37:11.000Z");
  const wait = msUntilTrial7Collection(now);
  assert.equal(new Date(now.getTime() + wait).toISOString(), "2026-08-20T13:00:05.000Z");
});

test("scheduler advances an hour after the exact collection instant", () => {
  const now = new Date("2026-08-20T12:00:05.000Z");
  assert.equal(msUntilTrial7Collection(now), HOUR);
});

test("scheduler never targets a past instant within the current hour", () => {
  const before = new Date("2026-08-20T12:00:04.500Z");
  assert.equal(msUntilTrial7Collection(before), 500);
  const after = new Date("2026-08-20T12:00:05.500Z");
  assert.equal(new Date(after.getTime() + msUntilTrial7Collection(after)).toISOString(), "2026-08-20T13:00:05.000Z");
});

test("critical boundary catch-up is inactive before the preferred five-second target", () => {
  assert.equal(trial7CriticalBoundaryCatchUp({
    nowMs: BOUNDARY + 4_999,
    boundariesMs: [BOUNDARY],
    toleranceMinutes: 10
  }), null);
});

test("critical boundary catch-up records immediately after a missed preferred target inside tolerance", () => {
  const catchUp = trial7CriticalBoundaryCatchUp({
    nowMs: BOUNDARY + 2 * 60_000,
    boundariesMs: [BOUNDARY],
    toleranceMinutes: 10
  });
  assert.ok(catchUp);
  assert.equal(catchUp.boundaryMs, BOUNDARY);
  assert.equal(catchUp.preferredMs, BOUNDARY + 5_000);
  assert.equal(catchUp.deadlineMs, BOUNDARY + 10 * 60_000);
  assert.equal(catchUp.latenessFromPreferredMs, 115_000);
});

test("critical boundary catch-up remains allowed exactly at the frozen ten-minute deadline", () => {
  assert.ok(trial7CriticalBoundaryCatchUp({
    nowMs: BOUNDARY + 10 * 60_000,
    boundariesMs: [BOUNDARY],
    toleranceMinutes: 10
  }));
});

test("critical boundary catch-up never extends the frozen boundary tolerance", () => {
  assert.equal(trial7CriticalBoundaryCatchUp({
    nowMs: BOUNDARY + 10 * 60_000 + 1,
    boundariesMs: [BOUNDARY],
    toleranceMinutes: 10
  }), null);
});

test("critical boundary catch-up identifies screen/final boundaries independently", () => {
  const screen = BOUNDARY + 90 * 24 * HOUR;
  const final = BOUNDARY + 180 * 24 * HOUR;
  const catchUp = trial7CriticalBoundaryCatchUp({
    nowMs: screen + 30_000,
    boundariesMs: [BOUNDARY, screen, final],
    toleranceMinutes: 10
  });
  assert.equal(catchUp?.boundaryMs, screen);
});
