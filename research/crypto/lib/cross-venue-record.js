const COMPACT_SCHEMA = "theoldtrader-cross-venue-funding-v1-record-v2";
const RAW_SCHEMA = "theoldtrader-cross-venue-funding-v1-raw-v1";
const TYPES = new Set(["PRIMARY_LIVE", "OFFICIAL_RECOVERY"]);

function positive(value, label) {
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function hash(value, label) {
  const text = String(value ?? "");
  if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error(`Invalid ${label} SHA-256`);
  return text.toLowerCase();
}

export function acquisitionMetadata(type, details = {}) {
  if (!TYPES.has(type)) throw new Error(`Invalid Trial 7 acquisition type: ${type}`);
  if (type === "PRIMARY_LIVE") {
    const collector = String(details.collector ?? "").trim();
    if (!collector) throw new Error("PRIMARY_LIVE acquisition requires collector");
    return { type, collector };
  }
  const provider = String(details.provider ?? "").trim();
  const sourceReference = String(details.sourceReference ?? "").trim();
  if (!provider || !sourceReference) {
    throw new Error("OFFICIAL_RECOVERY acquisition requires provider and sourceReference");
  }
  return {
    type,
    provider,
    sourceReference,
    recoveryMethod: String(details.recoveryMethod ?? "official-first-party-history")
  };
}

export function validateVenuePayloads(hyperliquid, binance) {
  const hl = {
    mark: positive(hyperliquid?.mark, "Hyperliquid mark"),
    oracle: positive(hyperliquid?.oracle, "Hyperliquid oracle"),
    currentFunding: finite(hyperliquid?.currentFunding, "Hyperliquid current funding"),
    events: Array.isArray(hyperliquid?.events) ? hyperliquid.events : [],
    hashes: {
      metaAndAssetCtxsSha256: hash(hyperliquid?.hashes?.metaAndAssetCtxsSha256, "Hyperliquid asset-context"),
      fundingHistorySha256: hash(hyperliquid?.hashes?.fundingHistorySha256, "Hyperliquid funding-history")
    }
  };
  const bn = {
    mark: positive(binance?.mark, "Binance mark"),
    indexPrice: positive(binance?.indexPrice, "Binance indexPrice"),
    lastFundingRate: finite(binance?.lastFundingRate, "Binance last funding rate"),
    nextFundingTime: finite(binance?.nextFundingTime, "Binance next funding time"),
    events: Array.isArray(binance?.events) ? binance.events : [],
    hashes: {
      premiumIndexSha256: hash(binance?.hashes?.premiumIndexSha256, "Binance premium-index"),
      fundingHistorySha256: hash(binance?.hashes?.fundingHistorySha256, "Binance funding-history")
    }
  };
  return { hyperliquid: hl, binance: bn };
}

export function buildCompactRecord({
  manifestSha256,
  recordedAt,
  acquisition,
  hyperliquid,
  binance,
  collectionLatencyMs = null
}) {
  const timestamp = new Date(recordedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid Trial 7 recordedAt");
  const manifestHash = hash(manifestSha256, "manifest");
  const normalizedAcquisition = acquisitionMetadata(acquisition?.type, acquisition ?? {});
  const sources = validateVenuePayloads(hyperliquid, binance);
  return {
    schema: COMPACT_SCHEMA,
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    manifestSha256: manifestHash,
    acquisition: normalizedAcquisition,
    recordedAt: timestamp.toISOString(),
    collectionLatencyMs: collectionLatencyMs === null ? null : finite(collectionLatencyMs, "collection latency"),
    sources
  };
}

export function buildRawEnvelopeRows({ manifestSha256, recordedAt, acquisition, rawRows }) {
  const timestamp = new Date(recordedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid Trial 7 raw recordedAt");
  const manifestHash = hash(manifestSha256, "manifest");
  const normalizedAcquisition = acquisitionMetadata(acquisition?.type, acquisition ?? {});
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error("Trial 7 raw envelope requires rows");
  return rawRows.map((row) => ({
    schema: RAW_SCHEMA,
    recordedAt: timestamp.toISOString(),
    manifestSha256: manifestHash,
    acquisition: normalizedAcquisition,
    ...row
  }));
}

export { COMPACT_SCHEMA, RAW_SCHEMA };
