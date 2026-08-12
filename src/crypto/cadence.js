function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizedCryptoCadenceMinutes(value, fallback = 15) {
  const requested = Math.max(5, Math.trunc(finite(value, fallback)));
  return Math.ceil(requested / 5) * 5;
}

export function shouldRunCryptoAt(scheduledTime, cadenceMinutes = 15) {
  const timestamp = finite(scheduledTime, Date.now());
  const cadence = normalizedCryptoCadenceMinutes(cadenceMinutes);
  const minuteBucket = Math.floor(timestamp / 60_000);
  return minuteBucket % cadence === 0;
}
