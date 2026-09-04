import fs from 'node:fs';
import crypto from 'node:crypto';

// Research-only evaluator for frozen funding-carry-v1.
// Required synchronized columns are produced by prepare-carry-data.py and contain
// separate historical execution and valuation references. No interpolation is allowed.

const manifestPath = process.argv[2] ?? 'research/crypto/manifests/funding-carry-v1.json';
const dataPath = process.argv[3];
if (!dataPath) throw new Error('Usage: node research/crypto/carry-evaluate.js <manifest.json> <synchronized.csv>');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-v1' || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error('Refusing to evaluate a non-frozen/non-research carry manifest');
}
if (!manifest.historicalRobustnessWindow?.startInclusive || !manifest.historicalRobustnessWindow?.endExclusive) {
  throw new Error('Carry evaluation window must be frozen in the manifest before evaluation');
}

const raw = fs.readFileSync(dataPath);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const startMs = Date.parse(manifest.historicalRobustnessWindow.startInclusive);
const endMs = Date.parse(manifest.historicalRobustnessWindow.endExclusive);
const eightHoursMs = 8 * 60 * 60 * 1000;
const fundingSkewToleranceMs = Number(manifest.dataRequirements?.fundingTimestampNormalization?.maximumAbsoluteSkewMs);
if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid frozen carry window');
if (!Number.isFinite(fundingSkewToleranceMs) || fundingSkewToleranceMs < 0) throw new Error('Invalid frozen funding timestamp tolerance');
if ((endMs - startMs) % eightHoursMs !== 0) throw new Error('Frozen carry window is not an exact 8-hour grid');
const expectedRows = (endMs - startMs) / eightHoursMs;

function nearestFundingBoundary(rawTimestamp) {
  return Math.round(rawTimestamp / eightHoursMs) * eightHoursMs;
}

