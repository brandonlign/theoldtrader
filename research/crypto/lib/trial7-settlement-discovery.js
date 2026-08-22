function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function sourceHash(record, venue) {
  return venue === "hyperliquid"
    ? String(record.sources?.hyperliquid?.hashes?.fundingHistorySha256 ?? "")
    : String(record.sources?.binance?.hashes?.fundingHistorySha256 ?? "");
}

function eventKey(event, venue) {
  const time = finite(event.time, `${venue} settlement event time`);
  const rate = finite(event.rate, `${venue} settlement event rate`);
  if (venue === "binance") {
    const mark = finite(event.markPrice, "Binance settlement event markPrice");
    return `${time}|${rate}|${mark}|${event.rateType ?? ""}`;
  }
  return `${time}|${rate}|${event.premium ?? ""}`;
}

function appendUnique(target, events, venue) {
  const existing = new Set((target ?? []).map((event) => eventKey(event, venue)));
  const appended = [];
  for (const event of events) {
    const key = eventKey(event, venue);
    if (existing.has(key)) continue;
    existing.add(key);
    target.push(structuredClone(event));
    appended.push(event);
  }
  return appended;
}

export function projectLateSettlementsIntoContext({
  records,
  startMs,
  endMs,
  contextToleranceMinutes,
  discoveryLookaheadMinutes
}) {
  if (!Array.isArray(records)) throw new Error("Trial 7 settlement discovery requires records");
  if (![startMs, endMs].every(Number.isFinite) || endMs <= startMs) throw new Error("Invalid Trial 7 settlement discovery window");
  if (!Number.isFinite(contextToleranceMinutes) || contextToleranceMinutes <= 0) throw new Error("Invalid Trial 7 context tolerance");
  if (!Number.isFinite(discoveryLookaheadMinutes) || discoveryLookaheadMinutes < contextToleranceMinutes) {
    throw new Error("Trial 7 settlement-discovery lookahead must be at least the context tolerance");
  }

  const contextCutoffMs = endMs + contextToleranceMinutes * 60_000;
  const discoveryCutoffMs = endMs + discoveryLookaheadMinutes * 60_000;
  const eligible = records
    .filter((record) => {
      const time = Date.parse(record?.recordedAt);
      return Number.isFinite(time) && time >= startMs && time <= discoveryCutoffMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const contextRecords = eligible
    .filter((record) => Date.parse(record.recordedAt) <= contextCutoffMs)
    .map((record) => structuredClone(record));
  const lateRecords = eligible.filter((record) => Date.parse(record.recordedAt) > contextCutoffMs);

  const carrier = contextRecords
    .filter((record) => Date.parse(record.recordedAt) >= endMs)
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0]
    ?? contextRecords.at(-1)
    ?? null;

  const projected = { hyperliquid: [], binance: [] };
  const provenance = { hyperliquid: [], binance: [] };

  for (const record of lateRecords) {
    const sourceRecordedAt = record.recordedAt;
    for (const event of record.sources?.hyperliquid?.events ?? []) {
      const eventTime = finite(event.time, "Hyperliquid discovery event time");
      if (!(eventTime > startMs && eventTime <= endMs)) continue;
      projected.hyperliquid.push(event);
      provenance.hyperliquid.push({
        eventTime: new Date(eventTime).toISOString(),
        sourceRecordedAt,
        sourceFundingHistorySha256: sourceHash(record, "hyperliquid")
      });
    }
    for (const event of record.sources?.binance?.events ?? []) {
      const eventTime = finite(event.time, "Binance discovery event time");
      if (!(eventTime > startMs && eventTime <= endMs)) continue;
      projected.binance.push(event);
      provenance.binance.push({
        eventTime: new Date(eventTime).toISOString(),
        sourceRecordedAt,
        sourceFundingHistorySha256: sourceHash(record, "binance")
      });
    }
  }

  let appendedHyperliquid = [];
  let appendedBinance = [];
  if (carrier) {
    carrier.sources.hyperliquid.events ??= [];
    carrier.sources.binance.events ??= [];
    appendedHyperliquid = appendUnique(carrier.sources.hyperliquid.events, projected.hyperliquid, "hyperliquid");
    appendedBinance = appendUnique(carrier.sources.binance.events, projected.binance, "binance");
  }

  return {
    records: contextRecords,
    audit: {
      pass: Boolean(carrier) || (projected.hyperliquid.length === 0 && projected.binance.length === 0),
      contextCutoff: new Date(contextCutoffMs).toISOString(),
      settlementDiscoveryCutoff: new Date(discoveryCutoffMs).toISOString(),
      contextRows: contextRecords.length,
      lateDiscoveryRows: lateRecords.length,
      carrierRecordedAt: carrier?.recordedAt ?? null,
      projectedHyperliquidEventsFound: projected.hyperliquid.length,
      projectedBinanceEventsFound: projected.binance.length,
      appendedHyperliquidEvents: appendedHyperliquid.length,
      appendedBinanceEvents: appendedBinance.length,
      provenance,
      postWindowMarketFieldsUsed: false,
      rule: "Late rows contribute only funding-history events with startBoundary < eventTime <= endBoundary; their marks, oracle, indexPrice, current funding and nextFundingTime are excluded from the core evaluation view."
    }
  };
}
