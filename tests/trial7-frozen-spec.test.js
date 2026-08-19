import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("research/crypto/manifests/cross-venue-funding-v1.json", "utf8"));

test("Trial 7 identity, safety and forward boundaries remain frozen", () => {
  assert.equal(manifest.experimentId, "cross-venue-funding-v1");
  assert.equal(manifest.trialNumber, 7);
  assert.equal(manifest.family, "cross-venue-perpetual-funding-spread");
  assert.equal(manifest.paperOnly, true);
  assert.equal(manifest.livePromotionAllowed, false);
  assert.equal(manifest.scientificMode, "forward-only");
  assert.equal(manifest.freeze.finalImplementationFreezeAt, "2026-08-19T23:04:02Z");
  assert.equal(manifest.forwardWindow.startInclusive, "2026-08-20T00:00:00.000Z");
  assert.equal(manifest.forwardWindow.screeningEndExclusive, "2026-11-18T00:00:00.000Z");
  assert.equal(manifest.forwardWindow.finalEndExclusive, "2027-02-16T00:00:00.000Z");
  assert.equal(manifest.forwardWindow.primaryCollectionOffsetSecondsAfterUtcHour, 5);
  assert.equal(manifest.forwardWindow.minimumRecorderCoverage, 0.98);
  assert.equal(manifest.forwardWindow.maximumSnapshotGapMinutes, 130);
  assert.equal(manifest.forwardWindow.fundingPriceMatchToleranceMinutes, 10);
  assert.equal(manifest.forwardWindow.entryExitPriceMatchToleranceMinutes, 10);
  assert.equal(manifest.forwardWindow.entryExitSelectionRule, "firstValidOfficialObservationAtOrAfterBoundary");
  assert.equal(manifest.forwardWindow.preBoundaryEntryExitContextAllowed, false);
  assert.equal(manifest.forwardWindow.earliestEvaluationDelayMinutesAfterBoundary, 10);
});

test("Trial 7 direction, sizing and no-tuning controls remain frozen", () => {
  assert.equal(manifest.asset, "BTC");
  assert.equal(manifest.venues.long.venue, "binance-usdm");
  assert.equal(manifest.venues.long.symbol, "BTCUSDT");
  assert.equal(manifest.venues.short.venue, "hyperliquid");
  assert.equal(manifest.venues.short.coin, "BTC");
  assert.equal(manifest.portfolio.startingEquityUsd, 10000);
  assert.equal(manifest.portfolio.pairedNotionalPctOfStartingEquityPerLeg, 0.15);
  assert.equal(manifest.portfolio.collateralReservePctOfStartingEquityPerVenue, 0.20);
  assert.equal(manifest.portfolio.equalBaseUnits, true);
  assert.equal(manifest.portfolio.rebalancing, false);
  assert.equal(manifest.portfolio.compounding, false);
  assert.equal(manifest.portfolio.directionSwitching, false);
  assert.equal(manifest.portfolio.fundingThreshold, null);
  assert.equal(manifest.portfolio.assetSelection, false);
  assert.equal(manifest.portfolio.leverageOptimization, false);
});

test("Trial 7 transaction-cost, funding and stress assumptions remain frozen", () => {
  assert.equal(manifest.executionModel.primaryAllInFrictionBpsPerOrder, 15);
  assert.equal(manifest.executionModel.stressAllInFrictionBpsPerOrder, 25);
  assert.equal(manifest.executionModel.ordersInRoundTrip, 4);
  assert.equal(manifest.executionModel.applyFrictionAdverselyToPrice, true);
  assert.equal(manifest.executionModel.breakEvenFrictionMethod, "analyticalLinearFourFillModel");
  assert.equal(manifest.fundingAccounting.resampleRates, false);
  assert.equal(manifest.fundingAccounting.nativeIntervalsOnly, true);
  assert.equal(manifest.forwardWindow.fundingAtStartBoundaryEarned, false);
  assert.equal(manifest.forwardWindow.fundingAtEndBoundaryEarned, true);
  assert.match(manifest.fundingAccounting.boundaryRule, /startBoundary < eventTime <= endBoundary/);
  assert.equal(manifest.marginStress.researchMaintenanceMarginPctOfLegNotional, 0.10);
  assert.deepEqual(manifest.marginStress.crossVenueBasisShockPct, [0.05, 0.10, 0.25]);
});

