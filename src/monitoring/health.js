function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createHealthReport(input, options = {}) {
  const startedMs = Date.parse(input.startedAt ?? new Date().toISOString());
  const finishedMs = Date.parse(input.finishedAt ?? new Date().toISOString());
  const latestSourceMs = number(input.latestSourceTimestampMs, 0);
  const sourceLagSeconds = latestSourceMs ? Math.max(0, (finishedMs - latestSourceMs) / 1000) : null;
  const errorCount = input.errors?.length ?? 0;
  const expected = Math.max(0, number(input.walletsExpected));
  const checked = Math.max(0, number(input.walletsChecked));
  const coverage = expected > 0 ? checked / expected : 1;
  const maxSourceLagSeconds = number(options.maxSourceLagSeconds, 600);
  const maxDurationMs = number(options.maxDurationMs, 50_000);
  const reasons = [];

  if (errorCount > 0) reasons.push("upstream-errors");
  if (coverage < 0.8) reasons.push("wallet-coverage-low");
  if (sourceLagSeconds !== null && sourceLagSeconds > maxSourceLagSeconds) reasons.push("source-data-lagging");
  if (finishedMs - startedMs > maxDurationMs) reasons.push("run-too-slow");
  if (!input.persistenceSucceeded) reasons.push("state-not-persisted");

  const status = reasons.includes("state-not-persisted") || coverage < 0.5
    ? "UNHEALTHY"
    : reasons.length
      ? "DEGRADED"
      : "HEALTHY";

  return {
    status,
    reasons,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
    walletsExpected: expected,
    walletsChecked: checked,
    coverage,
    errorCount,
    sourceLagSeconds,
    signalsGenerated: input.signalsGenerated ?? 0,
    copyCandidates: input.copyCandidates ?? 0,
    persistenceSucceeded: Boolean(input.persistenceSucceeded)
  };
}

export function attachHealth(result, startedAt, options = {}) {
  const latestSourceTimestampMs = Math.max(0, ...(result.signals ?? []).map((signal) =>
    Date.parse(signal.detectedAt) - number(signal.detectionDelaySeconds) * 1000));
  const walletErrors = (result.errors ?? []).filter((error) => error.wallet !== "orderbooks").length;
  const health = createHealthReport({
    startedAt,
    finishedAt: result.observedAt,
    latestSourceTimestampMs,
    walletsExpected: result.walletsChecked,
    walletsChecked: result.walletsChecked - walletErrors,
    errors: result.errors,
    signalsGenerated: result.signals?.length ?? 0,
    copyCandidates: (result.signals ?? []).filter((signal) => signal.decision === "COPY_CANDIDATE").length,
    persistenceSucceeded: options.persistenceSucceeded ?? true
  }, options);

  return {
    ...result,
    health,
    state: {
      ...result.state,
      health,
      lastHealthyAt: health.status === "HEALTHY" ? health.finishedAt : result.state?.lastHealthyAt
    }
  };
}
