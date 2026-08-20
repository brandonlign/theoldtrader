const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

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
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stdev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1));
}
function firstAtOrAfter(records, boundaryMs, toleranceMs) {
  return records
    .filter((record) => {
      const time = Date.parse(record.recordedAt);
      return Number.isFinite(time) && time >= boundaryMs && time <= boundaryMs + toleranceMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0] ?? null;
}
function byHour(records, startMs, endMs) {
  const map = new Map();
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!Number.isFinite(time) || time < startMs || time >= endMs) continue;
    const bucket = Math.floor(time / HOUR_MS) * HOUR_MS;
    const prior = map.get(bucket);
    if (!prior || Date.parse(record.recordedAt) < Date.parse(prior.recordedAt)) map.set(bucket, record);
  }
  return [...map.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}
function validateRecord(record, manifestHash, expectedContractSize) {
  if (record.schema !== "theoldtrader-bitnomial-carry-v1-record-v1" || record.experimentId !== "bitnomial-carry-v1" || record.trialNumber !== 8) {
    throw new Error("Unexpected Trial 8 compact-record identity");
  }
  if (record.manifestSha256 !== manifestHash) throw new Error("Trial 8 manifest hash changed during acquisition");
  if (record.acquisition?.type !== "PRIMARY_LIVE") throw new Error("Trial 8 currently accepts PRIMARY_LIVE records only");
  const cb = record.sources?.coinbase;
  const bt = record.sources?.bitnomial;
  positive(cb?.bid, "Coinbase bid");
  positive(cb?.ask, "Coinbase ask");
  positive(cb?.last, "Coinbase last");
  if (positive(cb.ask, "Coinbase ask") < positive(cb.bid, "Coinbase bid")) throw new Error("Coinbase crossed ticker");
  positive(bt?.productId, "Bitnomial product id");
  positive(bt?.lastPriceUsd, "Bitnomial last price");
  if (Math.abs(Number(bt.contractSizeBtc) - expectedContractSize) > 1e-12) throw new Error("Trial 8 Bitnomial contract size drift");
  const hashes = [cb?.hash, bt?.hashes?.specs, bt?.hashes?.productData, bt?.hashes?.funding];
  if (hashes.some((hash) => !/^[0-9a-f]{64}$/i.test(String(hash ?? "")))) throw new Error("Trial 8 compact record has invalid raw hash");
}
function collectFunding(records, startMs, endMs, productId) {
  const byEnd = new Map();
  for (const record of records) {
    for (const event of record.sources?.bitnomial?.fundingEvents ?? []) {
      if (Number(event.productId) !== Number(productId)) continue;
      const end = Date.parse(event.intervalEnd);
      const start = Date.parse(event.intervalStart);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 8 * HOUR_MS) throw new Error("Invalid Bitnomial funding interval");
      if (!(end > startMs && end <= endMs)) continue;
      const normalized = {
        productId: Number(event.productId),
        priceIndex: positive(event.priceIndex, "Bitnomial funding price index"),
        markPrice: positive(event.markPrice, "Bitnomial funding mark price"),
        interestRate: finite(event.interestRate, "Bitnomial funding interest rate"),
        fundingRate: finite(event.fundingRate, "Bitnomial funding rate"),
        intervalStart: new Date(start).toISOString(),
        intervalEnd: new Date(end).toISOString()
      };
      const prior = byEnd.get(end);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) throw new Error(`Conflicting Bitnomial funding event at ${normalized.intervalEnd}`);
      byEnd.set(end, normalized);
    }
  }
  return [...byEnd.values()].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
