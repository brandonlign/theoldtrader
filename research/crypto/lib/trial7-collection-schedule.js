export const TRIAL7_COLLECTION_OFFSET_SECONDS = 5;

export function msUntilTrial7Collection(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(0, TRIAL7_COLLECTION_OFFSET_SECONDS, 0);
  if (next <= now) {
    next.setUTCHours(next.getUTCHours() + 1, 0, TRIAL7_COLLECTION_OFFSET_SECONDS, 0);
  }
  return next.getTime() - now.getTime();
}
