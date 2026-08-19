const HOUR_MS = 60 * 60 * 1000;

function acquisitionType(record) {
  return String(record?.acquisition?.type ?? "");
}

export function assessTrial7RecorderHealth(records, {
  manifestSha256,
  nowMs = Date.now(),
  maxAgeMinutes = 130,
  lookbackHours = 24
} = {}) {
  if (!/^[0-9a-f]{64}$/i.test(String(manifestSha256 ?? ""))) {
    throw new Error("Recorder health requires the frozen Trial 7 manifest SHA-256");
  }
  const usable = records
    .filter((record) => record?.experimentId === "cross-venue-funding-v1" && record?.trialNumber === 7)
    .filter((record) => Number.isFinite(Date.parse(record.recordedAt)))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const manifestMismatchRows = usable.filter((record) => record.manifestSha256 !== manifestSha256).length;
  const primary = usable.filter((record) => acquisitionType(record) === "PRIMARY_LIVE" && record.manifestSha256 === manifestSha256);
  const recovered = usable.filter((record) => acquisitionType(record) === "OFFICIAL_RECOVERY" && record.manifestSha256 === manifestSha256);
  const invalidAcquisitionRows = usable.filter((record) => !["PRIMARY_LIVE", "OFFICIAL_RECOVERY"].includes(acquisitionType(record))).length;
  const latestPrimary = primary.at(-1) ?? null;
  const latestPrimaryMs = latestPrimary ? Date.parse(latestPrimary.recordedAt) : null;
  const latestPrimaryAgeMinutes = latestPrimaryMs === null ? null : Math.max(0, (nowMs - latestPrimaryMs) / 60_000);

  const start = nowMs - lookbackHours * HOUR_MS;
  const buckets = new Set(
    primary
      .map((record) => Date.parse(record.recordedAt))
      .filter((time) => time >= start && time <= nowMs)
      .map((time) => Math.floor(time / HOUR_MS))
  );
  const expectedRecentBuckets = Math.max(1, lookbackHours);
  const recentPrimaryCoverage = Math.min(1, buckets.size / expectedRecentBuckets);

  let maxPrimaryGapMinutes = null;
  const recentTimes = primary
    .map((record) => Date.parse(record.recordedAt))
    .filter((time) => time >= start - HOUR_MS && time <= nowMs)
    .sort((a, b) => a - b);
  if (recentTimes.length >= 2) {
    maxPrimaryGapMinutes = Math.max(...recentTimes.slice(1).map((time, index) => (time - recentTimes[index]) / 60_000));
  }

  const status = manifestMismatchRows > 0 || invalidAcquisitionRows > 0
    ? "INVALID_PROVENANCE"
    : latestPrimaryAgeMinutes === null
      ? "NO_PRIMARY_LIVE_DATA"
      : latestPrimaryAgeMinutes > maxAgeMinutes
        ? "STALE_PRIMARY_LIVE_DATA"
        : "HEALTHY";

  return {
    status,
    sealedMonitoringOnly: true,
    candidateValuesExposed: false,
    compactRows: usable.length,
    primaryLiveRows: primary.length,
    officialRecoveryRows: recovered.length,
    manifestMismatchRows,
    invalidAcquisitionRows,
    latestPrimaryRecordedAt: latestPrimary?.recordedAt ?? null,
    latestPrimaryAgeMinutes,
    maxAllowedAgeMinutes: maxAgeMinutes,
    lookbackHours,
    recentPrimaryHourlyBuckets: buckets.size,
    recentPrimaryCoverage,
    maxPrimaryGapMinutes
  };
}
