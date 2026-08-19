const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function uniqueByHour(records, startMs, endMs) {
  const byHour = new Map();
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!Number.isFinite(time) || time < startMs || time >= endMs) continue;
    const bucket = Math.floor(time / HOUR_MS) * HOUR_MS;
    const prior = byHour.get(bucket);
    if (!prior || Date.parse(prior.recordedAt) > time) byHour.set(bucket, record);
  }
  return [...byHour.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}

function nearestRecord(records, targetMs, toleranceMs) {
  let best = null;
  let bestDistance = Infinity;
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - targetMs);
    if (distance < bestDistance) {
      best = record;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > toleranceMs) return null;
  return best;
}

function verifyRecordIdentity(record, manifestHash) {
  if (record.schema !== "theoldtrader-cross-venue-funding-v1-record-v2") {
    throw new Error("Unexpected Trial 7 compact-record schema");
  }
  if (record.experimentId !== "cross-venue-funding-v1" || record.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 compact-record identity");
  }
  if (record.manifestSha256 !== manifestHash) {
    throw new Error("Trial 7 manifest hash changed during acquisition");
  }
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
    ]) {
      if (value) hashes.add(String(value));
    }
  }
  return hashes;
}

export function verifyRawHashCoverage(records, availableRawHashes) {
  const required = requiredRawHashes(records);
  const missing = [...required].filter((hash) => !availableRawHashes.has(hash));
  return {
    pass: missing.length === 0,
    required: required.size,
    available: availableRawHashes.size,
    missing
  };
}

