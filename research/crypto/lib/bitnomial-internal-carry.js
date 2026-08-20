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
    .filter((r) => {
      const t = Date.parse(r.recordedAt);
      return Number.isFinite(t) && t >= boundaryMs && t <= boundaryMs + toleranceMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0] ?? null;
}
function uniqueHourly(records, startMs, endMs) {
  const byHour = new Map();
  for (const record of records) {
    const t = Date.parse(record.recordedAt);
    if (!Number.isFinite(t) || t < startMs || t >= endMs) continue;
    const bucket = Math.floor(t / HOUR_MS) * HOUR_MS;
    const prior = byHour.get(bucket);
    if (!prior || t < Date.parse(prior.recordedAt)) byHour.set(bucket, record);
  }
  return [...byHour.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}
function expectedFundingTimes(startMs, endMs) {
  const times = [];
  let cursor = Math.floor(startMs / (8 * HOUR_MS)) * (8 * HOUR_MS) + 8 * HOUR_MS;
  while (cursor <= endMs) {
    if (cursor > startMs) times.push(cursor);
    cursor += 8 * HOUR_MS;
  }
  return times;
}
function collectFunding(records, productId, startMs, endMs) {
  const map = new Map();
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
      const prior = map.get(end);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) throw new Error(`Trial 9 conflicting funding event at ${normalized.intervalEnd}`);
      map.set(end, normalized);
    }
  }
  return [...map.values()].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
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
  const freshnessLimit = manifest.dataGates.bookSnapshotMaximumAgeSeconds;
  if (!validateBookFreshness(spot.book, record.recordedAt, freshnessLimit).pass) throw new Error("Trial 9 stale spot book");
  if (!validateBookFreshness(perp.book, record.recordedAt, freshnessLimit).pass) throw new Error("Trial 9 stale perpetual book");
  const hashes = [spot.hashes?.spec, spot.hashes?.productData, spot.hashes?.book, perp.hashes?.spec, perp.hashes?.productData, perp.hashes?.funding, perp.hashes?.book];
  if (hashes.some((hash) => !/^[0-9a-f]{64}$/i.test(String(hash ?? "")))) throw new Error("Trial 9 compact raw hash invalid");
}
function dataGate({ records, manifest, manifestHash, startMs, endMs, availableRawHashes }) {
  for (const record of records) validateRecord(record, manifestHash, manifest);
  const hourly = uniqueHourly(records, startMs, endMs);
  const expectedHours = Math.ceil((endMs - startMs) / HOUR_MS);
  const coverage = expectedHours ? hourly.length / expectedHours : 0;
  let maxGapMinutes = 0;
  for (let i = 1; i < hourly.length; i += 1) maxGapMinutes = Math.max(maxGapMinutes, (Date.parse(hourly[i].recordedAt) - Date.parse(hourly[i - 1].recordedAt)) / 60_000);
  const spotIds = [...new Set(records.map((r) => Number(r.sources.spot.productId)))];
  const perpIds = [...new Set(records.map((r) => Number(r.sources.perpetual.productId)))];
  const hashes = records.flatMap((r) => [r.sources.spot.hashes.spec, r.sources.spot.hashes.productData, r.sources.spot.hashes.book, r.sources.perpetual.hashes.spec, r.sources.perpetual.hashes.productData, r.sources.perpetual.hashes.funding, r.sources.perpetual.hashes.book]);
  const rawHashPass = hashes.every((hash) => availableRawHashes?.has?.(String(hash).toLowerCase()));
  const productIdentityPass = spotIds.length === 1 && perpIds.length === 1;
  const funding = productIdentityPass ? collectFunding(records, perpIds[0], startMs, endMs) : [];
  const expectedFunding = expectedFundingTimes(startMs, endMs);
  const observedFunding = new Set(funding.map((event) => Date.parse(event.intervalEnd)));
  const missingFunding = expectedFunding.filter((time) => !observedFunding.has(time));
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
    fundingCoverage: { expected: expectedFunding.length, observed: funding.length, missing: missingFunding.map((t) => new Date(t).toISOString()), pass: missingFunding.length === 0 },
    funding
  };
}
function size(entry, manifest) {
  const target = manifest.portfolio.startingEquityUsd * manifest.portfolio.targetNotionalPctOfStartingEquityPerLeg;
  const contractSize = manifest.venues.perpetualShort.contractSizeBtc;
  const reference = positive(entry.sources.perpetual.book.bestBidUsd, "entry perpetual best bid");
  const oneContractNotional = reference * contractSize;
  let contracts = Math.floor(target / oneContractNotional);
  if (contracts < 1 && oneContractNotional <= manifest.portfolio.startingEquityUsd * manifest.portfolio.maximumActualNotionalPctPerLeg) contracts = 1;
  if (contracts < 1) throw new Error("Trial 9 cannot size one perpetual contract within exposure cap");
  const btcQuantity = contracts * contractSize;
  const actualNotional = btcQuantity * reference;
  if (actualNotional > manifest.portfolio.startingEquityUsd * manifest.portfolio.maximumActualNotionalPctPerLeg + 1e-9) throw new Error("Trial 9 actual notional exceeds cap");
  return { contracts, btcQuantity, targetNotionalUsd: target, actualNotionalUsd: actualNotional };
}
function runScenario({ records, funding, entry, exit, startMs, endMs, manifest, stress }) {
  const s = size(entry, manifest);
  const spotBuy = executableVwap(entry.sources.spot.book, { action: "BUY", btcQuantity: s.btcQuantity });
  const perpSell = executableVwap(entry.sources.perpetual.book, { action: "SELL", btcQuantity: s.btcQuantity });
  const spotSell = executableVwap(exit.sources.spot.book, { action: "SELL", btcQuantity: s.btcQuantity });
  const perpBuy = executableVwap(exit.sources.perpetual.book, { action: "BUY", btcQuantity: s.btcQuantity });
  const executionPass = [spotBuy, perpSell, spotSell, perpBuy].every((x) => x.pass);
  if (!executionPass) return { executionPass: false, size: s, executions: { spotBuy, perpSell, spotSell, perpBuy } };

  const shockBps = stress ? manifest.executionModel.stressAdditionalAdverseBpsPerOrder : 0;
  const adverse = (price, action) => price * (1 + (action === "BUY" ? 1 : -1) * shockBps / 10_000);
  const spotEntry = adverse(spotBuy.vwapUsd, "BUY");
  const spotExit = adverse(spotSell.vwapUsd, "SELL");
  const perpEntry = adverse(perpSell.vwapUsd, "SELL");
  const perpExit = adverse(perpBuy.vwapUsd, "BUY");
  const spotFeeBps = manifest.executionModel.spotFeeBpsPerSide;
  const spotFees = s.btcQuantity * spotEntry * spotFeeBps / 10_000 + s.btcQuantity * spotExit * spotFeeBps / 10_000;
  const perpFees = s.contracts * manifest.executionModel.perpetualFeeUsdPerContractPerSide * 2;
  const spotPnl = s.btcQuantity * (spotExit - spotEntry);
  const perpPnl = s.btcQuantity * (perpEntry - perpExit);
  const fundingPnl = funding.reduce((sum, event) => sum + s.btcQuantity * event.markPrice * event.fundingRate, 0);
  const fees = spotFees + perpFees;
  const netPnl = spotPnl + perpPnl + fundingPnl - fees;

  const startingEquity = manifest.portfolio.startingEquityUsd;
  const collateral = startingEquity * manifest.portfolio.perpetualCollateralReservePctOfStartingEquity;
  const maintenancePct = manifest.marginStress.researchMaintenanceMarginPctOfPerpetualNotional;
  const stressStates = Object.fromEntries(manifest.marginStress.adverseRelativeBasisShockPct.map((v) => [String(v), { breached: false, minExcess: Infinity }]));
  let observedBreach = null;
  let cumulativeFunding = 0;
  let fundingIndex = 0;
  const path = [{ time: startMs, equity: startingEquity }];
  const orderedFunding = [...funding].sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
  for (const record of records) {
    const t = Date.parse(record.recordedAt);
    if (!(t >= startMs && t < endMs)) continue;
    while (fundingIndex < orderedFunding.length && Date.parse(orderedFunding[fundingIndex].intervalEnd) <= t) {
      const event = orderedFunding[fundingIndex++];
      cumulativeFunding += s.btcQuantity * event.markPrice * event.fundingRate;
    }
    const spotMid = positive(record.sources.spot.book.midpointUsd, "spot midpoint");
    const perpMid = positive(record.sources.perpetual.book.midpointUsd, "perpetual midpoint");
    const spotMarkPnl = s.btcQuantity * (spotMid - spotEntry) - s.btcQuantity * spotEntry * spotFeeBps / 10_000;
    const perpMarkPnl = s.btcQuantity * (perpEntry - perpMid);
    const perpEquity = collateral + perpMarkPnl + cumulativeFunding;
    const maintenance = s.btcQuantity * perpMid * maintenancePct;
    const excess = perpEquity - maintenance;
    if (!observedBreach && excess < 0) observedBreach = { recordedAt: record.recordedAt, excessUsd: excess };
    for (const shock of manifest.marginStress.adverseRelativeBasisShockPct) {
      const stressedPerp = perpMid * (1 + shock);
      const stressedPnl = s.btcQuantity * (perpEntry - stressedPerp);
      const stressedExcess = collateral + stressedPnl + cumulativeFunding - s.btcQuantity * stressedPerp * maintenancePct;
      const state = stressStates[String(shock)];
      state.minExcess = Math.min(state.minExcess, stressedExcess);
      if (stressedExcess < 0) state.breached = true;
    }
    path.push({ time: t, equity: startingEquity + spotMarkPnl + perpMarkPnl + cumulativeFunding });
  }
  path.push({ time: endMs, equity: startingEquity + netPnl });
  path.sort((a, b) => a.time - b.time);
  let peak = startingEquity, maxDrawdown = 0;
  for (const point of path) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const dailyReturns = [];
  let prev = startingEquity;
  for (let t = startMs + DAY_MS; t <= endMs; t += DAY_MS) {
    const equity = path.filter((p) => p.time <= t).at(-1)?.equity ?? prev;
    dailyReturns.push(equity / prev - 1);
    prev = equity;
  }
  const sd = stdev(dailyReturns);
  const downside = Math.sqrt(mean(dailyReturns.map((v) => Math.min(v, 0) ** 2)));
  const elapsedDays = (endMs - startMs) / DAY_MS;
  const netReturn = netPnl / startingEquity;
  const windows30d = [];
  for (let i = 0; i < 3 && startMs + i * 30 * DAY_MS < endMs; i += 1) {
    const ws = startMs + i * 30 * DAY_MS;
    const we = Math.min(ws + 30 * DAY_MS, endMs);
    if (we - ws < 29 * DAY_MS) continue;
    const before = path.filter((p) => p.time <= ws).at(-1)?.equity ?? startingEquity;
    const after = path.filter((p) => p.time <= we).at(-1)?.equity ?? before;
    windows30d.push({ start: new Date(ws).toISOString(), end: new Date(we).toISOString(), pnl: after - before, positive: after > before });
  }
  return {
    executionPass: true,
    stress,
    size: s,
    executions: { spotBuy, perpSell, spotSell, perpBuy },
    fills: { spotEntry, spotExit, perpetualEntry: perpEntry, perpetualExit: perpExit },
    pnl: { spotPrice: spotPnl, perpetualPrice: perpPnl, rawBasis: spotPnl + perpPnl, funding: fundingPnl, explicitFees: fees, net: netPnl },
    stats: {
      finalEquity: startingEquity + netPnl,
      netReturn,
      annualizedReturn: (1 + netReturn) ** (365 / elapsedDays) - 1,
      sharpe: sd > 0 ? Math.sqrt(365) * mean(dailyReturns) / sd : 0,
      sortino: downside > 0 ? Math.sqrt(365) * mean(dailyReturns) / downside : 0,
      maxDrawdown
    },
    margin: { observedBreach, stress: stressStates, allFrozenStressesPass: Object.values(stressStates).every((x) => !x.breached) },
    windows30d,
    equityPath: path
  };
}