test("Trial 7 first-party timing and provenance semantics remain frozen", () => {
  assert.equal(manifest.sourceRules.canonicalManifestOnly, true);
  assert.equal(manifest.sourceRules.officialFirstPartyVenueDataOnly, true);
  assert.equal(manifest.sourceRules.candidateEvaluationMayUsePaperCachedData, false);
  assert.equal(manifest.sourceRules.noInterpolation, true);
  assert.equal(manifest.sourceRules.noForwardFill, true);
  assert.equal(manifest.sourceRules.noOutcomeSelectedSubperiods, true);
  assert.equal(manifest.sourceRules.hyperliquidFundingTimestampNormalization.maximumAbsoluteSkewMs, 60000);
  assert.match(manifest.sourceRules.compactRawTimestampBinding, /exact recordedAt/);
  assert.match(manifest.sourceRules.binanceFundingScheduleAudit.rule, /nextFundingTime/);
  assert.equal(manifest.sourceRules.binanceFundingScheduleAudit.maximumStaleAnnouncementLagMs, 300000);
  assert.match(manifest.sourceRules.hyperliquidFundingOracleRule, /at or after/);
  assert.match(manifest.sourceRules.binanceDirectionalComparatorRule, /at or after/);
});

test("Trial 7 risk-stat and consistency definitions remain frozen", () => {
  assert.equal(manifest.riskStatistics.maxDrawdownStart, "preEntryStartingEquity");
  assert.equal(manifest.riskStatistics.dailyReturnGrid, "fixed24hFromFrozenStartWithFinalExitAtWindowEnd");
  assert.equal(manifest.riskStatistics.sharpeAnnualizationDays, 365);
  assert.equal(manifest.riskStatistics.sortinoTargetReturn, 0);
  assert.equal(manifest.riskStatistics.sortinoDownsideDeviation, "sqrt(mean(min(dailyReturn-target,0)^2))");
  assert.equal(manifest.riskStatistics.consistencyWindows.count, 3);
  assert.equal(manifest.riskStatistics.consistencyWindows.durationDays, 60);
  assert.equal(manifest.riskStatistics.consistencyWindows.entryFrictionChargedInWindow, 1);
  assert.equal(manifest.riskStatistics.consistencyWindows.exitFrictionChargedInWindow, 3);
  assert.equal(manifest.riskStatistics.consistencyWindows.telescopeToFullFinalPnl, true);
  assert.match(manifest.priceAccounting.decompositionRule, /rawCrossVenueBasisPnl/);
});

test("Trial 7 evidence and promotion ceiling remain frozen", () => {
  assert.equal(manifest.screeningGate.afterDays, 90);
  assert.equal(manifest.finalGate.afterDays, 180);
  assert.equal(manifest.finalGate.automaticLivePromotion, false);
  assert.equal(manifest.finalGate.strongestPossibleClassification, "PROMOTION_ELIGIBLE_RESEARCH_ONLY");
  assert.equal(manifest.antiLeakage.publishedHistoricalEvidenceIsMotivationOnly, true);
  assert.equal(manifest.antiLeakage.publishedReplicationPackageMayAuthorizePromotion, false);
  assert.equal(manifest.antiLeakage.TheOldTraderHistoricalBacktestMayAuthorizePromotion, false);
  assert.equal(manifest.antiLeakage.screeningResultMayChangeSpecification, false);
  assert.equal(manifest.antiLeakage.noOutcomeDrivenRetuning, true);
});
