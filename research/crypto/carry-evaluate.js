import fs from 'node:fs';
import crypto from 'node:crypto';

// Research-only evaluator for funding-carry-v1.
// Input CSV must be synchronized WITHOUT forward-looking interpolation and contain:
// timestamp,spot_price,perp_price,funding_rate
// funding_rate is the realized decimal payment for that timestamp (e.g. 0.0001 = 1 bp).

const manifestPath = process.argv[2] ?? 'research/crypto/manifests/funding-carry-v1.json';
const dataPath = process.argv[3];
if (!dataPath) throw new Error('Usage: node research/crypto/carry-evaluate.js <manifest.json> <synchronized.csv>');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-v1' || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error('Refusing to evaluate a non-frozen/non-research carry manifest');
}
const raw = fs.readFileSync(dataPath);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');

function parseCsv(buffer) {
  const lines = buffer.toString('utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((value) => value.trim());
  const required = ['timestamp', 'spot_price', 'perp_price', 'funding_rate'];
  for (const column of required) if (!header.includes(column)) throw new Error(`Missing required column ${column}`);
  const indexes = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = [];
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
    rows.push({ timestamp, spot, perp, funding });
  }
  rows.sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length < 2) throw new Error('Need at least two synchronized observations');
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].timestamp <= rows[i - 1].timestamp) throw new Error('Duplicate/non-increasing timestamps');
  }
  return rows;
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
  const halfSpread = cost.spreadBpsRoundTrip / 2;
  const adverseBps = cost.slippageBpsPerSide + halfSpread;
  return price * (1 + (side === 'buy' ? 1 : -1) * adverseBps / 10_000);
}
function dailyLast(series) {
  const byDay = new Map();
  for (const point of series) byDay.set(Math.floor(point.time / 86_400_000), point);
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}
function metrics(series, startValue, fees) {
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
  const elapsedDays = Math.max(1, ((daily.at(-1)?.time ?? rows.at(-1).timestamp) - rows[0].timestamp) / 86_400_000);
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
const spotEntryFill = fill(first.spot, 'buy', spotCost);
const units = spotNotional / spotEntryFill;
const spotEntryFee = spotNotional * spotCost.feeBpsPerSide / 10_000;
const perpEntryFill = fill(first.perp, 'sell', perpCost);
const perpEntryNotional = units * perpEntryFill;
const perpEntryFee = perpEntryNotional * perpCost.feeBpsPerSide / 10_000;
let freeCash = startingCash - spotNotional - spotEntryFee - collateral - perpEntryFee;
if (freeCash < 0) throw new Error('Frozen collateral/notional settings exceed starting cash after entry friction');
let fundingPnl = 0;
let fees = spotEntryFee + perpEntryFee;
let marginBreach = null;
const equitySeries = [];
const gapStress = Object.fromEntries(manifest.marginStress.additionalGapStressPct.map((gap) => [String(gap), { breached: false, minimumExcessMargin: Infinity }]));

for (const row of rows) {
  const spotValue = units * row.spot;
  const perpUnrealizedPnl = units * (perpEntryFill - row.perp);
  fundingPnl += units * row.perp * row.funding;
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

const last = rows.at(-1);
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

const priceOnlySpotPnl = spotExitGross - spotExitFee - spotNotional - spotEntryFee;
const basisAndPerpPnl = realizedPerpPnl - perpEntryFee - perpExitFee;
const result = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  paperOnly: true,
  livePromotionAllowed: false,
  input: {
    path: dataPath,
    sha256,
    rows: rows.length,
    start: new Date(first.timestamp).toISOString(),
    end: new Date(last.timestamp).toISOString()
  },
  frozenPosition: {
    btcUnits: units,
    spotEntryFill,
    perpEntryFill,
    spotEntryNotional: spotNotional,
    perpEntryNotional,
    futuresCollateral: collateral
  },
  pnlDecomposition: {
    fundingPnl,
    spotLegPnlAfterFees: priceOnlySpotPnl,
    perpetualLegPnlAfterFees: basisAndPerpPnl,
    totalFees: fees,
    finalEquity
  },
  margin: {
    breached: Boolean(marginBreach),
    firstBreach: marginBreach,
    gapStress
  },
  metrics: metrics(equitySeries, startingCash, fees),
  interpretationConstraint: manifest.evaluation.historicalHoldoutIntegrity
};

console.log(JSON.stringify(result, null, 2));
