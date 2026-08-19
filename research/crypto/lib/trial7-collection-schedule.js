export const TRIAL7_COLLECTION_OFFSET_SECONDS = 5;

export function msUntilTrial7Collection(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(0, TRIAL7_COLLECTION_OFFSET_SECONDS, 0);
  if (next <= now) {
    next.setUTCHours(next.getUTCHours() + 1, 0, TRIAL7_COLLECTION_OFFSET_SECONDS, 0);
  }
  return next.getTime() - now.getTime();
}

export function trial7CriticalBoundaryCatchUp({
  nowMs = Date.now(),
  boundariesMs,
  toleranceMinutes,
  offsetSeconds = TRIAL7_COLLECTION_OFFSET_SECONDS
}) {
  if (!Array.isArray(boundariesMs) || boundariesMs.some((value) => !Number.isFinite(value))) {
    throw new Error("Trial 7 critical-boundary catch-up requires finite boundary timestamps");
  }
  if (!Number.isFinite(toleranceMinutes) || toleranceMinutes <= 0) {
    throw new Error("Trial 7 critical-boundary catch-up requires a positive tolerance");
  }
  const toleranceMs = toleranceMinutes * 60_000;
  const offsetMs = offsetSeconds * 1000;
  for (const boundaryMs of [...boundariesMs].sort((a, b) => a - b)) {
    const preferredMs = boundaryMs + offsetMs;
    const deadlineMs = boundaryMs + toleranceMs;
    if (nowMs >= preferredMs && nowMs <= deadlineMs) {
      return {
        boundaryMs,
        preferredMs,
        deadlineMs,
        latenessFromPreferredMs: nowMs - preferredMs
      };
    }
  }
  return null;
}
