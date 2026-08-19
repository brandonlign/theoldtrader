import { auditBinanceFundingSchedule } from "./binance-funding-schedule-audit.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ACQUISITION_TYPES = new Set(["PRIMARY_LIVE", "OFFICIAL_RECOVERY"]);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (!(number > 0)) throw new Error(`Non-positive ${label}`);
  return number;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1));
}

function acquisitionType(record) {
  const type = String(record?.acquisition?.type ?? "");
  if (!ACQUISITION_TYPES.has(type)) throw new Error(`Invalid Trial 7 acquisition type: ${type || "missing"}`);
  return type;
}

function shouldReplaceHourlyRecord(prior, candidate) {
  if (!prior) return true;
  const priorType = acquisitionType(prior);
  const candidateType = acquisitionType(candidate);
  if (priorType !== candidateType) return candidateType === "PRIMARY_LIVE";
  return Date.parse(candidate.recordedAt) < Date.parse(prior.recordedAt);
}

function uniqueByHour(records, startMs, endMs) {
  const byHour = new Map();
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!Number.isFinite(time) || time < startMs || time >= endMs) continue;
    const bucket = Math.floor(time / HOUR_MS) * HOUR_MS;
    const prior = byHour.get(bucket);
    if (shouldReplaceHourlyRecord(prior, record)) byHour.set(bucket, record);
  }
  return [...byHour.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}

function firstRecordAtOrAfter(records, targetMs, toleranceMs) {
  let best = null;
  let bestTime = Infinity;
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!Number.isFinite(time) || time < targetMs || time - targetMs > toleranceMs) continue;
    if (time < bestTime) {
      best = record;
      bestTime = time;
    } else if (time === bestTime && best && acquisitionType(best) !== acquisitionType(record)) {
      if (acquisitionType(record) === "PRIMARY_LIVE") best = record;
    }
  }
  return best;
}

function verifyRecordIdentity(record, manifestHash) {
  if (record.schema !== "theoldtrader-cross-venue-funding-v1-record-v2") throw new Error("Unexpected Trial 7 compact-record schema");
  if (record.experimentId !== "cross-venue-funding-v1" || record.trialNumber !== 7) throw new Error("Unexpected Trial 7 compact-record identity");
  if (record.manifestSha256 !== manifestHash) throw new Error("Trial 7 manifest hash changed during acquisition");
  acquisitionType(record);
  const hl = record.sources?.hyperliquid;
  const bn = record.sources?.binance;
  positive(hl?.mark, "Hyperliquid mark");
  positive(hl?.oracle, "Hyperliquid oracle");
  finite(hl?.currentFunding, "Hyperliquid current funding");
  positive(bn?.mark, "Binance mark");
  positive(bn?.indexPrice, "Binance indexPrice");
  finite(bn?.lastFundingRate, "Binance last funding rate");
  finite(bn?.nextFundingTime, "Binance next funding time");
  const hashes = [
    hl?.hashes?.metaAndAssetCtxsSha256,
    hl?.hashes?.fundingHistorySha256,
    bn?.hashes?.premiumIndexSha256,
    bn?.hashes?.fundingHistorySha256
  ];
  if (hashes.some((hash) => !/^[0-9a-f]{64}$/i.test(String(hash ?? "")))) {
    throw new Error("Trial 7 compact record has an invalid raw-response hash");
  }
}

export function requiredRawHashes(records) {
  const hashes = new Set();
  for (const record of records) {
    const hl = record.sources?.hyperliquid;
    const bn = record.sources?.binance;
    for (const value of [
      hl?.hashes?.metaAndAssetCtxsSha256,
      hl?.hashes?.fundingHistorySha256,
      bn?.hashes?.premiumIndexSha256,
      bn?.hashes?.fundingHistorySha256
    ]) if (value) hashes.add(String(value));
  }
  return hashes;
}

