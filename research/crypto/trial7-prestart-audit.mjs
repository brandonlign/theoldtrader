#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const MANIFEST_PATH = "research/crypto/manifests/cross-venue-funding-v1.json";
const RESULT_DIR = "research/crypto/results/cross-venue-funding-v1";
const COMPACT_PATH = "research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson";
const RAW_PATH = "research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} changed: expected ${expected}, got ${actual}`);
}

function requireNumber(actual, expected, label) {
  if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - expected) > 1e-12) {
    throw new Error(`${label} changed: expected ${expected}, got ${actual}`);
  }
}

const bytes = fs.readFileSync(MANIFEST_PATH);
const manifest = JSON.parse(bytes.toString("utf8"));
const checks = [];
function check(label, fn) {
  fn();
  checks.push(label);
}

check("identity", () => {
  requireEqual(manifest.experimentId, "cross-venue-funding-v1", "experimentId");
  requireNumber(manifest.trialNumber, 7, "trialNumber");
});
check("paper-only safety", () => {
  requireEqual(manifest.paperOnly, true, "paperOnly");
  requireEqual(manifest.livePromotionAllowed, false, "livePromotionAllowed");
  requireEqual(manifest.scientificMode, "forward-only", "scientificMode");
});
check("fixed direction and asset", () => {
  requireEqual(manifest.asset, "BTC", "asset");
  requireEqual(manifest.venues?.long?.venue, "binance-usdm", "long venue");
  requireEqual(manifest.venues?.long?.symbol, "BTCUSDT", "long symbol");
  requireEqual(manifest.venues?.short?.venue, "hyperliquid", "short venue");
  requireEqual(manifest.venues?.short?.coin, "BTC", "short coin");
});
check("frozen forward boundaries", () => {
  requireEqual(manifest.forwardWindow?.startInclusive, "2026-08-20T00:00:00.000Z", "forward start");
  requireEqual(manifest.forwardWindow?.screeningEndExclusive, "2026-11-18T00:00:00.000Z", "screening end");
  requireEqual(manifest.forwardWindow?.finalEndExclusive, "2027-02-16T00:00:00.000Z", "final end");
  requireNumber(manifest.forwardWindow?.minimumRecorderCoverage, 0.98, "minimum first-party context coverage");
});
check("frozen economics", () => {
  requireNumber(manifest.portfolio?.startingEquityUsd, 10000, "starting equity");
  requireNumber(manifest.portfolio?.pairedNotionalPctOfStartingEquityPerLeg, 0.15, "paired notional fraction");
  requireNumber(manifest.portfolio?.collateralReservePctOfStartingEquityPerVenue, 0.20, "collateral reserve fraction");
  requireEqual(manifest.portfolio?.equalBaseUnits, true, "equal base units");
  requireEqual(manifest.portfolio?.rebalancing, false, "rebalancing");
  requireEqual(manifest.portfolio?.directionSwitching, false, "direction switching");
  requireEqual(manifest.portfolio?.assetSelection, false, "asset selection");
  requireEqual(manifest.portfolio?.leverageOptimization, false, "leverage optimization");
  requireNumber(manifest.executionModel?.primaryAllInFrictionBpsPerOrder, 15, "primary friction");
  requireNumber(manifest.executionModel?.stressAllInFrictionBpsPerOrder, 25, "stress friction");
  requireNumber(manifest.executionModel?.ordersInRoundTrip, 4, "orders in round trip");
});
check("native funding semantics", () => {
  requireEqual(manifest.fundingAccounting?.resampleRates, false, "resampleRates");
  requireEqual(manifest.fundingAccounting?.nativeIntervalsOnly, true, "nativeIntervalsOnly");
  requireEqual(manifest.forwardWindow?.fundingAtStartBoundaryEarned, false, "start-boundary funding");
  requireEqual(manifest.forwardWindow?.fundingAtEndBoundaryEarned, false, "end-boundary funding");
});
check("anti-leakage", () => {
  requireEqual(manifest.antiLeakage?.publishedHistoricalEvidenceIsMotivationOnly, true, "published evidence role");
  requireEqual(manifest.antiLeakage?.publishedReplicationPackageMayAuthorizePromotion, false, "published replication promotion");
  requireEqual(manifest.antiLeakage?.TheOldTraderHistoricalBacktestMayAuthorizePromotion, false, "historical backtest promotion");
  requireEqual(manifest.antiLeakage?.screeningResultMayChangeSpecification, false, "screening retuning");
  requireEqual(manifest.antiLeakage?.noOutcomeDrivenRetuning, true, "no outcome retuning");
});
check("no observed Trial 7 result committed", () => {
  if (fs.existsSync(RESULT_DIR)) throw new Error(`Trial 7 result directory already exists: ${RESULT_DIR}`);
});

const compactExists = fs.existsSync(COMPACT_PATH);
const rawExists = fs.existsSync(RAW_PATH);
if (compactExists !== rawExists) {
  throw new Error("Trial 7 forward acquisition is incomplete: compact/raw existence mismatch");
}

const startMs = Date.parse(manifest.forwardWindow.startInclusive);
const nowMs = Date.now();
let phase;
if (nowMs < startMs) phase = "PRE_START";
else if (!compactExists) phase = "WINDOW_OPEN_NO_LOCAL_DATA";
else phase = "WINDOW_OPEN_DATA_PRESENT";

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  experimentId: manifest.experimentId,
  trialNumber: manifest.trialNumber,
  phase,
  manifestSha256: sha256(bytes),
  forwardStart: manifest.forwardWindow.startInclusive,
  screeningEndExclusive: manifest.forwardWindow.screeningEndExclusive,
  finalEndExclusive: manifest.forwardWindow.finalEndExclusive,
  compactAcquisitionPresent: compactExists,
  rawAcquisitionPresent: rawExists,
  candidatePerformanceInspected: false,
  checks
}, null, 2)}\n`);
