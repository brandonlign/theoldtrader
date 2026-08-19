import test from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL7_COLLECTION_OFFSET_SECONDS,
  msUntilTrial7Collection
} from "../research/crypto/lib/trial7-collection-schedule.js";

const HOUR = 3_600_000;

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
