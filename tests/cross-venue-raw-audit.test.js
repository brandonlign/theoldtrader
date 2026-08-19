import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactRecord } from "../research/crypto/lib/cross-venue-record.js";
import { auditCompactAgainstRaw } from "../research/crypto/lib/cross-venue-raw-audit.js";

const MANIFEST_HASH = "f".repeat(64);
const acquisition = { type: "PRIMARY_LIVE", collector: "test" };

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function fixture() {
  const hlMetaText = JSON.stringify([
    { universe: [{ name: "BTC", szDecimals: 5 }] },
    [{ markPx: "100", oraclePx: "101", funding: "0.0001", openInterest: "1" }]
  ]);
  const hlFundingText = JSON.stringify([
    { time: 1000, fundingRate: "0.0002", premium: "0.001" }
  ]);
  const bnPremiumText = JSON.stringify({
    symbol: "BTCUSDT",
    markPrice: "99.5",
    indexPrice: "99.4",
    lastFundingRate: "0.00005",
    nextFundingTime: 2000
  });
  const bnFundingText = JSON.stringify([
    { symbol: "BTCUSDT", fundingTime: 1000, fundingRate: "0.00004", markPrice: "99.6", rateType: "Regular" }
  ]);

  const hashes = {
    hlMeta: hash(hlMetaText),
    hlFunding: hash(hlFundingText),
    bnPremium: hash(bnPremiumText),
    bnFunding: hash(bnFundingText)
  };
  const record = buildCompactRecord({
    manifestSha256: MANIFEST_HASH,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition,
    hyperliquid: {
      mark: 100,
      oracle: 101,
      currentFunding: 0.0001,
      events: [{ time: 1000, rate: 0.0002, premium: 0.001 }],
      hashes: { metaAndAssetCtxsSha256: hashes.hlMeta, fundingHistorySha256: hashes.hlFunding }
    },
    binance: {
      mark: 99.5,
      indexPrice: 99.4,
      lastFundingRate: 0.00005,
      nextFundingTime: 2000,
      events: [{ time: 1000, rate: 0.00004, markPrice: 99.6, rateType: "Regular" }],
      hashes: { premiumIndexSha256: hashes.bnPremium, fundingHistorySha256: hashes.bnFunding }
    }
  });
  const rows = [
    { source: "hyperliquid-metaAndAssetCtxs", sha256: hashes.hlMeta, rawText: hlMetaText },
    { source: "hyperliquid-fundingHistory", sha256: hashes.hlFunding, rawText: hlFundingText },
    { source: "binance-premiumIndex", sha256: hashes.bnPremium, rawText: bnPremiumText },
    { source: "binance-fundingRate", sha256: hashes.bnFunding, rawText: bnFundingText }
  ].map((row) => ({ ...row, acquisition }));
  const rawRowsByHash = new Map();
  for (const row of rows) rawRowsByHash.set(row.sha256, [row]);
  return { record, rawRowsByHash, hashes };
}

test("raw semantic audit independently reproduces every live compact field", () => {
  const { record, rawRowsByHash } = fixture();
  assert.deepEqual(auditCompactAgainstRaw([record], rawRowsByHash), {
    pass: true,
    primaryLiveAudited: 1,
    officialRecoveryAudited: 0,
    compactRowsAudited: 1
  });
});

test("repeated identical raw payload hash is valid across multiple polls", () => {
  const { record, rawRowsByHash, hashes } = fixture();
  const original = rawRowsByHash.get(hashes.bnFunding)[0];
  rawRowsByHash.set(hashes.bnFunding, [
    original,
    { ...original, recordedAt: "2026-08-20T01:02:00Z" },
    { ...original, recordedAt: "2026-08-20T02:02:00Z" }
  ]);
  assert.equal(auditCompactAgainstRaw([record], rawRowsByHash).pass, true);
});

test("raw semantic audit catches a compact oracle mutation despite correct hashes", () => {
  const { record, rawRowsByHash } = fixture();
  record.sources.hyperliquid.oracle = 102;
  assert.throws(() => auditCompactAgainstRaw([record], rawRowsByHash), /Hyperliquid oracle/);
});

test("raw semantic audit catches funding-event mutation despite correct hashes", () => {
  const { record, rawRowsByHash } = fixture();
  record.sources.binance.events[0].rate = 0.5;
  assert.throws(() => auditCompactAgainstRaw([record], rawRowsByHash), /Binance funding rate/);
});

test("official recovery is fail-closed until its source-specific parser is implemented", () => {
  const { record, rawRowsByHash } = fixture();
  record.acquisition = {
    type: "OFFICIAL_RECOVERY",
    provider: "Hyperliquid",
    sourceReference: "s3://hyperliquid-archive/asset_ctxs/20260820.csv.lz4"
  };
  assert.throws(() => auditCompactAgainstRaw([record], rawRowsByHash), /OFFICIAL_RECOVERY semantic adapter not implemented/);
});
