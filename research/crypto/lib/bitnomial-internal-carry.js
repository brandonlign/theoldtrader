import { executableVwap, validateBookFreshness } from "./bitnomial-book.js";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

function finite(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}`);
  return n;
}
function positive(value, label) {
  const n = finite(value, label);
  if (!(n > 0)) throw new Error(`Non-positive ${label}`);
  return n;
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
function firstAtOrAfter(records, boundaryMs, toleranceMs) {
  return records
    .filter((record) => {
      const t = Date.parse(record.recordedAt);
      return Number.isFinite(t) && t >= boundaryMs && t <= boundaryMs + toleranceMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0] ?? null;
}
function uniqueHourly(records, startMs, endMs) {
  const map = new Map();
  for (const record of records) {
    const t = Date.parse(record.recordedAt);
    if (!Number.isFinite(t) || t < startMs || t >= endMs) continue;
    const bucket = Math.floor(t / HOUR_MS) * HOUR_MS;
    const prior = map.get(bucket);
    if (!prior || t < Date.parse(prior.recordedAt)) map.set(bucket, record);
  }
  return [...map.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}
function expectedFundingTimes(startMs, endMs) {
  const out = [];
  let cursor = Math.floor(startMs / (8 * HOUR_MS)) * (8 * HOUR_MS) + 8 * HOUR_MS;
  while (cursor <= endMs) {
    if (cursor > startMs) out.push(cursor);
    cursor += 8 * HOUR_MS;
  }
  return out;
}
function collectFunding(records, productId, startMs, endMs) {
  const byEnd = new Map();
  for (const record of records) {
    for (const event of record.sources?.perpetual?.fundingEvents ?? []) {
      if (Number(event.productId) !== Number(productId)) continue;
      const start = Date.parse(event.intervalStart);
      const end = Date.parse(event.intervalEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 8 * HOUR_MS) throw new Error("Trial 9 invalid funding interval");
      if (!(end > startMs && end <= endMs)) continue;
      const normalized = {
        productId: Number(event.productId),
        markPrice: positive(event.markPrice, "funding mark price"),
        priceIndex: positive(event.priceIndex, "funding price index"),
        fundingRate: finite(event.fundingRate, "funding rate"),
        interestRate: finite(event.interestRate, "funding interest rate"),
        intervalStart: new Date(start).toISOString(),
        intervalEnd: new Date(end).toISOString()
      };
      const prior = byEnd.get(end);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) throw new Error(`Trial 9 conflicting funding event at ${normalized.intervalEnd}`);
      byEnd.set(end, normalized);
    }
  }
  return [...byEnd.values()].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
function validateRecord(record, manifestHash, manifest) {
  if (record.schema !== "theoldtrader-bitnomial-internal-carry-v1-record-v1" || record.experimentId !== "bitnomial-internal-carry-v1" || record.trialNumber !== 9) throw new Error("Unexpected Trial 9 record identity");
  if (record.manifestSha256 !== manifestHash) throw new Error("Trial 9 manifest hash drift");
  if (record.acquisition?.type !== "PRIMARY_LIVE") throw new Error("Trial 9 accepts PRIMARY_LIVE only");
  const spot = record.sources?.spot;
  const perp = record.sources?.perpetual;
  positive(spot?.productId, "spot product id");
  positive(perp?.productId, "perpetual product id");
  if (String(spot?.symbol) !== "BTCUSD") throw new Error("Trial 9 spot symbol drift");
  if (!String(perp?.symbol ?? "").startsWith("PBTCUC")) throw new Error("Trial 9 perpetual symbol drift");
  if (Math.abs(Number(spot.contractSizeBtc) - manifest.venues.spotLong.contractSizeBtc) > 1e-12) throw new Error("Trial 9 spot contract size drift");
  if (Math.abs(Number(perp.contractSizeBtc) - manifest.venues.perpetualShort.contractSizeBtc) > 1e-12) throw new Error("Trial 9 perpetual contract size drift");
  positive(spot.lastPriceUsd, "spot last price");
  positive(perp.lastPriceUsd, "perpetual last price");
  const maxAge = manifest.dataGates.bookSnapshotMaximumAgeSeconds;
  if (!validateBookFreshness(spot.book, record.recordedAt, maxAge).pass) throw new Error("Trial 9 stale spot book");
  if (!validateBookFreshness(perp.book, record.recordedAt, maxAge).pass) throw new Error("Trial 9 stale perpetual book");
  const hashes = [spot.hashes?.spec, spot.hashes?.productData, spot.hashes?.book, perp.hashes?.spec, perp.hashes?.productData, perp.hashes?.funding, perp.hashes?.book];
  if (hashes.some((hash) => !/^[0-9a-f]{64}$/i.test(String(hash ?? "")))) throw new Error("Trial 9 compact raw hash invalid");
}
function dataGate({ records, manifest, manifestHash, startMs, endMs, availableRawHashes }) {
  for (const record of records) validateRecord(record, manifestHash, manifest);
  const hourly = uniqueHourly(records, startMs, endMs);
  const expectedHours = Math.ceil((endMs - startMs) / HOUR_MS);
  const coverage = expectedHours ? hourly.length / expectedHours : 0;
  let maxGapMinutes = 0;
  for (let i = 1; i < hourly.length; i += 1) {
    maxGapMinutes = Math.max(maxGapMinutes, (Date.parse(hourly[i].recordedAt) - Date.parse(hourly[i - 1].recordedAt)) / 60_000);
  }
  const spotIds = [...new Set(records.map((record) => Number(record.sources.spot.productId)))];
  const perpIds = [...new Set(records.map((record) => Number(record.sources.perpetual.productId)))];
  const hashes = records.flatMap((record) => [record.sources.spot.hashes.spec, record.sources.spot.hashes.productData, record.sources.spot.hashes.book, record.sources.perpetual.hashes.spec, record.sources.perpetual.hashes.productData, record.sources.perpetual.hashes.funding, record.sources.perpetual.hashes.book]);
  const rawHashPass = hashes.every((hash) => availableRawHashes?.has?.(String(hash).toLowerCase()));
  const productIdentityPass = spotIds.length === 1 && perpIds.length === 1;
  const funding = productIdentityPass ? collectFunding(records, perpIds[0], startMs, endMs) : [];
  const expectedFunding = expectedFundingTimes(startMs, endMs);
  const observed = new Set(funding.map((event) => Date.parse(event.intervalEnd)));
  const missingFunding = expectedFunding.filter((time) => !observed.has(time));
  const pass = coverage >= manifest.dataGates.minimumHourlyCoverage
    && maxGapMinutes <= manifest.dataGates.maximumObservationGapMinutes
    && productIdentityPass
    && rawHashPass
    && missingFunding.length === 0;
  return {
    pass,
    hourlyRows: hourly.length,
    expectedHours,
    coverage,
    maxGapMinutes,
    productIdentityPass,
    spotProductId: spotIds.length === 1 ? spotIds[0] : null,
    perpetualProductId: perpIds.length === 1 ? perpIds[0] : null,
    rawHashPass,
    fundingCoverage: { expected: expectedFunding.length, observed: funding.length, missing: missingFunding.map((time) => new Date(time).toISOString()), pass: missingFunding.length === 0 },
    funding
  };
}
function sizePosition(entry, manifest) {
  const target = manifest.portfolio.startingEquityUsd * manifest.portfolio.targetNotionalPctOfStartingEquityPerLeg;
  const contractSize = manifest.venues.perpetualShort.contractSizeBtc;
  const reference = positive(entry.sources.perpetual.book.bestBidUsd, "entry perpetual best bid");
  const oneContractNotional = reference * contractSize;
  let contracts = Math.floor(target / oneContractNotional);
  if (contracts < 1 && oneContractNotional <= manifest.portfolio.startingEquityUsd * manifest.portfolio.maximumActualNotionalPctPerLeg) contracts = 1;
  if (contracts < 1) throw new Error("Trial 9 cannot size one perpetual contract within exposure cap");
  const btcQuantity = contracts * contractSize;
  const actualNotionalUsd = btcQuantity * reference;
  if (actualNotionalUsd > manifest.portfolio.startingEquityUsd * manifest.portfolio.maximumActualNotionalPctPerLeg + 1e-9) throw new Error("Trial 9 actual notional exceeds cap");
  return { contracts, btcQuantity, targetNotionalUsd: target, actualNotionalUsd };
}
function executionFees({ manifest, size, spotEntry, spotExit, stress }) {
  const knownSpotBps = finite(manifest.executionModel.publishedSpotExchangeClearingFeeBpsPerSide ?? manifest.executionModel.spotFeeBpsPerSide, "published spot fee");
  const knownPerpUsd = finite(manifest.executionModel.publishedPerpetualExchangeClearingFeeUsdPerContractPerSide ?? manifest.executionModel.perpetualFeeUsdPerContractPerSide, "published perp fee");
  const intermediarySpotBps = stress ? finite(manifest.executionModel.stressUnverifiedIntermediaryCostBpsPerSpotOrder ?? 0, "stress intermediary spot bps") : 0;
  const intermediaryPerpUsd = stress ? finite(manifest.executionModel.stressUnverifiedIntermediaryCostUsdPerPerpetualContractPerSide ?? 0, "stress intermediary perp fee") : 0;
  const entrySpot = size.btcQuantity * spotEntry * (knownSpotBps + intermediarySpotBps) / 10_000;
  const exitSpot = size.btcQuantity * spotExit * (knownSpotBps + intermediarySpotBps) / 10_000;
  const entryPerp = size.contracts * (knownPerpUsd + intermediaryPerpUsd);
  const exitPerp = size.contracts * (knownPerpUsd + intermediaryPerpUsd);
  return {
    knownSpotBps,
    knownPerpUsdPerContract: knownPerpUsd,
    intermediarySpotBps,
    intermediaryPerpUsdPerContract: intermediaryPerpUsd,
    entrySpot,
    exitSpot,
    entryPerp,
    exitPerp,
    entryTotal: entrySpot + entryPerp,
    exitTotal: exitSpot + exitPerp,
    total: entrySpot + exitSpot + entryPerp + exitPerp
  };
}
function scenario({ records, funding, entry, exit, startMs, endMs, manifest, stress }) {
  const size = sizePosition(entry, manifest);
  const spotBuy = executableVwap(entry.sources.spot.book, { action: "BUY", btcQuantity: size.btcQuantity });
  const perpSell = executableVwap(entry.sources.perpetual.book, { action: "SELL", btcQuantity: size.btcQuantity });
  const spotSell = executableVwap(exit.sources.spot.book, { action: "SELL", btcQuantity: size.btcQuantity });
  const perpBuy = executableVwap(exit.sources.perpetual.book, { action: "BUY", btcQuantity: size.btcQuantity });
  const executionPass = [spotBuy, perpSell, spotSell, perpBuy].every((fill) => fill.pass);
  if (!executionPass) return { executionPass: false, stress, size, executions: { spotBuy, perpSell, spotSell, perpBuy } };

  const extraBps = stress ? finite(manifest.executionModel.stressAdditionalAdverseBpsPerOrder, "stress extra adverse bps") : finite(manifest.executionModel.additionalPrimarySlippageBps ?? 0, "primary extra bps");
  const adverse = (price, action) => price * (1 + (action === "BUY" ? 1 : -1) * extraBps / 10_000);
  const spotEntry = adverse(spotBuy.vwapUsd, "BUY");
  const spotExit = adverse(spotSell.vwapUsd, "SELL");
  const perpetualEntry = adverse(perpSell.vwapUsd, "SELL");
  const perpetualExit = adverse(perpBuy.vwapUsd, "BUY");
  const fees = executionFees({ manifest, size, spotEntry, spotExit, stress });

  const spotPricePnl = size.btcQuantity * (spotExit - spotEntry);
  const perpetualPricePnl = size.btcQuantity * (perpetualEntry - perpetualExit);
  const fundingPnl = funding.reduce((sum, event) => sum + size.btcQuantity * event.markPrice * event.fundingRate, 0);
  const netPnl = spotPricePnl + perpetualPricePnl + fundingPnl - fees.total;
  const breakEvenFundingUsd = -(spotPricePnl + perpetualPricePnl - fees.total);

  const startingEquity = manifest.portfolio.startingEquityUsd;
  const collateral = startingEquity * manifest.portfolio.perpetualCollateralReservePctOfStartingEquity;
  const maintenancePct = manifest.marginStress.researchMaintenanceMarginPctOfPerpetualNotional;
  const stressStates = Object.fromEntries(manifest.marginStress.adverseRelativeBasisShockPct.map((shock) => [String(shock), { breached: false, minExcess: Infinity }]));
  let observedBreach = null;
  let cumulativeFunding = 0;
  let fundingIndex = 0;
  const orderedFunding = [...funding].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
  const equityPath = [{ time: startMs, equity: startingEquity }];

  for (const record of records) {
    const t = Date.parse(record.recordedAt);
    if (!(t >= startMs && t < endMs)) continue;
    while (fundingIndex < orderedFunding.length && Date.parse(orderedFunding[fundingIndex].intervalEnd) <= t) {
      const event = orderedFunding[fundingIndex++];
      cumulativeFunding += size.btcQuantity * event.markPrice * event.fundingRate;
    }
    const spotMid = positive(record.sources.spot.book.midpointUsd, "spot midpoint");
    const perpMid = positive(record.sources.perpetual.book.midpointUsd, "perpetual midpoint");
    const spotMarkPnl = size.btcQuantity * (spotMid - spotEntry) - fees.entrySpot;
    const perpetualMarkPnl = size.btcQuantity * (perpetualEntry - perpMid) - fees.entryPerp;
    const perpEquity = collateral + perpetualMarkPnl + cumulativeFunding;
    const maintenance = size.btcQuantity * perpMid * maintenancePct;
    const excess = perpEquity - maintenance;
    if (!observedBreach && excess < 0) observedBreach = { recordedAt: record.recordedAt, excessUsd: excess };
    for (const shock of manifest.marginStress.adverseRelativeBasisShockPct) {
      const stressedPerp = perpMid * (1 + shock);
      const stressedPnl = size.btcQuantity * (perpetualEntry - stressedPerp) - fees.entryPerp;
      const stressedExcess = collateral + stressedPnl + cumulativeFunding - size.btcQuantity * stressedPerp * maintenancePct;
      const state = stressStates[String(shock)];
      state.minExcess = Math.min(state.minExcess, stressedExcess);
      if (stressedExcess < 0) state.breached = true;
    }
    equityPath.push({ time: t, equity: startingEquity + spotMarkPnl + perpetualMarkPnl + cumulativeFunding });
  }
  equityPath.push({ time: endMs, equity: startingEquity + netPnl });
  equityPath.sort((a, b) => a.time - b.time);

  let peak = startingEquity;
  let maxDrawdown = 0;
  for (const point of equityPath) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const dailyReturns = [];
  let priorEquity = startingEquity;
  for (let boundary = startMs + DAY_MS; boundary <= endMs; boundary += DAY_MS) {
    const equity = equityPath.filter((point) => point.time <= boundary).at(-1)?.equity ?? priorEquity;
    dailyReturns.push(equity / priorEquity - 1);
    priorEquity = equity;
  }
  const sd = stdev(dailyReturns);
  const downside = Math.sqrt(mean(dailyReturns.map((value) => Math.min(value, 0) ** 2)));
  const elapsedDays = (endMs - startMs) / DAY_MS;
  const netReturn = netPnl / startingEquity;
  const windows30d = [];
  for (let i = 0; i < 3 && startMs + i * 30 * DAY_MS < endMs; i += 1) {
    const ws = startMs + i * 30 * DAY_MS;
    const we = Math.min(ws + 30 * DAY_MS, endMs);
    if (we - ws < 29 * DAY_MS) continue;
    const before = equityPath.filter((point) => point.time <= ws).at(-1)?.equity ?? startingEquity;
    const after = equityPath.filter((point) => point.time <= we).at(-1)?.equity ?? before;
    windows30d.push({ start: new Date(ws).toISOString(), end: new Date(we).toISOString(), pnl: after - before, positive: after > before });
  }

  return {
    executionPass: true,
    stress,
    feeBasis: stress ? "KNOWN_EXCHANGE_CLEARING_PLUS_UNVERIFIED_INTERMEDIARY_RESERVE" : "KNOWN_EXCHANGE_CLEARING_ONLY",
    size,
    executions: { spotBuy, perpSell, spotSell, perpBuy },
    fills: { spotEntry, spotExit, perpetualEntry, perpetualExit },
    fees,
    pnl: {
      spotPrice: spotPricePnl,
      perpetualPrice: perpetualPricePnl,
      rawBasis: spotPricePnl + perpetualPricePnl,
      funding: fundingPnl,
      explicitFees: fees.total,
      breakEvenFundingUsd,
      fundingExcessOverBreakEvenUsd: fundingPnl - breakEvenFundingUsd,
      net: netPnl
    },
    stats: {
      finalEquity: startingEquity + netPnl,
      netReturn,
      annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1,
      sharpe: sd > 0 ? Math.sqrt(365) * mean(dailyReturns) / sd : 0,
      sortino: downside > 0 ? Math.sqrt(365) * mean(dailyReturns) / downside : 0,
      maxDrawdown
    },
    margin: {
      observedBreach,
      stress: stressStates,
      allFrozenStressesPass: Object.values(stressStates).every((state) => !state.breached)
    },
    windows30d,
    equityPath
  };
}

export function evaluateInternalCarry({ manifest, manifestHash, records, availableRawHashes, mode, evaluationNowMs = Date.now() }) {
  const durations = { screen: 7, primary: 30, extended: 90 };
  if (manifest.experimentId !== "bitnomial-internal-carry-v1" || manifest.trialNumber !== 9) throw new Error("Unexpected Trial 9 manifest");
  if (!(mode in durations)) throw new Error("Trial 9 mode must be screen, primary, or extended");
  const startMs = Date.parse(manifest.forwardWindow?.startInclusive);
  if (!Number.isFinite(startMs)) throw new Error("Trial 9 manifest is not frozen with a startInclusive boundary");
  const endMs = startMs + durations[mode] * DAY_MS;
  const notBeforeMs = endMs + manifest.dataGates.fundingDiscoveryLookaheadMinutes * 60_000;
  if (evaluationNowMs < notBeforeMs) throw new Error(`Refusing Trial 9 ${mode} evaluation before ${new Date(notBeforeMs).toISOString()}`);

  records = [...records].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const gate = dataGate({ records, manifest, manifestHash, startMs, endMs, availableRawHashes });
  const toleranceMs = manifest.dataGates.entryExitToleranceMinutes * 60_000;
  const entry = firstAtOrAfter(records, startMs, toleranceMs);
  const exit = firstAtOrAfter(records, endMs, toleranceMs);
  const boundaryPass = Boolean(entry && exit);
  const dataGateResult = { ...gate, boundaryPass, pass: gate.pass && boundaryPass };
  const base = {
    experimentId: manifest.experimentId,
    trialNumber: 9,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    frozenWindow: { startInclusive: new Date(startMs).toISOString(), endInclusiveForFunding: new Date(endMs).toISOString(), durationDays: durations[mode] },
    dataGate: dataGateResult
  };
  if (!dataGateResult.pass) return { ...base, classification: "FAILED_DATA_GATE", economicsCalculated: false };

  const primary = scenario({ records, funding: gate.funding, entry, exit, startMs, endMs, manifest, stress: false });
  const costStress = scenario({ records, funding: gate.funding, entry, exit, startMs, endMs, manifest, stress: true });
  if (!primary.executionPass || !costStress.executionPass) {
    return { ...base, classification: "FAILED_EXECUTION_DEPTH_GATE", economicsCalculated: false, execution: { primary, costStress } };
  }

  const commonPass = primary.pnl.net > 0
    && primary.pnl.funding > 0
    && primary.pnl.fundingExcessOverBreakEvenUsd > 0
    && costStress.pnl.net > 0
    && primary.stats.maxDrawdown > -0.10
    && !primary.margin.observedBreach
    && primary.margin.allFrozenStressesPass;

  let classification;
  if (mode === "screen") {
    classification = commonPass ? "VIABILITY_SCREEN_PASS_NONPROMOTIONAL" : "FAILED_VIABILITY_SCREEN";
  } else if (mode === "primary") {
    classification = commonPass ? manifest.evidenceDesign.primaryForwardStrongestClassification : "FAILED_PRIMARY_FORWARD_GATE";
  } else {
    const consistencyPass = primary.windows30d.length === 3 && primary.windows30d.filter((window) => window.positive).length >= 2;
    const returnPass = primary.stats.annualizedReturn >= 0.02;
    if (!(commonPass && consistencyPass && returnPass)) classification = "FAILED_EXTENDED_VALIDATION_GATE";
    else if (manifest.evidenceDesign.promotionRequiresVerifiedActualIntermediaryFeeSchedule && manifest.executionModel.intermediaryFeeStatus !== "VERIFIED") classification = "PROMISING_90D_BLOCKED_INTERMEDIARY_FEE_VERIFICATION";
    else classification = manifest.evidenceDesign.extendedValidationStrongestClassification;
  }

  return {
    ...base,
    classification,
    economicsCalculated: true,
    intermediaryFeeStatus: manifest.executionModel.intermediaryFeeStatus,
    primary,
    costStress
  };
}