function fundingCoverage(events, startMs, endMs) {
  const expected = [];
  let cursor = Math.floor(startMs / (8 * HOUR_MS)) * (8 * HOUR_MS) + 8 * HOUR_MS;
  while (cursor <= endMs) {
    if (cursor > startMs) expected.push(cursor);
    cursor += 8 * HOUR_MS;
  }
  const observed = new Set(events.map((event) => Date.parse(event.intervalEnd)));
  const missing = expected.filter((time) => !observed.has(time));
  return {
    expected: expected.length,
    observed: events.length,
    missing: missing.map((time) => new Date(time).toISOString()),
    pass: missing.length === 0
  };
}
function staleBitnomialRows(records, maximumAgeMinutes) {
  return records.filter((record) => {
    const recorded = Date.parse(record.recordedAt);
    const last = Date.parse(record.sources?.bitnomial?.lastPriceTime);
    return !Number.isFinite(last) || recorded - last > maximumAgeMinutes * 60_000 || last > recorded + 60_000;
  }).map((record) => ({ recordedAt: record.recordedAt, lastPriceTime: record.sources?.bitnomial?.lastPriceTime ?? null }));
}
function sizePosition(entryRecord, manifest) {
  const startingEquity = manifest.portfolio.startingEquityUsd;
  const target = startingEquity * manifest.portfolio.targetNotionalPctOfStartingEquityPerLeg;
  const contractSize = manifest.portfolio.contractSizeBtc;
  const perpPrice = positive(entryRecord.sources.bitnomial.lastPriceUsd, "entry Bitnomial price");
  const oneContractNotional = contractSize * perpPrice;
  let contracts = Math.floor(target / oneContractNotional);
  if (contracts < 1 && oneContractNotional <= startingEquity * manifest.portfolio.maximumActualNotionalPctPerLeg) contracts = 1;
  if (contracts < 1) throw new Error("Trial 8 frozen sizing cannot support one Bitnomial contract within exposure cap");
  const btcQuantity = contracts * contractSize;
  const actualNotional = btcQuantity * perpPrice;
  if (actualNotional > startingEquity * manifest.portfolio.maximumActualNotionalPctPerLeg + 1e-9) throw new Error("Trial 8 actual notional exceeds frozen cap");
  return { contracts, btcQuantity, actualNotional, targetNotional: target };
}
function scenario({ records, funding, manifest, entryRecord, exitRecord, startMs, endMs, stress = false }) {
  const startingEquity = manifest.portfolio.startingEquityUsd;
  const size = sizePosition(entryRecord, manifest);
  const cbEntry = stress ? manifest.executionModel.stressCoinbaseSpotAllInBpsPerOrder : manifest.executionModel.coinbaseSpotExtraSlippageBpsPerOrder;
  const cbExit = cbEntry;
  const cbFeeBps = stress ? 0 : manifest.executionModel.coinbaseSpotFeeBpsPerOrder;
  const btSlip = stress ? manifest.executionModel.stressBitnomialSlippageBpsPerOrder : manifest.executionModel.bitnomialExtraSlippageBpsPerOrder;
  const contractFee = manifest.executionModel.bitnomialExchangeClearingFeeUsdPerContractPerSide;

  const spotEntryRef = positive(entryRecord.sources.coinbase.ask, "entry Coinbase ask");
  const spotExitRef = positive(exitRecord.sources.coinbase.bid, "exit Coinbase bid");
  const perpEntryRef = positive(entryRecord.sources.bitnomial.lastPriceUsd, "entry Bitnomial price");
  const perpExitRef = positive(exitRecord.sources.bitnomial.lastPriceUsd, "exit Bitnomial price");
  const spotEntryFill = spotEntryRef * (1 + cbEntry / 10_000);
  const spotExitFill = spotExitRef * (1 - cbExit / 10_000);
  const perpEntryFill = perpEntryRef * (1 - btSlip / 10_000);
  const perpExitFill = perpExitRef * (1 + btSlip / 10_000);
  const spotEntryFee = size.btcQuantity * spotEntryFill * cbFeeBps / 10_000;
  const spotExitFee = size.btcQuantity * spotExitFill * cbFeeBps / 10_000;
  const perpFees = size.contracts * contractFee * 2;
  const spotPricePnl = size.btcQuantity * (spotExitFill - spotEntryFill);
  const perpPricePnl = size.btcQuantity * (perpEntryFill - perpExitFill);
  const fundingPnl = funding.reduce((sum, event) => sum + size.btcQuantity * event.markPrice * event.fundingRate, 0);
  const explicitFees = spotEntryFee + spotExitFee + perpFees;
  const netPnl = spotPricePnl + perpPricePnl + fundingPnl - explicitFees;

  const collateral = startingEquity * manifest.portfolio.perpetualCollateralReservePctOfStartingEquity;
  const maintenancePct = manifest.marginStress.researchMaintenanceMarginPctOfPerpetualNotional;
  const stressStates = Object.fromEntries(manifest.marginStress.adverseBasisShockPct.map((shock) => [String(shock), { breached: false, minExcess: Infinity }]));
  let observedMarginBreach = null;
  const equitySeries = [{ time: startMs, equity: startingEquity }];
  let cumulativeFunding = 0;
  let fundingIndex = 0;
  const sortedFunding = [...funding].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
  for (const record of records) {
    const time = Date.parse(record.recordedAt);
    if (!(time >= startMs && time < endMs)) continue;
    while (fundingIndex < sortedFunding.length && Date.parse(sortedFunding[fundingIndex].intervalEnd) <= time) {
      const event = sortedFunding[fundingIndex++];
      cumulativeFunding += size.btcQuantity * event.markPrice * event.fundingRate;
    }
    const spot = positive(record.sources.coinbase.last, "Coinbase mark path");
    const perp = positive(record.sources.bitnomial.lastPriceUsd, "Bitnomial mark path");
    const spotPnl = size.btcQuantity * (spot - spotEntryFill) - spotEntryFee;
    const perpPnl = size.btcQuantity * (perpEntryFill - perp);
    const perpEquity = collateral + perpPnl + cumulativeFunding;
    const maintenance = size.btcQuantity * perp * maintenancePct;
    const excess = perpEquity - maintenance;
    if (!observedMarginBreach && excess < 0) observedMarginBreach = { timestamp: record.recordedAt, excess };
    for (const shock of manifest.marginStress.adverseBasisShockPct) {
      const stressedPerp = perp * (1 + shock);
      const stressedPnl = size.btcQuantity * (perpEntryFill - stressedPerp);
      const stressedExcess = collateral + stressedPnl + cumulativeFunding - size.btcQuantity * stressedPerp * maintenancePct;
      const state = stressStates[String(shock)];
      state.minExcess = Math.min(state.minExcess, stressedExcess);
      if (stressedExcess < 0) state.breached = true;
    }
    equitySeries.push({ time, equity: startingEquity + spotPnl + perpPnl + cumulativeFunding });
  }
  equitySeries.push({ time: endMs, equity: startingEquity + netPnl });
  equitySeries.sort((a, b) => a.time - b.time);

  let peak = startingEquity;
  let maxDrawdown = 0;
  for (const point of equitySeries) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const daily = [];
  let previous = startingEquity;
  for (let boundary = startMs + DAY_MS; boundary <= endMs; boundary += DAY_MS) {
    const eligible = equitySeries.filter((point) => point.time <= boundary);
    const equity = eligible.at(-1)?.equity ?? previous;
    daily.push(equity / previous - 1);
    previous = equity;
  }
  if ((endMs - startMs) % DAY_MS !== 0) {
    const finalEquity = equitySeries.at(-1).equity;
    daily.push(finalEquity / previous - 1);
  }
  const sd = stdev(daily);
  const downside = Math.sqrt(mean(daily.map((value) => Math.min(value, 0) ** 2)));
  const netReturn = netPnl / startingEquity;
  const elapsedDays = (endMs - startMs) / DAY_MS;
  const windows = [];
  for (let i = 0; i < 3 && startMs + i * 60 * DAY_MS < endMs; i += 1) {
    const ws = startMs + i * 60 * DAY_MS;
    const we = Math.min(ws + 60 * DAY_MS, endMs);
    if (we - ws < 59 * DAY_MS) continue;
    const before = equitySeries.filter((point) => point.time <= ws).at(-1)?.equity ?? startingEquity;
    const after = equitySeries.filter((point) => point.time <= we).at(-1)?.equity ?? before;
    windows.push({ start: new Date(ws).toISOString(), end: new Date(we).toISOString(), pnl: after - before, positive: after > before });
  }
  return {
    stress,
    size,
    entry: { spotReference: spotEntryRef, spotFill: spotEntryFill, perpetualReference: perpEntryRef, perpetualFill: perpEntryFill },
    exit: { spotReference: spotExitRef, spotFill: spotExitFill, perpetualReference: perpExitRef, perpetualFill: perpExitFill },
    pnl: {
      spotPrice: spotPricePnl,
      perpetualPrice: perpPricePnl,
      rawBasis: spotPricePnl + perpPricePnl,
      funding: fundingPnl,
      explicitFees,
      net: netPnl
    },
    stats: {
      finalEquity: startingEquity + netPnl,
      netReturn,
      annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1,
      sharpe: sd > 0 ? Math.sqrt(365) * mean(daily) / sd : 0,
      sortino: downside > 0 ? Math.sqrt(365) * mean(daily) / downside : 0,
      maxDrawdown
    },
    margin: { observedBreach: observedMarginBreach, stress: stressStates, allFrozenStressesPass: Object.values(stressStates).every((state) => !state.breached) },
    windows60d: windows,
    equitySeries
  };
}
export function evaluateBitnomialCarry({ manifest, manifestHash, records, availableRawHashes, mode, evaluationNowMs = Date.now() }) {
  if (manifest.experimentId !== "bitnomial-carry-v1" || manifest.trialNumber !== 8) throw new Error("Unexpected Trial 8 manifest");
  if (!["screening", "final"].includes(mode)) throw new Error("mode must be screening or final");
  for (const record of records) validateRecord(record, manifestHash, manifest.portfolio.contractSizeBtc);
  records = [...records].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const startMs = Date.parse(manifest.forwardWindow.startInclusive);
  const endMs = Date.parse(mode === "screening" ? manifest.forwardWindow.screeningEndExclusive : manifest.forwardWindow.finalEndExclusive);
  const notBefore = endMs + manifest.forwardWindow.earliestEvaluationDelayMinutesAfterBoundary * 60_000;
  if (evaluationNowMs < notBefore) throw new Error(`Refusing Trial 8 ${mode} evaluation before ${new Date(notBefore).toISOString()}`);
  const toleranceMs = manifest.forwardWindow.entryExitToleranceMinutes * 60_000;
  const entryRecord = firstAtOrAfter(records, startMs, toleranceMs);
  const exitRecord = firstAtOrAfter(records, endMs, toleranceMs);
  const contextRecords = byHour(records, startMs, endMs);
  const expectedHours = Math.round((endMs - startMs) / HOUR_MS);
  const contextCoverage = contextRecords.length / expectedHours;
  let maxGapMs = Infinity;
  if (contextRecords.length) {
    const times = contextRecords.map((r) => Date.parse(r.recordedAt));
    maxGapMs = Math.max(times[0] - startMs, endMs - times.at(-1), ...times.slice(1).map((time, i) => time - times[i]));
  }
  const staleRows = staleBitnomialRows([...contextRecords, ...(exitRecord ? [exitRecord] : [])], manifest.forwardWindow.maximumBitnomialLastTradeAgeMinutes);
  const productIds = new Set(records.map((r) => Number(r.sources.bitnomial.productId)));
  const productIdentityPass = productIds.size === 1;
  const productId = productIdentityPass ? [...productIds][0] : null;
  const funding = productId ? collectFunding(records, startMs, endMs, productId) : [];
  const fundingGate = fundingCoverage(funding, startMs, endMs);
  const requiredHashes = new Set(records.flatMap((record) => [record.sources.coinbase.hash, record.sources.bitnomial.hashes.specs, record.sources.bitnomial.hashes.productData, record.sources.bitnomial.hashes.funding]));
  const missingHashes = [...requiredHashes].filter((hash) => !availableRawHashes.has(hash));
  const dataGate = {
    entryContextPresent: Boolean(entryRecord),
    exitContextPresent: Boolean(exitRecord),
    expectedHourlyContexts: expectedHours,
    observedHourlyContexts: contextRecords.length,
    hourlyContextCoverage: contextCoverage,
    coveragePass: contextCoverage >= manifest.forwardWindow.minimumHourlyContextCoverage,
    maxContextGapMs: maxGapMs,
    contextGapPass: maxGapMs <= manifest.forwardWindow.maximumContextGapMinutes * 60_000,
    staleBitnomialRows: staleRows,
    stalePricePass: staleRows.length === 0,
    productIdentityPass,
    fundingCoverage: fundingGate,
    rawHashCoverage: { required: requiredHashes.size, missing: missingHashes, pass: missingHashes.length === 0 }
  };
  dataGate.pass = dataGate.entryContextPresent && dataGate.exitContextPresent && dataGate.coveragePass && dataGate.contextGapPass && dataGate.stalePricePass && productIdentityPass && fundingGate.pass && dataGate.rawHashCoverage.pass;
  if (!dataGate.pass) return { experimentId: manifest.experimentId, trialNumber: 8, mode, paperOnly: true, livePromotionAllowed: false, classification: "FAILED_DATA_GATE", economicsCalculated: false, dataGate };

  const primary = scenario({ records: contextRecords, funding, manifest, entryRecord, exitRecord, startMs, endMs, stress: false });
  const costStress = scenario({ records: contextRecords, funding, manifest, entryRecord, exitRecord, startMs, endMs, stress: true });
  const noMarginFailure = !primary.margin.observedBreach && primary.margin.allFrozenStressesPass;
  const screeningRequirements = { dataGatePass: true, netPositive: primary.pnl.net > 0, fundingPositive: primary.pnl.funding > 0, marginPass: noMarginFailure };
  const finalRequirements = {
    ...screeningRequirements,
    annualizedReturnAbove1Pct: primary.stats.annualizedReturn > 0.01,
    twoOfThreeSixtyDayWindowsPositive: primary.windows60d.length === 3 && primary.windows60d.filter((w) => w.positive).length >= 2,
    maxDrawdownBelow10Pct: primary.stats.maxDrawdown > -0.10,
    highCostStressPositive: costStress.pnl.net > 0
  };
  const classification = mode === "screening"
    ? (Object.values(screeningRequirements).every(Boolean) ? "SCREENING_PASS_NO_PROMOTION" : "SCREENING_FAIL_NO_PROMOTION")
    : (Object.values(finalRequirements).every(Boolean) ? manifest.finalGate.strongestPossibleClassification : "FAILED_FINAL_GATE");
  const spotBuyHoldNet = primary.size.btcQuantity * (primary.exit.spotFill - primary.entry.spotFill)
    - primary.size.btcQuantity * primary.entry.spotFill * manifest.executionModel.coinbaseSpotFeeBpsPerOrder / 10_000
    - primary.size.btcQuantity * primary.exit.spotFill * manifest.executionModel.coinbaseSpotFeeBpsPerOrder / 10_000;
  return {
    experimentId: manifest.experimentId,
    trialNumber: 8,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    classification,
    economicsCalculated: true,
    dataGate,
    fundingEvents: funding.length,
    primary,
    costStress,
    comparator: { coinbaseSpotBuyHoldPnl: spotBuyHoldNet, cashPnl: 0 },
    screeningRequirements,
    finalRequirements: mode === "final" ? finalRequirements : null
  };
}

export { HOUR_MS, DAY_MS };