function parseCsv(buffer) {
  const lines = buffer.toString('utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((value) => value.trim());
  const required = [
    'timestamp',
    'raw_funding_timestamp',
    'funding_timestamp_skew_ms',
    'spot_price',
    'perp_exec_price',
    'perp_mark_price',
    'funding_rate'
  ];
  for (const column of required) if (!header.includes(column)) throw new Error(`Missing required column ${column}`);
  const indexes = Object.fromEntries(header.map((name, i) => [name, i]));
  const parsed = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const timestamp = Date.parse(cells[indexes.timestamp]);
    const rawFundingTimestamp = Date.parse(cells[indexes.raw_funding_timestamp]);
    const fundingTimestampSkewMs = Number(cells[indexes.funding_timestamp_skew_ms]);
    const spot = Number(cells[indexes.spot_price]);
    const perpExec = Number(cells[indexes.perp_exec_price]);
    const perpMark = Number(cells[indexes.perp_mark_price]);
    const funding = Number(cells[indexes.funding_rate]);
    const validNumbers = [timestamp, rawFundingTimestamp, fundingTimestampSkewMs, spot, perpExec, perpMark, funding].every(Number.isFinite);
    if (!validNumbers || spot <= 0 || perpExec <= 0 || perpMark <= 0) {
      throw new Error(`Invalid synchronized row: ${line.slice(0, 220)}`);
    }
    const observedSkew = rawFundingTimestamp - timestamp;
    if (Math.abs(observedSkew - fundingTimestampSkewMs) > 0.5) {
      throw new Error(`Funding timestamp skew provenance mismatch at ${cells[indexes.timestamp]}`);
    }
    if (Math.abs(fundingTimestampSkewMs) > fundingSkewToleranceMs) {
      throw new Error(`Funding timestamp exceeds frozen skew tolerance at ${cells[indexes.timestamp]}`);
    }
    if (nearestFundingBoundary(rawFundingTimestamp) !== timestamp) {
      throw new Error(`Raw funding timestamp does not map to scheduled boundary at ${cells[indexes.timestamp]}`);
    }
    if (timestamp >= startMs && timestamp < endMs) {
      parsed.push({ timestamp, rawFundingTimestamp, fundingTimestampSkewMs, spot, perpExec, perpMark, funding });
    }
  }
  parsed.sort((a, b) => a.timestamp - b.timestamp);
  if (parsed.length !== expectedRows) throw new Error(`Expected ${expectedRows} frozen rows, found ${parsed.length}`);
  if (parsed[0].timestamp !== startMs || parsed.at(-1).timestamp !== endMs - eightHoursMs) {
    throw new Error('Synchronized input does not cover the exact frozen carry window');
  }
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].timestamp - parsed[i - 1].timestamp !== eightHoursMs) {
      throw new Error(`Missing/duplicate normalized funding boundary near ${new Date(parsed[i].timestamp).toISOString()}`);
    }
  }
  return parsed;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function stdev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1));
}
function fill(price, side, cost) {
  const adverseBps = cost.slippageBpsPerSide + cost.spreadBpsRoundTrip / 2;
  return price * (1 + (side === 'buy' ? 1 : -1) * adverseBps / 10_000);
}
function dailyLast(series) {
  const byDay = new Map();
  for (const point of series) byDay.set(Math.floor(point.time / 86_400_000), point);
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}
function metrics(series, startValue, fees, firstTimestamp) {
  const daily = dailyLast(series);
  let previous = startValue;
  const returns = [];
  let peak = startValue;
  let maxDrawdown = 0;
  for (const point of daily) {
    returns.push(point.equity / previous - 1);
    previous = point.equity;
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const endValue = daily.at(-1)?.equity ?? startValue;
  const elapsedDays = Math.max(1, ((daily.at(-1)?.time ?? firstTimestamp) - firstTimestamp) / 86_400_000);
  const annualizedReturn = (endValue / startValue) ** (365 / elapsedDays) - 1;
  const sd = stdev(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideSd = stdev(downside);
  return {
    netReturn: endValue / startValue - 1,
    annualizedReturn,
    sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
    sortino: downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null,
    fees,
    feeDrag: fees / startValue,
    startValue,
    endValue,
    elapsedDays
  };
}

const rows = parseCsv(raw);
const startingCash = 10_000;
const spotNotional = startingCash * manifest.candidate.spotNotionalPctAtEntry;
const collateral = startingCash * manifest.candidate.futuresCollateralReservePct;
const spotCost = {
  feeBpsPerSide: manifest.costModel.spotFeeBpsPerSide,
  slippageBpsPerSide: manifest.costModel.spotSlippageBpsPerSide,
  spreadBpsRoundTrip: manifest.costModel.spotSpreadBpsRoundTrip
};
const perpCost = {
  feeBpsPerSide: manifest.costModel.perpetualFeeBpsPerSide,
  slippageBpsPerSide: manifest.costModel.perpetualSlippageBpsPerSide,
  spreadBpsRoundTrip: manifest.costModel.perpetualSpreadBpsRoundTrip
};

const first = rows[0];
const last = rows.at(-1);
const spotEntryFill = fill(first.spot, 'buy', spotCost);
const units = spotNotional / spotEntryFill;
const spotEntryFee = spotNotional * spotCost.feeBpsPerSide / 10_000;

// Equal BTC units are the frozen hedge. The short's USD notional is not independently targeted.
const perpEntryFill = fill(first.perpExec, 'sell', perpCost);
const perpEntryNotional = units * perpEntryFill;
const perpEntryFee = perpEntryNotional * perpCost.feeBpsPerSide / 10_000;
const freeCash = startingCash - spotNotional - spotEntryFee - collateral - perpEntryFee;
if (freeCash < 0) throw new Error('Frozen collateral/notional settings exceed starting cash after entry friction');

let fundingPnl = 0;
let fees = spotEntryFee + perpEntryFee;
let marginBreach = null;
const equitySeries = [];
const gapStress = Object.fromEntries(
  manifest.marginStress.additionalGapStressPct.map((gap) => [String(gap), { breached: false, minimumExcessMargin: Infinity }])
);

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  if (index > 0) fundingPnl += units * row.perpMark * row.funding;

  const spotValue = units * row.spot;
  const perpUnrealizedPnl = units * (perpEntryFill - row.perpMark);
  const futuresEquity = collateral + perpUnrealizedPnl + fundingPnl;
  const maintenance = units * row.perpMark * manifest.marginStress.maintenanceMarginPctOfPerpetualNotional;
  if (!marginBreach && futuresEquity < maintenance) {
    marginBreach = {
      timestamp: new Date(row.timestamp).toISOString(),
      futuresEquity,
      maintenance,
      perpMark: row.perpMark
    };
  }

  for (const gap of manifest.marginStress.additionalGapStressPct) {
    const stressedMark = row.perpMark * (1 + gap);
    const stressedPnl = units * (perpEntryFill - stressedMark);
    const stressedEquity = collateral + stressedPnl + fundingPnl;
    const stressedMaintenance = units * stressedMark * manifest.marginStress.maintenanceMarginPctOfPerpetualNotional;
    const excess = stressedEquity - stressedMaintenance;
    gapStress[String(gap)].minimumExcessMargin = Math.min(gapStress[String(gap)].minimumExcessMargin, excess);
    if (excess < 0) gapStress[String(gap)].breached = true;
  }

  equitySeries.push({
    time: row.timestamp,
    equity: freeCash + spotValue + futuresEquity,
    spotPrice: row.spot,
    spotValue,
    perpExecutionReference: row.perpExec,
    perpMark: row.perpMark,
    contractVsSpotPct: row.perpExec / row.spot - 1,
    markVsSpotPct: row.perpMark / row.spot - 1,
    markVsContractPct: row.perpMark / row.perpExec - 1,
    fundingRate: row.funding,
    fundingPnl,
    perpUnrealizedPnl,
    futuresEquity,
    maintenance,
    marginExcess: futuresEquity - maintenance
  });
}

const spotExitFill = fill(last.spot, 'sell', spotCost);
const perpExitFill = fill(last.perpExec, 'buy', perpCost);
const spotExitGross = units * spotExitFill;
const spotExitFee = spotExitGross * spotCost.feeBpsPerSide / 10_000;
const perpExitNotional = units * perpExitFill;
const perpExitFee = perpExitNotional * perpCost.feeBpsPerSide / 10_000;
fees += spotExitFee + perpExitFee;
const realizedPerpPnl = units * (perpEntryFill - perpExitFill);
const finalEquity = freeCash + (spotExitGross - spotExitFee) + collateral + realizedPerpPnl + fundingPnl - perpExitFee;
equitySeries.push({ time: last.timestamp + 1, equity: finalEquity, isFinalExit: true });

// Comparator: identical spot units/costs but no futures or funding leg.
const buyHoldFreeCash = startingCash - spotNotional - spotEntryFee;
const buyHoldFinalEquity = buyHoldFreeCash + spotExitGross - spotExitFee;
const buyHoldSeries = [
  { time: first.timestamp, equity: buyHoldFreeCash + units * first.spot },
  { time: last.timestamp, equity: buyHoldFreeCash + units * last.spot },
  { time: last.timestamp + 1, equity: buyHoldFinalEquity }
];
const cashSeries = [
  { time: first.timestamp, equity: startingCash },
  { time: last.timestamp + 1, equity: startingCash }
];

const spotLegPnlAfterFees = spotExitGross - spotExitFee - spotNotional - spotEntryFee;
const perpetualLegPnlAfterFees = realizedPerpPnl - perpEntryFee - perpExitFee;
const carryMetrics = metrics(equitySeries, startingCash, fees, first.timestamp);
const buyHoldMetrics = metrics(buyHoldSeries, startingCash, spotEntryFee + spotExitFee, first.timestamp);
const cashMetrics = metrics(cashSeries, startingCash, 0, first.timestamp);

const dailyDiagnostics = dailyLast(equitySeries.filter((point) => !point.isFinalExit)).map((point) => ({
  timestamp: new Date(point.time).toISOString(),
  equity: point.equity,
  spotPrice: point.spotPrice,
  spotValue: point.spotValue,
  perpExecutionReference: point.perpExecutionReference,
  perpMark: point.perpMark,
  contractVsSpotPct: point.contractVsSpotPct,
  markVsSpotPct: point.markVsSpotPct,
  markVsContractPct: point.markVsContractPct,
  fundingRate: point.fundingRate,
  cumulativeFundingPnl: point.fundingPnl,
  perpUnrealizedPnl: point.perpUnrealizedPnl,
  futuresEquity: point.futuresEquity,
  maintenance: point.maintenance,
  marginExcess: point.marginExcess
}));

const maxFundingTimestampSkewMs = Math.max(...rows.map((row) => Math.abs(row.fundingTimestampSkewMs)));
const result = {
  experimentId: manifest.experimentId,
  trialNumber: manifest.trialNumber,
  generatedAt: new Date().toISOString(),
  paperOnly: true,
  livePromotionAllowed: false,
  input: {
    path: dataPath,
    sha256,
    rows: rows.length,
    expectedRows,
    frozenWindowStart: manifest.historicalRobustnessWindow.startInclusive,
    frozenWindowEndExclusive: manifest.historicalRobustnessWindow.endExclusive,
    firstSynchronizedTimestamp: new Date(first.timestamp).toISOString(),
    lastSynchronizedTimestamp: new Date(last.timestamp).toISOString(),
    firstRawFundingTimestamp: new Date(first.rawFundingTimestamp).toISOString(),
    lastRawFundingTimestamp: new Date(last.rawFundingTimestamp).toISOString(),
    maxAbsoluteFundingTimestampSkewMs: maxFundingTimestampSkewMs,
    fundingTimestampToleranceMs: fundingSkewToleranceMs,
    exactEightHourGridVerified: true
  },
  frozenPosition: {
    btcUnits: units,
    spotEntryReference: first.spot,
    spotEntryFill,
    perpEntryExecutionReference: first.perpExec,
    perpEntryMark: first.perpMark,
    perpEntryFill,
    spotEntryNotional: spotNotional,
    perpEntryNotional,
    perpEntryNotionalPctOfStartingEquity: perpEntryNotional / startingCash,
    futuresCollateral: collateral,
    initialCapitalCommittedPct: (spotNotional + collateral + spotEntryFee + perpEntryFee) / startingCash
  },
  basisDiagnostics: {
    entryContractVsSpotPct: first.perpExec / first.spot - 1,
    entryMarkVsSpotPct: first.perpMark / first.spot - 1,
    exitContractVsSpotPct: last.perpExec / last.spot - 1,
    exitMarkVsSpotPct: last.perpMark / last.spot - 1,
    entryMarkVsContractPct: first.perpMark / first.perpExec - 1,
    exitMarkVsContractPct: last.perpMark / last.perpExec - 1
  },
  pnlDecomposition: {
    fundingPnl,
    spotLegPnlAfterFees,
    perpetualLegPnlAfterFees,
    priceHedgePnlAfterFees: spotLegPnlAfterFees + perpetualLegPnlAfterFees,
    totalFees: fees,
    finalEquity
  },
  margin: {
    breached: Boolean(marginBreach),
    strategyValidWithoutHistoricalMarginBreach: !marginBreach,
    firstBreach: marginBreach,
    gapStress
  },
  strategies: {
    fundingCarry: carryMetrics,
    btcSpotBuyHold15: buyHoldMetrics,
    cash: cashMetrics
  },
  dailyDiagnostics,
  interpretationConstraint: marginBreach
    ? `${manifest.evaluation.historicalHoldoutIntegrity} Historical margin threshold was breached; post-breach return metrics are descriptive path diagnostics only and the candidate fails the frozen margin requirement.`
    : manifest.evaluation.historicalHoldoutIntegrity,
  antiRescueRule: manifest.antiRescueRule
};

console.log(JSON.stringify(result, null, 2));
