function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWallets(value = []) {
  if (!Array.isArray(value)) throw new Error("Qualified whale wallets must be a JSON array");
  return value.map((item) => typeof item === "string" ? { wallet: item, score: 70 } : item)
    .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(String(item.wallet ?? "")))
    .map((item) => ({ ...item, wallet: String(item.wallet).toLowerCase(), score: numberValue(item.score, 70) }));
}

export function loadWhaleConfig(wallets = []) {
  const normalizedWallets = normalizeWallets(wallets);
  return {
    enabled: normalizedWallets.length > 0,
    dataApiBaseUrl: "https://data-api.polymarket.com",
    clobBaseUrl: "https://clob.polymarket.com",
    requestTimeoutMs: 10_000,
    wallets: normalizedWallets,
    statePath: ".theoldtrader/whale-state.json",
    tradeLookback: 100,
    maxNewTradesPerWallet: 10,
    seenKeyLimit: 500,
    recentSignalLimit: 500,
    bookBatchSize: 100,
    minWhaleTradeUsd: 100,
    minRelativeConviction: 0.5,
    minWalletScore: 60,
    maxDetectionDelaySeconds: 300,
    maxOppositeTurnoverRatio: 0.55,
    copyFraction: 0.02,
    minCopyUsd: 10,
    maxCopyUsd: 100,
    maxPriceDeterioration: 0.02,
    maxEntryPrice: 0.9,
    maxBookAgeMs: 15_000,
    requiredConsensus: 1
  };
}