export function evaluateInternalCarry({ manifest, manifestHash, records, availableRawHashes, mode, evaluationNowMs = Date.now() }) {
  const modes = { screen: 7, primary: 30, extended: 90 };
  if (manifest.experimentId !== "bitnomial-internal-carry-v1" || manifest.trialNumber !== 9) throw new Error("Unexpected Trial 9 manifest");
  if (!(mode in modes)) throw new Error("Trial 9 mode must be screen, primary, or extended");
  const startMs = Date.parse(manifest.forwardWindow?.startInclusive);
  if (!Number.isFinite(startMs)) throw new Error("Trial 9 manifest is not frozen with a startInclusive boundary");
  const endMs = startMs + modes[mode] * DAY_MS;
  const delay = manifest.dataGates.fundingDiscoveryLookaheadMinutes * 60_000;
  if (evaluationNowMs < endMs + delay) throw new Error(`Refusing Trial 9 ${mode} evaluation before ${new Date(endMs + delay).toISOString()}`);
  records = [...records].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const gate = dataGate({ records, manifest, manifestHash, startMs, endMs, availableRawHashes });
  const toleranceMs = manifest.dataGates.entryExitToleranceMinutes * 60_000;
  const entry = firstAtOrAfter(records, startMs, toleranceMs);
  const exit = firstAtOrAfter(records, endMs, toleranceMs);
  const boundaryPass = Boolean(entry && exit);
  const base = {
    experimentId: manifest.experimentId,
    trialNumber: 9,
    mode,
    paperOnly: true,
    livePromotionAllowed: false,
    frozenWindow: { startInclusive: new Date(startMs).toISOString(), endInclusiveForFunding: new Date(endMs).toISOString(), durationDays: modes[mode] },
    dataGate: { ...gate, boundaryPass, pass: gate.pass && boundaryPass }
  };
  if (!base.dataGate.pass) return { ...base, classification: "FAILED_DATA_GATE", economicsCalculated: false };
  const primary = runScenario({ records, funding: gate.funding, entry, exit, startMs, endMs, manifest, stress: false });
  const costStress = runScenario({ records, funding: gate.funding, entry, exit, startMs, endMs, manifest, stress: true });
  if (!primary.executionPass || !costStress.executionPass) return { ...base, classification: "FAILED_EXECUTION_DEPTH_GATE", economicsCalculated: false, execution: { primary, costStress } };
  const commonPass = primary.pnl.net > 0
    && primary.pnl.funding > 0
    && costStress.pnl.net > 0
    && primary.stats.maxDrawdown > -0.10
    && !primary.margin.observedBreach
    && primary.margin.allFrozenStressesPass;
  let classification;
  if (mode === "screen") classification = commonPass ? "VIABILITY_SCREEN_PASS_NONPROMOTIONAL" : "FAILED_VIABILITY_SCREEN";
  else if (mode === "primary") classification = commonPass ? manifest.evidenceDesign.primaryForwardStrongestClassification : "FAILED_PRIMARY_FORWARD_GATE";
  else {
    const consistencyPass = primary.windows30d.length === 3 && primary.windows30d.filter((w) => w.positive).length >= 2;
    const returnPass = primary.stats.annualizedReturn >= 0.02;
    classification = commonPass && consistencyPass && returnPass
      ? manifest.evidenceDesign.extendedValidationStrongestClassification
      : "FAILED_EXTENDED_VALIDATION_GATE";
  }
  return { ...base, classification, economicsCalculated: true, primary, costStress };
}
