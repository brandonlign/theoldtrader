const DEFAULT_STALE_LAG_MS = 5 * 60_000;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

export function auditBinanceFundingSchedule(records, {
  startMs,
  endMs,
  maximumStaleAnnouncementLagMs = DEFAULT_STALE_LAG_MS
}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Invalid Trial 7 Binance schedule audit window");
  }
  if (!Number.isFinite(maximumStaleAnnouncementLagMs) || maximumStaleAnnouncementLagMs < 0) {
    throw new Error("Invalid Trial 7 Binance stale-announcement tolerance");
  }

  const announced = new Set();
  const actual = new Set();
  const staleScheduleRows = [];
  let contextRows = 0;
  let eventRowsSeen = 0;

  for (const record of records) {
    const recordedAt = Date.parse(record?.recordedAt);
    if (!Number.isFinite(recordedAt) || recordedAt < startMs || recordedAt >= endMs) continue;
    const binance = record?.sources?.binance;
    if (!binance) continue;
    contextRows += 1;

    const nextFundingTime = finite(binance.nextFundingTime, "Binance nextFundingTime");
    if (nextFundingTime < recordedAt - maximumStaleAnnouncementLagMs) {
      staleScheduleRows.push({
        recordedAt: new Date(recordedAt).toISOString(),
        nextFundingTime: new Date(nextFundingTime).toISOString(),
        lagMs: recordedAt - nextFundingTime
      });
    }
    if (nextFundingTime > startMs && nextFundingTime < endMs) announced.add(nextFundingTime);

    for (const event of binance.events ?? []) {
      const time = finite(event.time, "Binance funding event time");
      eventRowsSeen += 1;
      if (time > startMs && time < endMs) actual.add(time);
    }
  }

  const announcedTimes = [...announced].sort((a, b) => a - b);
  const actualTimes = [...actual].sort((a, b) => a - b);
  const missingAnnouncedEvents = announcedTimes.filter((time) => !actual.has(time));
  const unannouncedObservedEvents = actualTimes.filter((time) => !announced.has(time));

  return {
    pass: contextRows > 0 && staleScheduleRows.length === 0 && missingAnnouncedEvents.length === 0,
    sourceMechanism: "Binance premiumIndex.nextFundingTime -> settled fundingRate.fundingTime",
    contextWindow: "startInclusive<=recordedAt<endExclusive",
    maximumStaleAnnouncementLagMs,
    contextRows,
    eventRowsSeen,
    announcedFundingTimes: announcedTimes.map((time) => new Date(time).toISOString()),
    observedFundingTimes: actualTimes.map((time) => new Date(time).toISOString()),
    missingAnnouncedEvents: missingAnnouncedEvents.map((time) => new Date(time).toISOString()),
    unannouncedObservedEvents: unannouncedObservedEvents.map((time) => new Date(time).toISOString()),
    staleScheduleRows
  };
}

export { DEFAULT_STALE_LAG_MS };