export function verifyRawHashCoverage(records, availableRawHashes) {
  const required = requiredRawHashes(records);
  const missing = [...required].filter((hash) => !availableRawHashes.has(hash));
  return { pass: missing.length === 0, required: required.size, available: availableRawHashes.size, missing };
}

function insertEvent(map, event, label) {
  const time = finite(event.time, `${label} funding time`);
  const rate = finite(event.rate, `${label} funding rate`);
  const prior = map.get(time);
  if (prior) {
    if (Math.abs(prior.rate - rate) > 1e-15) throw new Error(`Conflicting ${label} funding rate at ${new Date(time).toISOString()}`);
    if (label === "Binance") {
      const markPrice = positive(event.markPrice, "Binance funding markPrice");
      if (Math.abs(prior.markPrice - markPrice) > 1e-8 * Math.max(prior.markPrice, markPrice)) {
        throw new Error(`Conflicting Binance funding markPrice at ${new Date(time).toISOString()}`);
      }
    }
    return;
  }
  if (label === "Binance") map.set(time, { time, rate, markPrice: positive(event.markPrice, "Binance funding markPrice") });
  else map.set(time, { time, rate });
}

function collectFundingEvents(records, startMs, endMs) {
  const hyperliquid = new Map();
  const binance = new Map();
  for (const record of records) {
    for (const event of record.sources?.hyperliquid?.events ?? []) {
      const time = Number(event.time);
      if (time > startMs && time < endMs) insertEvent(hyperliquid, event, "Hyperliquid");
    }
    for (const event of record.sources?.binance?.events ?? []) {
      const time = Number(event.time);
      if (time > startMs && time < endMs) insertEvent(binance, event, "Binance");
    }
  }
  return {
    hyperliquid: [...hyperliquid.values()].sort((a, b) => a.time - b.time),
    binance: [...binance.values()].sort((a, b) => a.time - b.time)
  };
}

function hyperliquidFundingCoverage(events, startMs, endMs) {
  const expected = Math.max(0, Math.round((endMs - startMs) / HOUR_MS) - 1);
  const times = new Set(events.map((event) => event.time));
  const missing = [];
  for (let time = startMs + HOUR_MS; time < endMs; time += HOUR_MS) if (!times.has(time)) missing.push(time);
  return {
    expectedHyperliquid: expected,
    observedHyperliquid: events.length,
    missingHyperliquid: missing,
    hyperliquidPass: missing.length === 0
  };
}

function matchHyperliquidFunding(events, records, toleranceMs) {
  return events.map((event) => {
    const record = firstRecordAtOrAfter(records, event.time, toleranceMs);
    if (!record) return { ...event, oracle: null, matchedRecordAt: null, matchedAcquisitionType: null, matchDistanceMs: null };
    const time = Date.parse(record.recordedAt);
    return {
      ...event,
      oracle: positive(record.sources.hyperliquid.oracle, "matched Hyperliquid oracle"),
      matchedRecordAt: record.recordedAt,
      matchedAcquisitionType: acquisitionType(record),
      matchDistanceMs: time - event.time
    };
  });
}

function fill(price, side, frictionBps) {
  const adverse = frictionBps / 10_000;
  return price * (1 + (side === "buy" ? 1 : -1) * adverse);
}

function cumulativeFundingAt(time, events, quantity, venue) {
  let total = 0;
  for (const event of events) {
    if (event.time > time) break;
    total += venue === "hyperliquid"
      ? quantity * event.oracle * event.rate
      : -quantity * event.markPrice * event.rate;
  }
  return total;
}

function fundingTotals(events, quantity) {
  const hyperliquid = events.hyperliquid.reduce((sum, event) => sum + quantity * event.oracle * event.rate, 0);
  const binance = events.binance.reduce((sum, event) => sum - quantity * event.markPrice * event.rate, 0);
  return { hyperliquid, binance, net: hyperliquid + binance };
}

function maxDrawdown(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const point of [...series].sort((a, b) => a.time - b.time)) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.min(worst, point.equity / peak - 1);
  }
  return worst;
}

