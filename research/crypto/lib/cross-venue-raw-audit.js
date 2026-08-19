function numeric(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

function closeEnough(left, right, label, tolerance = 1e-12) {
  const a = numeric(left, `${label} compact`);
  const b = numeric(right, `${label} raw`);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  if (Math.abs(a - b) > tolerance * scale) {
    throw new Error(`Trial 7 raw semantic mismatch for ${label}: compact=${a} raw=${b}`);
  }
}

function rawRowsFor(hash, type, rawRowsByHash) {
  return (rawRowsByHash.get(String(hash).toLowerCase()) ?? []).filter((row) => row.acquisition?.type === type);
}

function sourcePayload(hash, type, source, recordedAt, rawRowsByHash) {
  const rows = rawRowsFor(hash, type, rawRowsByHash)
    .filter((row) => row.source === source)
    .filter((row) => row.recordedAt === recordedAt);
  if (!rows.length) {
    throw new Error(
      `Trial 7 expected ${source} raw payload for ${type}/${hash} at compact timestamp ${recordedAt}, found 0`
    );
  }
  const canonical = String(rows[0].rawText ?? "");
  for (const row of rows.slice(1)) {
    if (String(row.rawText ?? "") !== canonical) {
      throw new Error(`Trial 7 identical hash ${hash} resolved to non-identical ${source} raw payload bytes`);
    }
  }
  return rows[0];
}

function normalizedHyperliquidFunding(rawJson) {
  if (!Array.isArray(rawJson)) throw new Error("Hyperliquid fundingHistory raw payload is not an array");
  return rawJson
    .map((row) => ({
      time: numeric(row.time, "Hyperliquid raw funding time"),
      rate: numeric(row.fundingRate, "Hyperliquid raw funding rate"),
      premium: row.premium == null ? null : numeric(row.premium, "Hyperliquid raw funding premium")
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizedBinanceFunding(rawJson) {
  if (!Array.isArray(rawJson)) throw new Error("Binance fundingRate raw payload is not an array");
  return rawJson
    .map((row) => ({
      time: numeric(row.fundingTime, "Binance raw funding time"),
      rate: numeric(row.fundingRate, "Binance raw funding rate"),
      markPrice: numeric(row.markPrice, "Binance raw funding markPrice"),
      rateType: row.rateType ?? null
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizedCompactEvents(events, venue) {
  if (!Array.isArray(events)) throw new Error(`${venue} compact events are not an array`);
  return [...events].map((row) => {
    if (venue === "Hyperliquid") {
      return {
        time: numeric(row.time, "Hyperliquid compact funding time"),
        rate: numeric(row.rate, "Hyperliquid compact funding rate"),
        premium: row.premium == null ? null : numeric(row.premium, "Hyperliquid compact funding premium")
      };
    }
    return {
      time: numeric(row.time, "Binance compact funding time"),
      rate: numeric(row.rate, "Binance compact funding rate"),
      markPrice: numeric(row.markPrice, "Binance compact funding markPrice"),
      rateType: row.rateType ?? null
    };
  }).sort((a, b) => a.time - b.time);
}

function compareEvents(compact, raw, venue) {
  if (compact.length !== raw.length) {
    throw new Error(`Trial 7 ${venue} funding event count mismatch: compact=${compact.length} raw=${raw.length}`);
  }
  for (let index = 0; index < compact.length; index += 1) {
    const a = compact[index];
    const b = raw[index];
    if (a.time !== b.time) throw new Error(`Trial 7 ${venue} funding timestamp mismatch at index ${index}`);
    closeEnough(a.rate, b.rate, `${venue} funding rate[${index}]`);
    if (venue === "Hyperliquid") {
      if (a.premium === null || b.premium === null) {
        if (a.premium !== b.premium) throw new Error(`Trial 7 Hyperliquid premium nullability mismatch at index ${index}`);
      } else closeEnough(a.premium, b.premium, `Hyperliquid funding premium[${index}]`);
    } else {
      closeEnough(a.markPrice, b.markPrice, `Binance funding markPrice[${index}]`);
      if (String(a.rateType ?? "") !== String(b.rateType ?? "")) {
        throw new Error(`Trial 7 Binance funding rateType mismatch at index ${index}`);
      }
    }
  }
}

function auditPrimaryLive(record, rawRowsByHash) {
  const hl = record.sources.hyperliquid;
  const bn = record.sources.binance;
  const type = "PRIMARY_LIVE";
  const recordedAt = record.recordedAt;

  const hlContextRaw = sourcePayload(
    hl.hashes.metaAndAssetCtxsSha256,
    type,
    "hyperliquid-metaAndAssetCtxs",
    recordedAt,
    rawRowsByHash
  );
  const hlFundingRaw = sourcePayload(
    hl.hashes.fundingHistorySha256,
    type,
    "hyperliquid-fundingHistory",
    recordedAt,
    rawRowsByHash
  );
  const bnPremiumRaw = sourcePayload(
    bn.hashes.premiumIndexSha256,
    type,
    "binance-premiumIndex",
    recordedAt,
    rawRowsByHash
  );
  const bnFundingRaw = sourcePayload(
    bn.hashes.fundingHistorySha256,
    type,
    "binance-fundingRate",
    recordedAt,
    rawRowsByHash
  );

  const hlContextJson = JSON.parse(hlContextRaw.rawText);
  if (!Array.isArray(hlContextJson) || hlContextJson.length !== 2) {
    throw new Error("Unexpected raw Hyperliquid metaAndAssetCtxs shape during semantic audit");
  }
  const [meta, contexts] = hlContextJson;
  const btcIndex = meta?.universe?.findIndex((asset) => asset?.name === "BTC");
  if (!Number.isInteger(btcIndex) || btcIndex < 0 || !contexts?.[btcIndex]) {
    throw new Error("BTC missing from raw Hyperliquid asset context during semantic audit");
  }
  const rawHl = contexts[btcIndex];
  closeEnough(hl.mark, rawHl.markPx, "Hyperliquid mark");
  closeEnough(hl.oracle, rawHl.oraclePx, "Hyperliquid oracle");
  closeEnough(hl.currentFunding, rawHl.funding, "Hyperliquid current funding");
  compareEvents(
    normalizedCompactEvents(hl.events, "Hyperliquid"),
    normalizedHyperliquidFunding(JSON.parse(hlFundingRaw.rawText)),
    "Hyperliquid"
  );

  const rawBn = JSON.parse(bnPremiumRaw.rawText);
  closeEnough(bn.mark, rawBn.markPrice, "Binance mark");
  closeEnough(bn.indexPrice, rawBn.indexPrice, "Binance indexPrice");
  closeEnough(bn.lastFundingRate, rawBn.lastFundingRate, "Binance last funding rate");
  if (numeric(bn.nextFundingTime, "Binance compact next funding time") !== numeric(rawBn.nextFundingTime, "Binance raw next funding time")) {
    throw new Error("Trial 7 raw semantic mismatch for Binance next funding time");
  }
  compareEvents(
    normalizedCompactEvents(bn.events, "Binance"),
    normalizedBinanceFunding(JSON.parse(bnFundingRaw.rawText)),
    "Binance"
  );
}

export function auditCompactAgainstRaw(records, rawRowsByHash) {
  let primaryLiveAudited = 0;
  let officialRecoveryAudited = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const type = record?.acquisition?.type;
    if (type === "PRIMARY_LIVE") {
      auditPrimaryLive(record, rawRowsByHash);
      primaryLiveAudited += 1;
      continue;
    }
    if (type === "OFFICIAL_RECOVERY") {
      // Recovery is intentionally fail-closed until a source-specific first-party parser
      // is implemented and tested for the exact official archive/API source named by the record.
      throw new Error(
        `Trial 7 OFFICIAL_RECOVERY semantic adapter not implemented for compact row ${index + 1}; recovery data cannot score the strategy yet`
      );
    }
    throw new Error(`Invalid Trial 7 acquisition type during semantic audit at compact row ${index + 1}`);
  }
  return {
    pass: true,
    primaryLiveAudited,
    officialRecoveryAudited,
    compactRowsAudited: records.length
  };
}