function insertEvent(map, event, label) {
  const time = finite(event.time, `${label} funding time`);
  const rate = finite(event.rate, `${label} funding rate`);
  const prior = map.get(time);
  if (prior) {
    if (Math.abs(prior.rate - rate) > 1e-15) {
      throw new Error(`Conflicting ${label} funding rate at ${new Date(time).toISOString()}`);
    }
    if (label === "Binance") {
      const markPrice = positive(event.markPrice, "Binance funding markPrice");
      if (Math.abs(prior.markPrice - markPrice) > 1e-8 * Math.max(prior.markPrice, markPrice)) {
        throw new Error(`Conflicting Binance funding markPrice at ${new Date(time).toISOString()}`);
      }
    }
    return;
  }
  if (label === "Binance") {
    map.set(time, { time, rate, markPrice: positive(event.markPrice, "Binance funding markPrice") });
  } else {
    map.set(time, { time, rate });
  }
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

function fundingCoverage(events, startMs, endMs) {
  const expectedHyperliquid = Math.max(0, Math.round((endMs - startMs) / HOUR_MS) - 1);
  const hlTimes = new Set(events.hyperliquid.map((event) => event.time));
  const missingHyperliquid = [];
  for (let time = startMs + HOUR_MS; time < endMs; time += HOUR_MS) {
    if (!hlTimes.has(time)) missingHyperliquid.push(time);
  }

  const maxBinanceGapMs = 8 * HOUR_MS + 5 * 60_000;
  const bnTimes = events.binance.map((event) => event.time);
  let maxObservedBinanceGapMs = 0;
  let binanceGapPass = bnTimes.length > 0;
  if (bnTimes.length) {
    maxObservedBinanceGapMs = Math.max(
      bnTimes[0] - startMs,
      endMs - bnTimes.at(-1),
      ...bnTimes.slice(1).map((time, index) => time - bnTimes[index])
    );
    binanceGapPass = maxObservedBinanceGapMs <= maxBinanceGapMs;
  }

  return {
    expectedHyperliquid,
    observedHyperliquid: events.hyperliquid.length,
    missingHyperliquid,
    hyperliquidPass: missingHyperliquid.length === 0,
    observedBinance: events.binance.length,
    maxObservedBinanceGapMs,
    maxAllowedBinanceGapMs: maxBinanceGapMs,
    binancePass: binanceGapPass
  };
}

function matchHyperliquidFunding(events, records, toleranceMs) {
  return events.map((event) => {
    const record = nearestRecord(records, event.time, toleranceMs);
    if (!record) {
      return { ...event, oracle: null, matchedRecordAt: null, matchDistanceMs: null };
    }
    const time = Date.parse(record.recordedAt);
    return {
      ...event,
      oracle: positive(record.sources.hyperliquid.oracle, "matched Hyperliquid oracle"),
      matchedRecordAt: record.recordedAt,
      matchDistanceMs: Math.abs(time - event.time)
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
    if (venue === "hyperliquid") total += quantity * event.oracle * event.rate;
    else total -= quantity * event.markPrice * event.rate;
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
  for (const point of series) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.min(worst, point.equity / peak - 1);
  }
  return worst;
}

function returnStats(series, startingEquity, elapsedDays) {
  const dailyByDay = new Map();
  for (const point of series) dailyByDay.set(Math.floor(point.time / DAY_MS), point);
  const daily = [...dailyByDay.values()].sort((a, b) => a.time - b.time);
  let previous = startingEquity;
  const returns = [];
  for (const point of daily) {
    returns.push(point.equity / previous - 1);
    previous = point.equity;
  }
  const sd = stdev(returns);
  const downsideSd = stdev(returns.filter((value) => value < 0));
  const finalEquity = series.at(-1)?.equity ?? startingEquity;
  const netReturn = finalEquity / startingEquity - 1;
  return {
    finalEquity,
    netReturn,
    annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1,
    sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
    sortino: downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0,
    maxDrawdown: maxDrawdown(series)
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
  const longPricePnl = quantity * (longExitFill - longEntryFill);
  const shortPricePnl = quantity * (shortEntryFill - shortExitFill);
  const basisPnlAfterFriction = longPricePnl + shortPricePnl;
  const netPnl = fundingPnl.net + basisPnlAfterFriction;

  const entryFrictionUsd = quantity * ((longEntryFill - entryBinanceMark) + (entryHyperliquidMark - shortEntryFill));
  const exitFrictionUsd = quantity * ((exitBinanceMark - longExitFill) + (shortExitFill - exitHyperliquidMark));
  const totalFrictionUsd = entryFrictionUsd + exitFrictionUsd;

  const marginPct = manifest.marginStress.researchMaintenanceMarginPctOfLegNotional;
  const collateral = startingEquity * manifest.portfolio.collateralReservePctOfStartingEquityPerVenue;
  let observedMarginBreach = null;
  const stressState = Object.fromEntries(manifest.marginStress.crossVenueBasisShockPct.map((shock) => [String(shock), {
    breached: false,
    minBinanceExcess: Infinity,
    minHyperliquidExcess: Infinity
  }]));
  const equitySeries = [];
  const marginSeries = [];

  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!(time >= startMs && time < endMs)) continue;
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
    const bnExcess = bnVenueEquity - bnMaintenance;
    const hlExcess = hlVenueEquity - hlMaintenance;
    if (!observedMarginBreach && (bnExcess < 0 || hlExcess < 0)) {
      observedMarginBreach = {
        timestamp: record.recordedAt,
        venue: bnExcess < 0 ? "binance" : "hyperliquid",
        binanceExcess: bnExcess,
        hyperliquidExcess: hlExcess
      };
    }

    for (const shock of manifest.marginStress.crossVenueBasisShockPct) {
      const stressedBnMark = bnMark * (1 - shock / 2);
      const stressedHlMark = hlMark * (1 + shock / 2);
      const stressedBnEquity = collateral + quantity * (stressedBnMark - longEntryFill) + bnFunding;
      const stressedHlEquity = collateral + quantity * (shortEntryFill - stressedHlMark) + hlFunding;
      const stressedBnExcess = stressedBnEquity - quantity * stressedBnMark * marginPct;
      const stressedHlExcess = stressedHlEquity - quantity * stressedHlMark * marginPct;
      const state = stressState[String(shock)];
      state.minBinanceExcess = Math.min(state.minBinanceExcess, stressedBnExcess);
      state.minHyperliquidExcess = Math.min(state.minHyperliquidExcess, stressedHlExcess);
      if (stressedBnExcess < 0 || stressedHlExcess < 0) state.breached = true;
    }

    const equity = startingEquity + bnPricePnl + hlPricePnl + bnFunding + hlFunding;
    equitySeries.push({ time, equity });
    marginSeries.push({
      time,
      timestamp: record.recordedAt,
      binanceExcess: bnExcess,
      hyperliquidExcess: hlExcess,
      binanceFunding: bnFunding,
      hyperliquidFunding: hlFunding
    });
  }

  equitySeries.push({ time: endMs, equity: startingEquity + netPnl });
  const elapsedDays = (endMs - startMs) / DAY_MS;
  const stats = returnStats(equitySeries, startingEquity, elapsedDays);

  return {
    frictionBpsPerOrder: frictionBps,
    quantity,
    pairedNotional,
    entry: {
      binanceMark: entryBinanceMark,
      hyperliquidMark: entryHyperliquidMark,
      binanceFill: longEntryFill,
      hyperliquidFill: shortEntryFill
    },
    exit: {
      binanceMark: exitBinanceMark,
      hyperliquidMark: exitHyperliquidMark,
      binanceFill: longExitFill,
      hyperliquidFill: shortExitFill
    },
    fundingPnl,
    pricePnl: {
      binanceLongAfterFriction: longPricePnl,
      hyperliquidShortAfterFriction: shortPricePnl,
      combinedBasisAfterFriction: basisPnlAfterFriction
    },
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
    notional,
    quantity,
    entryReference: entry,
    exitReference: exit,
    pnl,
    netReturn,
    annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1
  };
}

function sixtyDayWindows(series, startMs, endMs) {
  const windows = [];
  for (let start = startMs; start < endMs; start += 60 * DAY_MS) {
    const end = Math.min(start + 60 * DAY_MS, endMs);
    if (end - start < 59 * DAY_MS) continue;
    const first = nearestRecord(series.map((point) => ({ recordedAt: new Date(point.time).toISOString(), point })), start, 2 * HOUR_MS)?.point;
    const last = nearestRecord(series.map((point) => ({ recordedAt: new Date(point.time).toISOString(), point })), end, 2 * HOUR_MS)?.point;
    if (!first || !last) {
      windows.push({ start, end, pnl: null, positive: false });
      continue;
    }
    const pnl = last.equity - first.equity;
    windows.push({ start, end, pnl, positive: pnl > 0 });
  }
  return windows;
}

function breakEvenFriction(args) {
  let low = 0;
  let high = 500;
  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2;
    const pnl = buildScenario({ ...args, frictionBps: mid }).netPnl;
    if (pnl > 0) low = mid;
    else high = mid;
  }
  return low;
}

export function evaluateCrossVenueFunding({
  manifest,
  manifestHash,
  records,
  availableRawHashes,
  mode,
  evaluationNowMs = Date.now()
}) {
  if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 manifest");
  }
  if (!['screening', 'final'].includes(mode)) throw new Error("mode must be screening or final");
  for (const record of records) verifyRecordIdentity(record, manifestHash);
  records = [...records].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const startMs = Date.parse(manifest.forwardWindow.startInclusive);
  const endMs = Date.parse(mode === "screening"
    ? manifest.forwardWindow.screeningEndExclusive
    : manifest.forwardWindow.finalEndExclusive);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Invalid frozen Trial 7 window");
  }
  if (evaluationNowMs < endMs) {
    throw new Error(`Refusing to evaluate Trial 7 ${mode} before ${new Date(endMs).toISOString()}`);
  }

  const toleranceMs = manifest.forwardWindow.entryExitPriceMatchToleranceMinutes * 60_000;
  const fundingToleranceMs = manifest.forwardWindow.fundingPriceMatchToleranceMinutes * 60_000;
  const entryRecord = nearestRecord(records, startMs, toleranceMs);
  const exitRecord = nearestRecord(records, endMs, toleranceMs);
  const windowRecords = uniqueByHour(records, startMs, endMs);
  const expectedSnapshots = Math.round((endMs - startMs) / HOUR_MS);
  const coverage = expectedSnapshots > 0 ? windowRecords.length / expectedSnapshots : 0;
  let maxSnapshotGapMs = Infinity;
  if (windowRecords.length) {
    const times = windowRecords.map((record) => Date.parse(record.recordedAt));
    maxSnapshotGapMs = Math.max(
      times[0] - startMs,
      endMs - times.at(-1),
      ...times.slice(1).map((time, index) => time - times[index])
    );
  }

  const raw = verifyRawHashCoverage(records, availableRawHashes);
  const rawEvents = collectFundingEvents(records, startMs, endMs);
  const fundingCoverageState = fundingCoverage(rawEvents, startMs, endMs);
  const matchedHyperliquid = matchHyperliquidFunding(rawEvents.hyperliquid, records, fundingToleranceMs);
  const unmatchedHyperliquid = matchedHyperliquid.filter((event) => !(event.oracle > 0));
  const matchedFunding = { hyperliquid: matchedHyperliquid, binance: rawEvents.binance };

  const dataGate = {
    entrySnapshotPresent: Boolean(entryRecord),
    exitSnapshotPresent: Boolean(exitRecord),
    expectedSnapshots,
    observedUniqueHourlySnapshots: windowRecords.length,
    recorderCoverage: coverage,
    minimumRecorderCoverage: manifest.forwardWindow.minimumRecorderCoverage,
    coveragePass: coverage >= manifest.forwardWindow.minimumRecorderCoverage,
    maxSnapshotGapMs,
    maxAllowedSnapshotGapMs: manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000,
    snapshotGapPass: maxSnapshotGapMs <= manifest.forwardWindow.maximumSnapshotGapMinutes * 60_000,
    rawHashCoverage: raw,
    fundingCoverage: fundingCoverageState,
    unmatchedHyperliquidFundingOracleEvents: unmatchedHyperliquid.map((event) => event.time),
    hyperliquidFundingOraclePass: unmatchedHyperliquid.length === 0
  };
  dataGate.pass = dataGate.entrySnapshotPresent
    && dataGate.exitSnapshotPresent
    && dataGate.coveragePass
    && dataGate.snapshotGapPass
    && raw.pass
    && fundingCoverageState.hyperliquidPass
    && fundingCoverageState.binancePass
    && dataGate.hyperliquidFundingOraclePass;

  if (!entryRecord || !exitRecord) {
    return {
      experimentId: manifest.experimentId,
      trialNumber: manifest.trialNumber,
      mode,
      classification: "FAILED_DATA_GATE",
      dataGate,
      antiLeakage: manifest.antiLeakage
    };
  }

  const baseArgs = { records: windowRecords, funding: matchedFunding, manifest, entryRecord, exitRecord, startMs, endMs };
  const primary = buildScenario({ ...baseArgs, frictionBps: manifest.executionModel.primaryAllInFrictionBpsPerOrder });
  const costStress = buildScenario({ ...baseArgs, frictionBps: manifest.executionModel.stressAllInFrictionBpsPerOrder });
  const comparator = indexComparator(entryRecord, exitRecord, manifest, manifest.executionModel.primaryAllInFrictionBpsPerOrder, startMs, endMs);
  const windows60d = sixtyDayWindows(primary.equitySeries, startMs, endMs);
  const positive60d = windows60d.filter((window) => window.positive).length;
  const noMarginFailure = !primary.margin.observedBreach && primary.margin.allFrozenStressesPass;

  const screeningRequirements = {
    dataGatePass: dataGate.pass,
    primaryNetPositive: primary.netPnl > 0,
    fundingContributionPositive: primary.fundingPnl.net > 0,
    marginPass: noMarginFailure
  };
  const screeningPass = Object.values(screeningRequirements).every(Boolean);

  const finalRequirements = {
    ...screeningRequirements,
    annualizedReturnExceedsCashBy2Pct: primary.stats.annualizedReturn > 0.02,
    twoOfThreeSixtyDayWindowsPositive: windows60d.length === 3 && positive60d >= 2,
    maxDrawdownBelow10Pct: primary.stats.maxDrawdown > -0.10,
    costStressNetPositive: costStress.netPnl > 0
  };
  const finalPass = mode === "final" && Object.values(finalRequirements).every(Boolean);

  let classification;
  if (!dataGate.pass) classification = "FAILED_DATA_GATE";
  else if (mode === "screening") classification = screeningPass ? "SCREENING_PASS_NO_PROMOTION" : "SCREENING_FAIL_NO_PROMOTION";
  else classification = finalPass ? manifest.finalGate.strongestPossibleClassification : "FAILED_FINAL_GATE";

  return {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    classification,
    frozenWindow: {
      startInclusive: new Date(startMs).toISOString(),
      endExclusive: new Date(endMs).toISOString()
    },
    dataGate,
    fundingEvents: {
      hyperliquid: matchedFunding.hyperliquid.length,
      binance: matchedFunding.binance.length
    },
    primary,
    costStress,
    directionalComparator: comparator,
    windows60d: windows60d.map((window) => ({
      start: new Date(window.start).toISOString(),
      end: new Date(window.end).toISOString(),
      pnl: window.pnl,
      positive: window.positive
    })),
    screeningRequirements,
    finalRequirements: mode === "final" ? finalRequirements : null,
    breakEvenAllInFrictionBpsPerOrder: breakEvenFriction(baseArgs),
    interpretationConstraint: mode === "screening"
      ? "The 90-day result is predeclared interim evidence only. It cannot promote Trial 7 or authorize any parameter change."
      : "Even PROMOTION_ELIGIBLE_RESEARCH_ONLY permits only a separate paper-baseline proposal. It does not authorize real-money trading.",
    antiLeakage: manifest.antiLeakage
  };
}

export { DAY_MS, HOUR_MS };
