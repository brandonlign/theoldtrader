const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TOLERANCE_MS = 60_000;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function sameOptionalNumber(left, right, tolerance = 1e-15) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(Number(left) - Number(right)) <= tolerance * Math.max(1, Math.abs(Number(left)), Math.abs(Number(right)));
}

export function normalizeHyperliquidFundingTimes(records, {
  toleranceMs = DEFAULT_TOLERANCE_MS
} = {}) {
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error("Invalid Hyperliquid funding timestamp tolerance");

  const normalizedRecords = records.map((record) => ({
    ...record,
    sources: {
      ...record.sources,
      hyperliquid: {
        ...record.sources?.hyperliquid,
        events: [...(record.sources?.hyperliquid?.events ?? [])].map((event) => ({ ...event }))
      }
    }
  }));

  const boundaryState = new Map();
  const observedRawEvents = new Map();
  let maxAbsoluteSkewMs = 0;
  const normalizedEventRows = [];

  for (const record of normalizedRecords) {
    for (const event of record.sources?.hyperliquid?.events ?? []) {
      const rawTime = finite(event.time, "Hyperliquid raw funding timestamp");
      const rate = finite(event.rate, "Hyperliquid funding rate");
      const premium = event.premium == null ? null : finite(event.premium, "Hyperliquid funding premium");
      const boundary = Math.round(rawTime / HOUR_MS) * HOUR_MS;
      const skewMs = rawTime - boundary;
      const absoluteSkewMs = Math.abs(skewMs);
      maxAbsoluteSkewMs = Math.max(maxAbsoluteSkewMs, absoluteSkewMs);
      if (absoluteSkewMs > toleranceMs) {
        throw new Error(
          `Hyperliquid funding timestamp ${new Date(rawTime).toISOString()} exceeds frozen ±${toleranceMs} ms hourly tolerance`
        );
      }

      const rawKey = `${rawTime}`;
      const priorRaw = observedRawEvents.get(rawKey);
      if (priorRaw) {
        if (Math.abs(priorRaw.rate - rate) > 1e-15 || !sameOptionalNumber(priorRaw.premium, premium)) {
          throw new Error(`Conflicting duplicate Hyperliquid raw funding event at ${new Date(rawTime).toISOString()}`);
        }
      } else {
        observedRawEvents.set(rawKey, { rate, premium });
      }

      const priorBoundary = boundaryState.get(boundary);
      if (priorBoundary) {
        if (priorBoundary.rawTime !== rawTime) {
          throw new Error(
            `Hyperliquid funding timestamp collision: ${new Date(priorBoundary.rawTime).toISOString()} and ${new Date(rawTime).toISOString()} both map to ${new Date(boundary).toISOString()}`
          );
        }
        if (Math.abs(priorBoundary.rate - rate) > 1e-15 || !sameOptionalNumber(priorBoundary.premium, premium)) {
          throw new Error(`Conflicting Hyperliquid event values at normalized boundary ${new Date(boundary).toISOString()}`);
        }
      } else {
        boundaryState.set(boundary, { rawTime, rate, premium, skewMs });
        normalizedEventRows.push({
          rawTime,
          rawTimestamp: new Date(rawTime).toISOString(),
          normalizedTime: boundary,
          normalizedTimestamp: new Date(boundary).toISOString(),
          skewMs,
          rate,
          premium
        });
      }

      event.rawTime = rawTime;
      event.rawTimestampSkewMs = skewMs;
      event.time = boundary;
    }
  }

  normalizedEventRows.sort((a, b) => a.normalizedTime - b.normalizedTime);
  return {
    records: normalizedRecords,
    audit: {
      pass: true,
      toleranceMs,
      rawDistinctFundingEvents: observedRawEvents.size,
      normalizedDistinctFundingEvents: boundaryState.size,
      maxAbsoluteSkewMs,
      events: normalizedEventRows
    }
  };
}

export { HOUR_MS, DEFAULT_TOLERANCE_MS };
