const BASE = 'https://external-api.kalshi.com/trade-api/v2/margin';
const EXPECTED_TICKER = 'KXBTCPERP1';

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TheOldTrader-Research/1.0' } });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* handled below */ }
  if (!response.ok || payload == null) {
    const error = new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeSide(levels) {
  if (!Array.isArray(levels)) return null;
  const out = [];
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2) return null;
    const price = positive(level[0]);
    const quantity = positive(level[1]);
    if (price == null || quantity == null) return null;
    out.push({ price, quantity });
  }
  return out;
}

function executable(side, contracts) {
  return Array.isArray(side) && side.reduce((sum, row) => sum + row.quantity, 0) >= contracts;
}

let markets;
try {
  markets = await getJson(`${BASE}/markets?status=active`);
} catch (error) {
  console.log(JSON.stringify({
    developmentProbeOnly: true,
    economicsCalculated: false,
    candidateValuesExposed: false,
    publicRestAccessible: false,
    status: error.status ?? null,
    reason: String(error.message)
  }, null, 2));
  process.exit(2);
}

if (!Array.isArray(markets.markets)) throw new Error('Kalshi active markets response missing markets array');
const exact = markets.markets.filter((row) => String(row?.ticker ?? '') === EXPECTED_TICKER);
const btcLike = markets.markets.filter((row) => /bitcoin|btc/i.test(`${row?.title ?? ''} ${row?.ticker ?? ''}`) && /perp/i.test(`${row?.title ?? ''} ${row?.ticker ?? ''}`));
const candidates = exact.length === 1 ? exact : btcLike;
if (candidates.length !== 1) {
  console.log(JSON.stringify({
    developmentProbeOnly: true,
    economicsCalculated: false,
    candidateValuesExposed: false,
    publicRestAccessible: true,
    productIdentityValid: false,
    expectedTicker: EXPECTED_TICKER,
    btcPerpCandidateIdentities: btcLike.map((row) => ({ ticker: row.ticker, title: row.title, contractSize: row.contract_size }))
  }, null, 2));
  process.exit(3);
}

const market = candidates[0];
const ticker = String(market.ticker);
const contractSize = positive(market.contract_size);
if (contractSize == null) throw new Error('Kalshi BTC perp contract_size is not positive numeric');

const [bookPayload, fundingPayload] = await Promise.all([
  getJson(`${BASE}/markets/${encodeURIComponent(ticker)}/orderbook?depth=0`),
  getJson(`${BASE}/funding_rates/historical?ticker=${encodeURIComponent(ticker)}`)
]);

const bids = normalizeSide(bookPayload?.orderbook?.bids);
const asks = normalizeSide(bookPayload?.orderbook?.asks);
const bookShapeValid = Array.isArray(bids) && Array.isArray(asks);
const twoSided = bookShapeValid && bids.length > 0 && asks.length > 0;
const oneContractBoth = twoSided && executable(asks, 1) && executable(bids, 1);
const tenContractsBoth = twoSided && executable(asks, 10) && executable(bids, 10);

const fundingRows = Array.isArray(fundingPayload?.funding_rates) ? fundingPayload.funding_rates : null;
if (!fundingRows) throw new Error('Kalshi historical funding response missing funding_rates array');
const fundingTimes = fundingRows
  .filter((row) => String(row?.market_ticker ?? '') === ticker)
  .map((row) => Date.parse(row.funding_time))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const distinctFundingTimes = [...new Set(fundingTimes)];
const intervalsHours = distinctFundingTimes.slice(1).map((t, i) => (t - distinctFundingTimes[i]) / 3_600_000);
const regularEightHourIntervals = intervalsHours.filter((hours) => Math.abs(hours - 8) < 1e-9).length;

console.log(JSON.stringify({
  developmentProbeOnly: true,
  economicsCalculated: false,
  candidateValuesExposed: false,
  pricesExposed: false,
  fundingValuesExposed: false,
  publicRestAccessible: true,
  productIdentityValid: ticker === EXPECTED_TICKER || btcLike.length === 1,
  ticker,
  title: market.title,
  contractSize,
  marketOpen: Boolean(market?.schedule?.is_open),
  orderbookShapeValid: bookShapeValid,
  twoSidedOrderbook: twoSided,
  oneContractBothSidesExecutable: oneContractBoth,
  tenContractsBothSidesExecutable: tenContractsBoth,
  historicalFundingRows: distinctFundingTimes.length,
  firstFundingTime: distinctFundingTimes.length ? new Date(distinctFundingTimes[0]).toISOString() : null,
  latestFundingTime: distinctFundingTimes.length ? new Date(distinctFundingTimes.at(-1)).toISOString() : null,
  eightHourIntervalsObserved: regularEightHourIntervals,
  intervalCountObserved: intervalsHours.length,
  sourceQualificationPass: twoSided && oneContractBoth && distinctFundingTimes.length >= 3
}, null, 2));

if (!(twoSided && oneContractBoth && distinctFundingTimes.length >= 3)) process.exit(4);