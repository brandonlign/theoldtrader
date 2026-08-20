const BASE = 'https://external-api.kalshi.com/trade-api/v2/margin';
const TICKER = 'KXBTCPERP';

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TheOldTrader-Research/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
  return response.json();
}

const fundingPayload = await getJson(`${BASE}/funding_rates/historical?ticker=${TICKER}`);
const fundingRows = Array.isArray(fundingPayload?.funding_rates) ? fundingPayload.funding_rates : [];
if (!fundingRows.length) throw new Error('No Kalshi funding rows');
const fundingRow = fundingRows.find((row) => row?.market_ticker === TICKER) ?? fundingRows[0];

const times = fundingRows
  .filter((row) => row?.market_ticker === TICKER)
  .map((row) => Math.trunc(Date.parse(row.funding_time) / 1000))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
if (!times.length) throw new Error('No funding timestamps');
const start = times[0];
const end = times.at(-1);
const candlesUrl = new URL(`${BASE}/markets/${TICKER}/candlesticks`);
candlesUrl.searchParams.set('start_ts', String(start));
candlesUrl.searchParams.set('end_ts', String(Math.min(end, start + 24 * 3600)));
candlesUrl.searchParams.set('period_interval', '60');
const candlesPayload = await getJson(candlesUrl.toString());
const candles = Array.isArray(candlesPayload?.candlesticks) ? candlesPayload.candlesticks : [];
if (!candles.length) throw new Error('No Kalshi candles');
const candle = candles[0];

function shape(value) {
  if (value == null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value !== 'object') return { type: typeof value };
  return {
    type: 'object',
    keys: Object.keys(value).sort(),
    childShapes: Object.fromEntries(Object.entries(value)
      .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
      .map(([k, v]) => [k, { keys: Object.keys(v).sort() }]))
  };
}

console.log(JSON.stringify({
  schemaProbeOnly: true,
  economicsCalculated: false,
  candidateValuesExposed: false,
  pricesExposed: false,
  fundingValuesExposed: false,
  ticker: TICKER,
  fundingPayloadKeys: Object.keys(fundingPayload).sort(),
  fundingRowShape: shape(fundingRow),
  candlePayloadKeys: Object.keys(candlesPayload).sort(),
  candleShape: shape(candle)
}, null, 2));
