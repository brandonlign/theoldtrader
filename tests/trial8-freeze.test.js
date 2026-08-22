import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1,
  TRIAL8_CANONICAL_MANIFEST_PATH,
  TRIAL8_FINAL_PREOBSERVATION_FREEZE_AT,
  gitBlobSha1,
  verifyTrial8CanonicalManifestBytes
} from "../research/crypto/lib/trial8-freeze-identity.js";

const bytes = fs.readFileSync(TRIAL8_CANONICAL_MANIFEST_PATH);
const manifest = JSON.parse(bytes.toString("utf8"));
const recorder = fs.readFileSync("research/crypto/record-bitnomial-carry.mjs", "utf8");
const evaluator = fs.readFileSync("research/crypto/evaluate-bitnomial-carry.mjs", "utf8");

test("Trial 8 exact manifest bytes remain frozen", () => {
  assert.equal(TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1, "3be434dba3c732ee26df471224197466b6b7dbd7");
  assert.equal(TRIAL8_FINAL_PREOBSERVATION_FREEZE_AT, "2026-08-20T02:08:00Z");
  assert.equal(gitBlobSha1(bytes), TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1);
  assert.equal(verifyTrial8CanonicalManifestBytes(bytes), TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1);
});

test("Trial 8 economics, timing and safety remain frozen", () => {
  assert.equal(manifest.experimentId, "bitnomial-carry-v1");
  assert.equal(manifest.trialNumber, 8);
  assert.equal(manifest.paperOnly, true);
  assert.equal(manifest.livePromotionAllowed, false);
  assert.equal(manifest.freeze.firstTrial8EconomicResultObserved, false);
  assert.equal(manifest.forwardWindow.startInclusive, "2026-08-20T03:00:00.000Z");
  assert.equal(manifest.forwardWindow.screeningEndExclusive, "2026-11-18T03:00:00.000Z");
  assert.equal(manifest.forwardWindow.finalEndExclusive, "2027-02-16T03:00:00.000Z");
  assert.equal(manifest.portfolio.targetNotionalPctOfStartingEquityPerLeg, 0.20);
  assert.equal(manifest.portfolio.contractSizeBtc, 0.01);
  assert.equal(manifest.portfolio.maximumActualNotionalPctPerLeg, 0.25);
  assert.equal(manifest.portfolio.rebalancing, false);
  assert.equal(manifest.portfolio.directionSwitching, false);
  assert.equal(manifest.executionModel.coinbaseSpotFeeBpsPerOrder, 60);
  assert.equal(manifest.executionModel.coinbaseSpotExtraSlippageBpsPerOrder, 10);
  assert.equal(manifest.executionModel.bitnomialExchangeClearingFeeUsdPerContractPerSide, 0.10);
  assert.equal(manifest.executionModel.bitnomialExtraSlippageBpsPerOrder, 10);
  assert.equal(manifest.fundingAccounting.nativeIntervalHours, 8);
  assert.deepEqual(manifest.fundingAccounting.intervalsUtc, ["00:00", "08:00", "16:00"]);
  assert.equal(manifest.marginStress.researchMaintenanceMarginPctOfPerpetualNotional, 0.15);
  assert.deepEqual(manifest.marginStress.adverseBasisShockPct, [0.05, 0.10, 0.20]);
  assert.equal(manifest.finalGate.strongestPossibleClassification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
});

test("Trial 8 product identity is funding-first and matches the observed live Bitnomial machine schema", () => {
  assert.equal(manifest.venues.spotLong.tickerEndpoint, "https://api.exchange.coinbase.com/products/BTC-USD/ticker");
  assert.equal(manifest.venues.perpetualShort.productSpecEndpointPrefix, "https://bitnomial.com/exchange/api/v1/prod/product/spec/");
  assert.equal(manifest.venues.perpetualShort.productDataEndpointPrefix, "https://bitnomial.com/exchange/api/v1/prod/product/data/");
  assert.equal(manifest.venues.perpetualShort.fundingEndpoint, "https://bitnomial.com/exchange/api/v1/funding-rates/");
  assert.equal(manifest.venues.perpetualShort.fundingBaseSymbol, "BTCUC");
  assert.equal(manifest.venues.perpetualShort.productCodePrefix, "PBTCUC");
  assert.equal(manifest.venues.perpetualShort.expectedApiType, "perpetual");
  assert.equal(manifest.venues.perpetualShort.contractSizeBtc, 0.01);
  assert.match(manifest.sourceRules.bitnomialProductDiscoveryRule, /type=perpetual/);
  assert.match(manifest.sourceRules.bitnomialProductDiscoveryRule, /PBTCUC/);
  assert.match(recorder, /type === expectedType/);
  assert.match(recorder, /symbol\.startsWith\(expectedPrefix\)/);
  assert.match(evaluator, /raw Bitnomial perpetual machine identity mismatch/);
  assert.equal(manifest.sourceRules.noApiKeysRequired, true);
  assert.equal(manifest.sourceRules.noThirdPartyCandidateData, true);
  assert.equal(manifest.antiLeakage.noOutcomeDrivenRetuning, true);
});
