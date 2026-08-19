import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionMetadata,
  buildCompactRecord,
  buildRawEnvelopeRows
} from "../research/crypto/lib/cross-venue-record.js";

const H = "a".repeat(64);

function venues() {
  return {
    hyperliquid: {
      mark: 100,
      oracle: 100.1,
      currentFunding: 0.00001,
      events: [],
      hashes: { metaAndAssetCtxsSha256: H, fundingHistorySha256: H }
    },
    binance: {
      mark: 99.9,
      indexPrice: 99.8,
      lastFundingRate: 0.000005,
      nextFundingTime: 123456789,
      events: [],
      hashes: { premiumIndexSha256: H, fundingHistorySha256: H }
    }
  };
}

test("PRIMARY_LIVE record contract is explicit and stable", () => {
  const source = venues();
  const record = buildCompactRecord({
    manifestSha256: H,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition: { type: "PRIMARY_LIVE", collector: "trial7-worker-v1" },
    ...source,
    collectionLatencyMs: 123
  });
  assert.equal(record.experimentId, "cross-venue-funding-v1");
  assert.equal(record.trialNumber, 7);
  assert.deepEqual(record.acquisition, { type: "PRIMARY_LIVE", collector: "trial7-worker-v1" });
  assert.equal(record.sources.binance.indexPrice, 99.8);
});

test("OFFICIAL_RECOVERY requires first-party source provenance", () => {
  assert.throws(() => acquisitionMetadata("OFFICIAL_RECOVERY", { provider: "Hyperliquid" }), /sourceReference/);
  assert.deepEqual(
    acquisitionMetadata("OFFICIAL_RECOVERY", {
      provider: "Hyperliquid",
      sourceReference: "s3://hyperliquid-archive/asset_ctxs/20260820.csv.lz4"
    }),
    {
      type: "OFFICIAL_RECOVERY",
      provider: "Hyperliquid",
      sourceReference: "s3://hyperliquid-archive/asset_ctxs/20260820.csv.lz4",
      recoveryMethod: "official-first-party-history"
    }
  );
});

test("raw envelope and compact record preserve identical acquisition identity", () => {
  const acquisition = { type: "PRIMARY_LIVE", collector: "trial7-worker-v1" };
  const raw = buildRawEnvelopeRows({
    manifestSha256: H,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition,
    rawRows: [{ source: "x", sha256: H, rawText: "{}" }]
  });
  assert.equal(raw.length, 1);
  assert.deepEqual(raw[0].acquisition, acquisition);
  assert.equal(raw[0].manifestSha256, H);
});

test("raw caller cannot override protected scientific envelope fields", () => {
  const raw = buildRawEnvelopeRows({
    manifestSha256: H,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition: { type: "PRIMARY_LIVE", collector: "trial7-worker-v1" },
    rawRows: [{
      source: "x",
      sha256: H,
      rawText: "{}",
      schema: "evil",
      manifestSha256: "b".repeat(64),
      recordedAt: "2099-01-01T00:00:00Z",
      acquisition: { type: "OFFICIAL_RECOVERY", provider: "evil", sourceReference: "evil" }
    }]
  });
  assert.equal(raw[0].schema, "theoldtrader-cross-venue-funding-v1-raw-v1");
  assert.equal(raw[0].manifestSha256, H);
  assert.equal(raw[0].recordedAt, "2026-08-20T00:02:00.000Z");
  assert.deepEqual(raw[0].acquisition, { type: "PRIMARY_LIVE", collector: "trial7-worker-v1" });
});

test("record contract fails closed on missing price or invalid hash", () => {
  const source = venues();
  source.hyperliquid.oracle = null;
  assert.throws(() => buildCompactRecord({
    manifestSha256: H,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition: { type: "PRIMARY_LIVE", collector: "x" },
    ...source
  }), /Hyperliquid oracle/);

  const good = venues();
  good.binance.hashes.premiumIndexSha256 = "bad";
  assert.throws(() => buildCompactRecord({
    manifestSha256: H,
    recordedAt: "2026-08-20T00:02:00Z",
    acquisition: { type: "PRIMARY_LIVE", collector: "x" },
    ...good
  }), /SHA-256/);
});