function firstEquityAtOrAfter(series, targetMs, toleranceMs) {
  let best = null;
  for (const point of series) {
    if (point.time < targetMs || point.time - targetMs > toleranceMs) continue;
    if (!best || point.time < best.time) best = point;
  }
  return best;
}

function fixedDailyReturns(series, startingEquity, startMs, endMs, toleranceMs) {
  const returns = [];
  let previousEquity = startingEquity;
  for (let boundary = startMs + DAY_MS; boundary <= endMs; boundary += DAY_MS) {
    const point = firstEquityAtOrAfter(series, boundary, boundary === endMs ? 0 : toleranceMs);
    if (!point) throw new Error(`Missing fixed daily equity observation at ${new Date(boundary).toISOString()}`);
    returns.push(point.equity / previousEquity - 1);
    previousEquity = point.equity;
  }
  return returns;
}

function returnStats(series, startingEquity, startMs, endMs, toleranceMs, annualizationDays = 365) {
  const returns = fixedDailyReturns(series, startingEquity, startMs, endMs, toleranceMs);
  const sd = stdev(returns);
  const target = 0;
  const downsideDeviation = returns.length
    ? Math.sqrt(mean(returns.map((value) => Math.min(value - target, 0) ** 2)))
    : 0;
  const finalEquity = series.at(-1)?.equity ?? startingEquity;
  const netReturn = finalEquity / startingEquity - 1;
  const elapsedDays = (endMs - startMs) / DAY_MS;
  return {
    finalEquity,
    netReturn,
    annualizedReturn: (1 + netReturn) ** (annualizationDays / elapsedDays) - 1,
    sharpe: sd > 0 ? Math.sqrt(annualizationDays) * mean(returns) / sd : 0,
    sortino: downsideDeviation > 0 ? Math.sqrt(annualizationDays) * mean(returns) / downsideDeviation : 0,
    sortinoTargetReturn: target,
    downsideDeviation,
    dailyObservations: returns.length,
    maxDrawdown: maxDrawdown(series)
  };
}

function marginState({ record, quantity, longEntryFill, shortEntryFill, funding, collateral, marginPct }) {
  const time = Date.parse(record.recordedAt);
  const bnMark = positive(record.sources.binance.mark, "Binance mark path");
  const hlMark = positive(record.sources.hyperliquid.mark, "Hyperliquid mark path");
  const bnFunding = cumulativeFundingAt(time, funding.binance, quantity, "binance");
  const hlFunding = cumulativeFundingAt(time, funding.hyperliquid, quantity, "hyperliquid");
  const bnPricePnl = quantity * (bnMark - longEntryFill);
  const hlPricePnl = quantity * (shortEntryFill - hlMark);
  const bnVenueEquity = collateral + bnPricePnl + bnFunding;
  const hlVenueEquity = collateral + hlPricePnl + hlFunding;
  const bnMaintenance = quantity * bnMark * marginPct;
  const hlMaintenance = quantity * hlMark * marginPct;
  return {
    time,
    timestamp: record.recordedAt,
    acquisitionType: acquisitionType(record),
    bnMark,
    hlMark,
    bnFunding,
    hlFunding,
    bnPricePnl,
    hlPricePnl,
    binanceExcess: bnVenueEquity - bnMaintenance,
    hyperliquidExcess: hlVenueEquity - hlMaintenance
  };
}

