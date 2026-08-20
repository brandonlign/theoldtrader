function eventKey(event) {
  return [event.productId, event.intervalStart, event.intervalEnd, event.markPrice, event.priceIndex, event.fundingRate, event.interestRate].join("|");
}

export function projectLateFundingIntoContext({ records, startMs, endMs, contextToleranceMinutes, discoveryLookaheadMinutes }) {
  if (!Array.isArray(records)) throw new Error("Trial 9 funding discovery requires records");
  const contextCutoff = endMs + Number(contextToleranceMinutes) * 60_000;
  const discoveryCutoff = endMs + Number(discoveryLookaheadMinutes) * 60_000;
  if (![startMs, endMs, contextCutoff, discoveryCutoff].every(Number.isFinite) || discoveryCutoff < contextCutoff) throw new Error("Invalid Trial 9 funding-discovery window");

  const relevant = records
    .filter((record) => {
      const t = Date.parse(record.recordedAt);
      return Number.isFinite(t) && t >= startMs && t <= discoveryCutoff;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const context = relevant
    .filter((record) => Date.parse(record.recordedAt) <= contextCutoff)
    .map((record) => structuredClone(record));
  const late = relevant.filter((record) => Date.parse(record.recordedAt) > contextCutoff);
  const carrier = context.filter((record) => Date.parse(record.recordedAt) >= endMs).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0] ?? context.at(-1) ?? null;

  const existing = new Set((carrier?.sources?.perpetual?.fundingEvents ?? []).map(eventKey));
  const appended = [];
  const provenance = [];
  for (const record of late) {
    for (const event of record.sources?.perpetual?.fundingEvents ?? []) {
      const eventEnd = Date.parse(event.intervalEnd);
      if (!(eventEnd > startMs && eventEnd <= endMs)) continue;
      const key = eventKey(event);
      if (existing.has(key)) continue;
      existing.add(key);
      appended.push(structuredClone(event));
      provenance.push({
        intervalEnd: event.intervalEnd,
        sourceRecordedAt: record.recordedAt,
        fundingHistorySha256: record.sources?.perpetual?.hashes?.funding ?? null
      });
    }
  }
  if (appended.length && !carrier) throw new Error("Trial 9 late funding exists but no in-window context carrier is available");
  if (carrier && appended.length) {
    carrier.sources.perpetual.fundingEvents = [...(carrier.sources.perpetual.fundingEvents ?? []), ...appended]
      .sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
  }
  return {
    records: context,
    audit: {
      pass: true,
      contextCutoff: new Date(contextCutoff).toISOString(),
      discoveryCutoff: new Date(discoveryCutoff).toISOString(),
      contextRows: context.length,
      lateDiscoveryRows: late.length,
      appendedFundingEvents: appended.length,
      carrierRecordedAt: carrier?.recordedAt ?? null,
      provenance,
      lateBooksUsed: false,
      lateProductDataUsed: false,
      rule: "Rows after the exit-context tolerance may contribute only funding events whose intervalEnd is inside the frozen position window; all later book/product values are discarded from economics."
    }
  };
}
