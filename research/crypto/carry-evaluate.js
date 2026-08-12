import fs from 'node:fs';
import crypto from 'node:crypto';

// Research-only evaluator for funding-carry-v1.
// Input CSV must be synchronized WITHOUT forward-looking interpolation and contain:
// timestamp,spot_price,perp_price,funding_rate
// funding_rate is the realized decimal payment at that timestamp (0.0001 = 1 bp).

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
if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid frozen carry window');

function parseCsv(buffer) {
  const lines = buffer.toString('utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((value) => value.trim());
  const required = ['timestamp', 'spot_price', 'perp_price', 'funding_rate'];
  for (const column of required) if (!header.includes(column)) throw new Error(`Missing required column ${column}`);
  const indexes = Object.fromEntries(header.map((name, i) => [name, i]));
  const parsed = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const timestamp = Date.parse(cells[indexes.timestamp]);
    const spot = Number(cells[indexes.spot_price]);
    const perp = Number(cells[indexes.perp_price]);
    const funding = Number(cells[indexes.funding_rate]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(spot) || !Number.isFinite(perp) || !Number.isFinite(funding) || spot <= 0 || perp <= 0) {
      throw new Error(`Invalid synchronized row: ${line.slice(0, 160)}`);
    }
    if (timestamp >= startMs && timestamp < endMs) parsed.push({ timestamp, spot, perp, funding });
  }
  parsed.sort((a, b) => a.timestamp - b.timestamp);
  if (parsed.length < 2) throw new Error('Need at least two synchronized observations inside the frozen window');
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].timestamp <= parsed[i - 1].timestamp) throw new Error('Duplicate/non-increasing timestamps');
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
const perpEntryFill = fill(first.perp, 'sell', perpCost);
const perpEntryNotional = units * perpEntryFill;
const perpEntryFee = perpEntryNotional * perpCost.feeBpsPerSide / 10_000;
const freeCash = startingCash - spotNotional - spotEntryFee - collateral - perpEntryFee;
if (freeCash < 0) throw new Error('Frozen collateral/notional settings exceed starting cash after entry friction');

let fundingPnl = 0;
let fees = spotEntryFee + perpEntryFee;
let marginBreach = null;
const equitySeries = [];
const gapStress = Object.fromEntries(manifest.marginStress.additionalGapStressPct.map((gap) => [String(gap), { breached: false, minimumExcessMargin: Infinity }]));

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  // The first row establishes the position. Its contemporaneous funding payment was not earned.
  if (index > 0) fundingPnl += units * row.perp * row.funding;
  const spotValue = units * row.spot;
  const perpUnrealizedPnl = units * (perpEntryFill - row.perp);
  const futuresEquity = collateral + perpUnrealizedPnl + fundingPnl;
  const maintenance = units * row.perp * manifest.marginStress.maintenanceMarginPctOfPerpetualNotional;
  if (!marginBreach && futuresEquity < maintenance) {
    marginBreach = { timestamp: new Date(row.timestamp).toISOString(), futuresEquity, maintenance };
  }
  for (const gap of manifest.marginStress.additionalGapStressPct) {
    const stressedPerp = row.perp * (1 + gap);
    const stressedPnl = units * (perpEntryFill - stressedPerp);
    const stressedEquity = collateral + stressedPnl + fundingPnl;
    const stressedMaintenance = units * stressedPerp * manifest.marginStress.maintenanceMarginPctOfPerpetualNotional;
    const excess = stressedEquity - stressedMaintenance;
    gapStress[String(gap)].minimumExcessMargin = Math.min(gapStress[String(gap)].minimumExcessMargin, excess);
    if (excess < 0) gapStress[String(gap)].breached = true;
  }
  equitySeries.push({
    time: row.timestamp,
    equity: freeCash + spotValue + futuresEquity,
    spotValue,
    perpUnrealizedPnl,
    fundingPnl,
    futuresEquity,
    maintenance
  });
}

const spotExitFill = fill(last.spot, 'sell', spotCost);
const perpExitFill = fill(last.perp, 'buy', perpCost);
const spotExitGross = units * spotExitFill;
const spotExitFee = spotExitGross * spotCost.feeBpsPerSide / 10_000;
const perpExitNotional = units * perpExitFill;
const perpExitFee = perpExitNotional * perpCost.feeBpsPerSide / 10_000;
fees += spotExitFee + perpExitFee;
const realizedPerpPnl = units * (perpEntryFill - perpExitFill);
const finalEquity = freeCash + (spotExitGross - spotExitFee) + collateral + realizedPerpPnl + fundingPnl - perpExitFee;
equitySeries.push({ time: last.timestamp + 1, equity: finalEquity });

// Comparator: identical 15% spot allocation, same conservative spot friction, no futures/funding leg.
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
    frozenWindowStart: manifest.historicalRobustnessWindow.startInclusive,
    frozenWindowEndExclusive: manifest.historicalRobustnessWindow.endExclusive,
    firstSynchronizedTimestamp: new Date(first.timestamp).toISOString(),
    lastSynchronizedTimestamp: new Date(last.timestamp).toISOString()
  },
  frozenPosition: {
    btcUnits: units,
    spotEntryFill,
    perpEntryFill,
    spotEntryNotional: spotNotional,
    perpEntryNotional,
    futuresCollateral: collateral,
    initialCapitalCommittedPct: (spotNotional + collateral + spotEntryFee + perpEntryFee) / startingCash
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
    firstBreach: marginBreach,
    gapStress
  },
  strategies: {
    fundingCarry: carryMetrics,
    btcSpotBuyHold15: buyHoldMetrics,
    cash: cashMetrics
  },
  interpretationConstraint: manifest.evaluation.historicalHoldoutIntegrity,
  antiRescueRule: manifest.antiRescueRule
};

console.log(JSON.stringify(result, null, 2));