function buildScenario({ records, funding, manifest, entryRecord, exitRecord, startMs, endMs, frictionBps }) {
  const startingEquity = manifest.portfolio.startingEquityUsd;
  const pairedNotional = startingEquity * manifest.portfolio.pairedNotionalPctOfStartingEquityPerLeg;
  const entryBinanceMark = positive(entryRecord.sources.binance.mark, "entry Binance mark");
  const entryHyperliquidMark = positive(entryRecord.sources.hyperliquid.mark, "entry Hyperliquid mark");
  const exitBinanceMark = positive(exitRecord.sources.binance.mark, "exit Binance mark");
  const exitHyperliquidMark = positive(exitRecord.sources.hyperliquid.mark, "exit Hyperliquid mark");
  const quantity = pairedNotional / ((entryBinanceMark + entryHyperliquidMark) / 2);

  const longEntryFill = fill(entryBinanceMark, "buy", frictionBps);
  const shortEntryFill = fill(entryHyperliquidMark, "sell", frictionBps);
  const longExitFill = fill(exitBinanceMark, "sell", frictionBps);
  const shortExitFill = fill(exitHyperliquidMark, "buy", frictionBps);

  const fundingPnl = fundingTotals(funding, quantity);
  const binanceRawBasisPnl = quantity * (exitBinanceMark - entryBinanceMark);
  const hyperliquidRawBasisPnl = quantity * (entryHyperliquidMark - exitHyperliquidMark);
  const rawBasisPnl = binanceRawBasisPnl + hyperliquidRawBasisPnl;
  const longPricePnlAfterFriction = quantity * (longExitFill - longEntryFill);
  const shortPricePnlAfterFriction = quantity * (shortEntryFill - shortExitFill);
  const combinedBasisAfterFriction = longPricePnlAfterFriction + shortPricePnlAfterFriction;
  const entryFrictionUsd = quantity * ((longEntryFill - entryBinanceMark) + (entryHyperliquidMark - shortEntryFill));
  const exitFrictionUsd = quantity * ((exitBinanceMark - longExitFill) + (shortExitFill - exitHyperliquidMark));
  const totalFrictionUsd = entryFrictionUsd + exitFrictionUsd;
  const grossPnlBeforeFriction = fundingPnl.net + rawBasisPnl;
  const netPnl = grossPnlBeforeFriction - totalFrictionUsd;

  const marginPct = manifest.marginStress.researchMaintenanceMarginPctOfLegNotional;
  const collateral = startingEquity * manifest.portfolio.collateralReservePctOfStartingEquityPerVenue;
  let observedMarginBreach = null;
  const stressState = Object.fromEntries(manifest.marginStress.crossVenueBasisShockPct.map((shock) => [String(shock), {
    breached: false,
    minBinanceExcess: Infinity,
    minHyperliquidExcess: Infinity
  }]));
  const equitySeries = [{ time: startMs, equity: startingEquity, phase: "pre-entry" }];
  const marginSeries = [];
  const pathRecords = [...records];
  if (!pathRecords.some((record) => record.recordedAt === exitRecord.recordedAt)) pathRecords.push(exitRecord);
  pathRecords.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  for (const record of pathRecords) {
    const state = marginState({ record, quantity, longEntryFill, shortEntryFill, funding, collateral, marginPct });
    if (!observedMarginBreach && (state.binanceExcess < 0 || state.hyperliquidExcess < 0)) {
      observedMarginBreach = {
        timestamp: state.timestamp,
        venue: state.binanceExcess < 0 ? "binance" : "hyperliquid",
        binanceExcess: state.binanceExcess,
        hyperliquidExcess: state.hyperliquidExcess
      };
    }
    for (const shock of manifest.marginStress.crossVenueBasisShockPct) {
      const stressedBnMark = state.bnMark * (1 - shock / 2);
      const stressedHlMark = state.hlMark * (1 + shock / 2);
      const stressedBnEquity = collateral + quantity * (stressedBnMark - longEntryFill) + state.bnFunding;
      const stressedHlEquity = collateral + quantity * (shortEntryFill - stressedHlMark) + state.hlFunding;
      const stressedBnExcess = stressedBnEquity - quantity * stressedBnMark * marginPct;
      const stressedHlExcess = stressedHlEquity - quantity * stressedHlMark * marginPct;
      const stress = stressState[String(shock)];
      stress.minBinanceExcess = Math.min(stress.minBinanceExcess, stressedBnExcess);
      stress.minHyperliquidExcess = Math.min(stress.minHyperliquidExcess, stressedHlExcess);
      if (stressedBnExcess < 0 || stressedHlExcess < 0) stress.breached = true;
    }
    marginSeries.push({
      time: state.time,
      timestamp: state.timestamp,
      acquisitionType: state.acquisitionType,
      binanceExcess: state.binanceExcess,
      hyperliquidExcess: state.hyperliquidExcess,
      binanceFunding: state.bnFunding,
      hyperliquidFunding: state.hlFunding
    });
    if (state.time < endMs) {
      equitySeries.push({
        time: state.time,
        equity: startingEquity + state.bnPricePnl + state.hlPricePnl + state.bnFunding + state.hlFunding,
        phase: "open"
      });
    }
  }

  equitySeries.push({ time: endMs, equity: startingEquity + netPnl, phase: "post-exit" });
  equitySeries.sort((a, b) => a.time - b.time);
  const toleranceMs = manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000;
  const stats = returnStats(
    equitySeries,
    startingEquity,
    startMs,
    endMs,
    toleranceMs,
    manifest.riskStatistics?.sharpeAnnualizationDays ?? 365
  );

  return {
    frictionBpsPerOrder: frictionBps,
    quantity,
    pairedNotional,
    entry: {
      timestamp: entryRecord.recordedAt,
      delayFromBoundaryMs: Date.parse(entryRecord.recordedAt) - startMs,
      binanceMark: entryBinanceMark,
      hyperliquidMark: entryHyperliquidMark,
      binanceFill: longEntryFill,
      hyperliquidFill: shortEntryFill,
      acquisitionType: acquisitionType(entryRecord)
    },
    exit: {
      timestamp: exitRecord.recordedAt,
      delayFromBoundaryMs: Date.parse(exitRecord.recordedAt) - endMs,
      binanceMark: exitBinanceMark,
      hyperliquidMark: exitHyperliquidMark,
      binanceFill: longExitFill,
      hyperliquidFill: shortExitFill,
      acquisitionType: acquisitionType(exitRecord)
    },
    fundingPnl,
    pricePnl: {
      binanceRawBasis: binanceRawBasisPnl,
      hyperliquidRawBasis: hyperliquidRawBasisPnl,
      combinedBasisBeforeFriction: rawBasisPnl,
      binanceLongAfterFriction: longPricePnlAfterFriction,
      hyperliquidShortAfterFriction: shortPricePnlAfterFriction,
      combinedBasisAfterFriction
    },
    grossPnlBeforeFriction,
    executionFriction: { entryUsd: entryFrictionUsd, exitUsd: exitFrictionUsd, totalUsd: totalFrictionUsd },
    netPnl,
    stats,
    margin: {
      observedBreach: observedMarginBreach,
      stress: stressState,
      allFrozenStressesPass: Object.values(stressState).every((state) => !state.breached)
    },
    equitySeries,
    marginSeries
  };
}

