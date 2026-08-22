const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2/margin';
const KALSHI_TICKER = 'KXBTCPERP';
const COINBASE_BASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';
const HOUR = 3600;

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TheOldTrader-Research/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${new URL(url).pathname}`);
  return response.json();
}

const fundingPayload = await getJson(`${KALSHI_BASE}/funding_rates/historical?ticker=${KALSHI_TICKER}`);
const fundingRows = Array.isArray(fundingPayload?.funding_rates)
  ? fundingPayload.funding_rates.filter((row) => row?.market_ticker === KALSHI_TICKER)
  : [];
const fundingTimes = [...new Set(fundingRows.map((row) => Math.trunc(Date.parse(row.funding_time) / 1000)).filter(Number.isFinite))].sort((a,b)=>a-b);
if (fundingTimes.length < 3) throw new Error('Insufficient Kalshi funding history for coverage audit');
const start = fundingTimes[0];
const end = fundingTimes.at(-1);

const kalshiUrl = new URL(`${KALSHI_BASE}/markets/${KALSHI_TICKER}/candlesticks`);
kalshiUrl.searchParams.set('start_ts', String(start));
kalshiUrl.searchParams.set('end_ts', String(end));
kalshiUrl.searchParams.set('period_interval', '60');
const kalshiPayload = await getJson(kalshiUrl.toString());
const kalshiCandles = Array.isArray(kalshiPayload?.candlesticks) ? kalshiPayload.candlesticks : [];
const kalshiByEnd = new Map(kalshiCandles.map((row) => [Number(row.end_period_ts), row]));
const kalshiExact = fundingTimes.filter((t) => kalshiByEnd.has(t));
const kalshiBidAskUsable = fundingTimes.filter((t) => {
  const row = kalshiByEnd.get(t);
  return row && Number.isFinite(Number(row?.bid?.close)) && Number(row.bid.close) > 0
    && Number.isFinite(Number(row?.ask?.close)) && Number(row.ask.close) > 0;
});

const coinbaseByStart = new Map();
for (let cursor = start; cursor <= end; cursor += 240 * HOUR) {
  const chunkEnd = Math.min(end + HOUR, cursor + 239 * HOUR);
  const url = new URL(COINBASE_BASE);
  url.searchParams.set('granularity', String(HOUR));
  url.searchParams.set('start', new Date(cursor * 1000).toISOString());
  url.searchParams.set('end', new Date(chunkEnd * 1000).toISOString());
  const payload = await getJson(url.toString());
  if (!Array.isArray(payload)) throw new Error('Coinbase candle response is not an array');
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const ts = Number(row[0]);
    const open = Number(row[3]);
    if (Number.isFinite(ts) && Number.isFinite(open) && open > 0) coinbaseByStart.set(ts, true);
  }
}
const coinbaseExact = fundingTimes.filter((t) => coinbaseByStart.has(t));
const intervalHours = fundingTimes.slice(1).map((t,i)=>(t-fundingTimes[i])/HOUR);

console.log(JSON.stringify({
  developmentCoverageOnly: true,
  economicsCalculated: false,
  candidateValuesExposed: false,
  pricesExposed: false,
  fundingValuesExposed: false,
  ticker: KALSHI_TICKER,
  fundingRows: fundingTimes.length,
  fundingStart: new Date(start * 1000).toISOString(),
  fundingEnd: new Date(end * 1000).toISOString(),
  eightHourFundingIntervals: intervalHours.filter((x)=>x===8).length,
  totalFundingIntervals: intervalHours.length,
  kalshiHourlyCandlesReturned: kalshiCandles.length,
  kalshiExactFundingBoundaryCandles: kalshiExact.length,
  kalshiUsableBidAskAtFundingBoundaries: kalshiBidAskUsable.length,
  coinbaseExactFundingBoundarySpotOpens: coinbaseExact.length,
  fullKalshiBoundaryCoverage: kalshiExact.length === fundingTimes.length,
  fullKalshiBidAskBoundaryCoverage: kalshiBidAskUsable.length === fundingTimes.length,
  fullCoinbaseBoundaryCoverage: coinbaseExact.length === fundingTimes.length,
  historyQualificationPass: intervalHours.every((x)=>x===8)
    && kalshiExact.length === fundingTimes.length
    && kalshiBidAskUsable.length === fundingTimes.length
    && coinbaseExact.length === fundingTimes.length
}, null, 2));

if (!(intervalHours.every((x)=>x===8)
  && kalshiExact.length === fundingTimes.length
  && kalshiBidAskUsable.length === fundingTimes.length
  && coinbaseExact.length === fundingTimes.length)) process.exit(4);