function indexComparator(entryRecord, exitRecord, manifest, frictionBps, startMs, endMs) {
  const startingEquity = manifest.portfolio.startingEquityUsd;
  const notional = startingEquity * manifest.portfolio.pairedNotionalPctOfStartingEquityPerLeg;
  const entry = positive(entryRecord.sources.binance.indexPrice, "entry Binance indexPrice");
  const exit = positive(exitRecord.sources.binance.indexPrice, "exit Binance indexPrice");
  const buyFill = fill(entry, "buy", frictionBps);
  const quantity = notional / buyFill;
  const sellFill = fill(exit, "sell", frictionBps);
  const pnl = quantity * sellFill - notional;
  const netReturn = pnl / startingEquity;
  const elapsedDays = (endMs - startMs) / DAY_MS;
  return {
    reference: "Binance premiumIndex indexPrice",
    entryTimestamp: entryRecord.recordedAt,
    exitTimestamp: exitRecord.recordedAt,
    notional,
    quantity,
    entryReference: entry,
    exitReference: exit,
    pnl,
    netReturn,
    annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1
  };
}

function consistencyWindows(series, startMs, endMs, manifest) {
  const count = manifest.riskStatistics?.consistencyWindows?.count ?? 3;
  const durationDays = manifest.riskStatistics?.consistencyWindows?.durationDays ?? 60;
  const toleranceMs = manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000;
  const windows = [];
  for (let index = 0; index < count; index += 1) {
    const start = startMs + index * durationDays * DAY_MS;
    const end = Math.min(start + durationDays * DAY_MS, endMs);
    if (end <= start || end - start < durationDays * DAY_MS) continue;
    const first = firstEquityAtOrAfter(series, start, start === startMs ? 0 : toleranceMs);
    const last = firstEquityAtOrAfter(series, end, end === endMs ? 0 : toleranceMs);
    if (!first || !last) {
      windows.push({ start, end, pnl: null, positive: false, complete: false });
      continue;
    }
    const pnl = last.equity - first.equity;
    windows.push({ start, end, pnl, positive: pnl > 0, complete: true });
  }
  return windows;
}

function analyticalBreakEvenFrictionBps(scenario) {
  const marks = scenario.entry.binanceMark
    + scenario.entry.hyperliquidMark
    + scenario.exit.binanceMark
    + scenario.exit.hyperliquidMark;
  const frictionUsdPerBps = scenario.quantity * marks / 10_000;
  if (!(frictionUsdPerBps > 0)) return 0;
  return Math.max(0, scenario.grossPnlBeforeFriction / frictionUsdPerBps);
}

function acquisitionCoverage(windowRecords, expectedHourlyContexts) {
  const primaryLiveHourlyContexts = windowRecords.filter((record) => acquisitionType(record) === "PRIMARY_LIVE").length;
  const officialRecoveryHourlyContexts = windowRecords.filter((record) => acquisitionType(record) === "OFFICIAL_RECOVERY").length;
  const combinedHourlyContexts = windowRecords.length;
  return {
    primaryLiveHourlyContexts,
    officialRecoveryHourlyContexts,
    combinedHourlyContexts,
    primaryLiveCoverage: expectedHourlyContexts > 0 ? primaryLiveHourlyContexts / expectedHourlyContexts : 0,
    hourlyFirstPartyContextCoverage: expectedHourlyContexts > 0 ? combinedHourlyContexts / expectedHourlyContexts : 0
  };
}

export function evaluateCrossVenueFunding({ manifest, manifestHash, records, availableRawHashes, mode, evaluationNowMs = Date.now() }) {
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) throw new Error("Unexpected Trial 7 manifest");
  if (!["screening", "final"].includes(mode)) throw new Error("mode must be screening or final");

  const startMs = Date.parse(manifest.forwardWindow.startInclusive);
  const endMs = Date.parse(mode === "screening" ? manifest.forwardWindow.screeningEndExclusive : manifest.forwardWindow.finalEndExclusive);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("Invalid frozen Trial 7 window");
  if (evaluationNowMs < endMs) throw new Error(`Refusing to evaluate Trial 7 ${mode} before ${new Date(endMs).toISOString()}`);

  const boundaryToleranceMs = manifest.forwardWindow.entryExitPriceMatchToleranceMinutes * 60_000;
  const evidenceRecords = [...records]
    .filter((record) => {
      const time = Date.parse(record.recordedAt);
      return Number.isFinite(time) && time >= startMs && time <= endMs + boundaryToleranceMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  for (const record of evidenceRecords) verifyRecordIdentity(record, manifestHash);

  const entryRecord = firstRecordAtOrAfter(evidenceRecords, startMs, boundaryToleranceMs);
  const exitRecord = firstRecordAtOrAfter(evidenceRecords, endMs, boundaryToleranceMs);
  const windowRecords = uniqueByHour(evidenceRecords, startMs, endMs);
  const expectedHourlyContexts = Math.round((endMs - startMs) / HOUR_MS);
  const coverageState = acquisitionCoverage(windowRecords, expectedHourlyContexts);
  const minimumContextCoverage = manifest.forwardWindow.minimumRecorderCoverage;
  let maxSnapshotGapMs = Infinity;
  if (windowRecords.length) {
    const times = windowRecords.map((record) => Date.parse(record.recordedAt));
    maxSnapshotGapMs = Math.max(
      times[0] - startMs,
      endMs - times.at(-1),
      ...times.slice(1).map((time, index) => time - times[index])
    );
  }

  const raw = verifyRawHashCoverage(evidenceRecords, availableRawHashes);
  const rawEvents = collectFundingEvents(evidenceRecords, startMs, endMs);
  const hlCoverage = hyperliquidFundingCoverage(rawEvents.hyperliquid, startMs, endMs);
  const fundingToleranceMs = manifest.forwardWindow.fundingPriceMatchToleranceMinutes * 60_000;
  const matchedHyperliquid = matchHyperliquidFunding(rawEvents.hyperliquid, evidenceRecords, fundingToleranceMs);
  const unmatchedHyperliquid = matchedHyperliquid.filter((event) => !(event.oracle > 0));
  const matchedFunding = { hyperliquid: matchedHyperliquid, binance: rawEvents.binance };
  const binanceFundingScheduleAudit = auditBinanceFundingSchedule(evidenceRecords, {
    startMs,
    endMs,
    maximumStaleAnnouncementLagMs: manifest.sourceRules?.binanceFundingScheduleAudit?.maximumStaleAnnouncementLagMs ?? 300000
  });
  const fundingCoverageState = {
    ...hlCoverage,
    observedBinance: rawEvents.binance.length,
    binancePass: binanceFundingScheduleAudit.pass,
    binanceMechanism: "announcedSchedule"
  };

  const dataGate = {
    entrySnapshotPresent: Boolean(entryRecord),
    exitSnapshotPresent: Boolean(exitRecord),
    entrySelectionRule: manifest.forwardWindow.entryExitSelectionRule,
    expectedHourlyContexts,
    observedUniqueHourlyContexts: windowRecords.length,
    acquisitionCoverage: coverageState,
    hourlyFirstPartyContextCoverage: coverageState.hourlyFirstPartyContextCoverage,
    minimumHourlyFirstPartyContextCoverage: minimumContextCoverage,
    primaryLiveCoverage: coverageState.primaryLiveCoverage,
    targetPrimaryLiveRecorderCoverage: manifest.forwardWindow.targetPrimaryLiveRecorderCoverage ?? minimumContextCoverage,
    coveragePass: coverageState.hourlyFirstPartyContextCoverage >= minimumContextCoverage,
    maxSnapshotGapMs,
    maxAllowedSnapshotGapMs: manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000,
    snapshotGapPass: maxSnapshotGapMs <= manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000,
    rawHashCoverage: raw,
    fundingCoverage: fundingCoverageState,
    binanceFundingScheduleAudit,
    unmatchedHyperliquidFundingOracleEvents: unmatchedHyperliquid.map((event) => event.time),
    hyperliquidFundingOraclePass: unmatchedHyperliquid.length === 0
  };
  dataGate.pass = dataGate.entrySnapshotPresent
    && dataGate.exitSnapshotPresent
    && dataGate.coveragePass
    && dataGate.snapshotGapPass
    && raw.pass
    && hlCoverage.hyperliquidPass
    && binanceFundingScheduleAudit.pass
    && dataGate.hyperliquidFundingOraclePass;

  if (!dataGate.pass) {
    return {
      experimentId: manifest.experimentId,
      trialNumber: manifest.trialNumber,
      mode,
      paperOnly: true,
      livePromotionAllowed: false,
      classification: "FAILED_DATA_GATE",
      frozenWindow: { startInclusive: new Date(startMs).toISOString(), endExclusive: new Date(endMs).toISOString() },
      dataGate,
      fundingEvents: { hyperliquidObserved: matchedFunding.hyperliquid.length, binanceObserved: matchedFunding.binance.length },
      economicsCalculated: false,
      interpretationConstraint: "Trial 7 economics are intentionally not calculated when the frozen provenance/data gate fails.",
      antiLeakage: manifest.antiLeakage
    };
  }

  const baseArgs = { records: windowRecords, funding: matchedFunding, manifest, entryRecord, exitRecord, startMs, endMs };
  const primary = buildScenario({ ...baseArgs, frictionBps: manifest.executionModel.primaryAllInFrictionBpsPerOrder });
  const costStress = buildScenario({ ...baseArgs, frictionBps: manifest.executionModel.stressAllInFrictionBpsPerOrder });
  const comparator = indexComparator(entryRecord, exitRecord, manifest, manifest.executionModel.primaryAllInFrictionBpsPerOrder, startMs, endMs);
  const windows60d = consistencyWindows(primary.equitySeries, startMs, endMs, manifest);
  const positive60d = windows60d.filter((window) => window.positive).length;
  const consistencyTelescopeErrorUsd = mode === "final" && windows60d.length === 3 && windows60d.every((window) => window.complete)
    ? windows60d.reduce((sum, window) => sum + window.pnl, 0) - primary.netPnl
    : null;
  const consistencyTelescopePass = consistencyTelescopeErrorUsd === null || Math.abs(consistencyTelescopeErrorUsd) < 1e-8;
  const noMarginFailure = !primary.margin.observedBreach && primary.margin.allFrozenStressesPass;

  const screeningRequirements = {
    dataGatePass: true,
    primaryNetPositive: primary.netPnl > 0,
    fundingContributionPositive: primary.fundingPnl.net > 0,
    marginPass: noMarginFailure
  };
  const screeningPass = Object.values(screeningRequirements).every(Boolean);

  const finalRequirements = {
    ...screeningRequirements,
    annualizedReturnExceedsCashBy2Pct: primary.stats.annualizedReturn > 0.02,
    twoOfThreeSixtyDayWindowsPositive: windows60d.length === 3 && positive60d >= 2,
    consistencyWindowsTelescope: consistencyTelescopePass,
    maxDrawdownBelow10Pct: primary.stats.maxDrawdown > -0.10,
    costStressNetPositive: costStress.netPnl > 0
  };
  const finalPass = mode === "final" && Object.values(finalRequirements).every(Boolean);
  const classification = mode === "screening"
    ? (screeningPass ? "SCREENING_PASS_NO_PROMOTION" : "SCREENING_FAIL_NO_PROMOTION")
    : (finalPass ? manifest.finalGate.strongestPossibleClassification : "FAILED_FINAL_GATE");

  return {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    classification,
    frozenWindow: { startInclusive: new Date(startMs).toISOString(), endExclusive: new Date(endMs).toISOString() },
    dataGate,
    fundingEvents: { hyperliquid: matchedFunding.hyperliquid.length, binance: matchedFunding.binance.length },
    economicsCalculated: true,
    primary,
    costStress,
    directionalComparator: comparator,
    windows60d: windows60d.map((window) => ({
      start: new Date(window.start).toISOString(),
      end: new Date(window.end).toISOString(),
      pnl: window.pnl,
      positive: window.positive,
      complete: window.complete
    })),
    consistencyTelescopeErrorUsd,
    screeningRequirements,
    finalRequirements: mode === "final" ? finalRequirements : null,
    breakEvenAllInFrictionBpsPerOrder: analyticalBreakEvenFrictionBps(primary),
    interpretationConstraint: mode === "screening"
      ? "The 90-day result is predeclared interim evidence only. It cannot promote Trial 7 or authorize any parameter change."
      : "Even PROMOTION_ELIGIBLE_RESEARCH_ONLY permits only a separate paper-baseline proposal. It does not authorize real-money trading.",
    antiLeakage: manifest.antiLeakage
  };
}

export { DAY_MS, HOUR_MS };
