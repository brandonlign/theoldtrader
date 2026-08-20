import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST_PATH = 'research/crypto/manifests/kalshi-coinbase-carry-v1.json';
const OUT_PATH = process.argv[2] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v1-synchronized.json';
const SOURCES_PATH = process.argv[3] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v1-sources.json';
const RAW_DIR = process.argv[4] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v1-raw';
const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2/margin';
const COINBASE_BASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';
const TICKER = 'KXBTCPERP';
const CONTRACT_SIZE = 0.0001;
const HOUR = 3600;
const EIGHT_HOURS = 8 * HOUR;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function getRaw(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TheOldTrader-Trial11/1.0' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${new URL(url).pathname}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Non-JSON response from ${url}`); }
  return { url, text, payload, sha256: sha256(Buffer.from(text)) };
}

function finitePositive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be finite positive`);
  return n;
}

function finiteNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be finite numeric`);
  return n;
}

function writeRaw(name, raw) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, name);
  fs.writeFileSync(file, raw.text);
  return { file, url: raw.url, sha256: raw.sha256, bytes: Buffer.byteLength(raw.text) };
}

const manifestBytes = fs.readFileSync(MANIFEST_PATH);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.experimentId !== 'kalshi-coinbase-carry-v1' || manifest.trialNumber !== 11 || manifest.status !== 'FROZEN_HISTORICAL_DEVELOPMENT_UNOBSERVED') {
  throw new Error('Expected frozen unobserved Trial 11 manifest');
}
if (manifest.dataRequirements.kalshi.ticker !== TICKER || manifest.candidate.contractSizeBtc !== CONTRACT_SIZE) {
  throw new Error('Trial 11 manifest/code product identity mismatch');
}

const startMs = Date.parse(manifest.historicalDevelopmentWindow.startInclusive);
const endMs = Date.parse(manifest.historicalDevelopmentWindow.endInclusive);
if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || (endMs - startMs) % (EIGHT_HOURS * 1000) !== 0) {
  throw new Error('Invalid frozen Trial 11 historical window');
}
const expectedTimesMs = [];
for (let t = startMs; t <= endMs; t += EIGHT_HOURS * 1000) expectedTimesMs.push(t);
if (expectedTimesMs.length !== 234) throw new Error(`Frozen boundary count drift: ${expectedTimesMs.length}`);
const expectedSetMs = new Set(expectedTimesMs);

const marketsRaw = await getRaw(`${KALSHI_BASE}/markets?status=active`);
if (!Array.isArray(marketsRaw.payload?.markets)) throw new Error('Kalshi markets response missing markets array');
const exactMarkets = marketsRaw.payload.markets.filter((m) => String(m?.ticker ?? '') === TICKER);
if (exactMarkets.length !== 1) throw new Error(`Expected exactly one active ${TICKER}; found ${exactMarkets.length}`);
const market = exactMarkets[0];
if (Number(market.contract_size) !== CONTRACT_SIZE || market.status !== 'active') throw new Error('Kalshi product identity/status drift');

const fundingRaw = await getRaw(`${KALSHI_BASE}/funding_rates/historical?ticker=${TICKER}`);
if (!Array.isArray(fundingRaw.payload?.funding_rates)) throw new Error('Kalshi funding response missing funding_rates array');
const fundingByMs = new Map();
for (const row of fundingRaw.payload.funding_rates) {
  if (String(row?.market_ticker ?? '') !== TICKER) continue;
  const t = Date.parse(row.funding_time);
  if (!expectedSetMs.has(t)) continue;
  if (fundingByMs.has(t)) throw new Error(`Duplicate funding boundary ${new Date(t).toISOString()}`);
  const rate = finiteNumber(row.funding_rate, 'funding_rate');
  if (Math.abs(rate) > 0.02 + 1e-12) throw new Error(`Funding rate exceeds frozen 2% sanity cap at ${row.funding_time}`);
  const markPrice = finitePositive(row.mark_price, 'mark_price');
  fundingByMs.set(t, { rate, markPrice });
}
if (fundingByMs.size !== expectedTimesMs.length) throw new Error(`Kalshi funding coverage mismatch: ${fundingByMs.size}/${expectedTimesMs.length}`);

const startSec = Math.trunc(startMs / 1000);
const endSec = Math.trunc(endMs / 1000);
const kalshiUrl = new URL(`${KALSHI_BASE}/markets/${TICKER}/candlesticks`);
kalshiUrl.searchParams.set('start_ts', String(startSec));
kalshiUrl.searchParams.set('end_ts', String(endSec));
kalshiUrl.searchParams.set('period_interval', '60');
const kalshiCandlesRaw = await getRaw(kalshiUrl.toString());
if (!Array.isArray(kalshiCandlesRaw.payload?.candlesticks)) throw new Error('Kalshi candlestick response missing candlesticks');
const kalshiByMs = new Map();
for (const candle of kalshiCandlesRaw.payload.candlesticks) {
  const t = Number(candle?.end_period_ts) * 1000;
  if (!expectedSetMs.has(t)) continue;
  if (kalshiByMs.has(t)) throw new Error(`Duplicate Kalshi candle boundary ${new Date(t).toISOString()}`);
  const bid = finitePositive(candle?.bid?.close, 'Kalshi bid.close');
  const ask = finitePositive(candle?.ask?.close, 'Kalshi ask.close');
  if (ask < bid) throw new Error(`Crossed historical Kalshi candle at ${new Date(t).toISOString()}`);
  kalshiByMs.set(t, { bid, ask });
}
if (kalshiByMs.size !== expectedTimesMs.length) throw new Error(`Kalshi bid/ask coverage mismatch: ${kalshiByMs.size}/${expectedTimesMs.length}`);

const coinbaseByMs = new Map();
const coinbaseRaws = [];
for (let cursor = startSec; cursor <= endSec; cursor += 240 * HOUR) {
  const chunkEnd = Math.min(endSec + HOUR, cursor + 239 * HOUR);
  const url = new URL(COINBASE_BASE);
  url.searchParams.set('granularity', String(HOUR));
  url.searchParams.set('start', new Date(cursor * 1000).toISOString());
  url.searchParams.set('end', new Date(chunkEnd * 1000).toISOString());
  const raw = await getRaw(url.toString());
  coinbaseRaws.push(raw);
  if (!Array.isArray(raw.payload)) throw new Error('Coinbase candle response not array');
  for (const row of raw.payload) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]) * 1000;
    if (!expectedSetMs.has(t)) continue;
    const open = finitePositive(row[3], 'Coinbase open');
    if (coinbaseByMs.has(t) && coinbaseByMs.get(t) !== open) throw new Error(`Conflicting Coinbase candle at ${new Date(t).toISOString()}`);
    coinbaseByMs.set(t, open);
  }
}
if (coinbaseByMs.size !== expectedTimesMs.length) throw new Error(`Coinbase boundary coverage mismatch: ${coinbaseByMs.size}/${expectedTimesMs.length}`);

const rows = expectedTimesMs.map((t) => ({
  timestamp: new Date(t).toISOString(),
  coinbaseSpotOpen: coinbaseByMs.get(t),
  kalshiBid: kalshiByMs.get(t).bid,
  kalshiAsk: kalshiByMs.get(t).ask,
  kalshiMarkPrice: fundingByMs.get(t).markPrice,
  fundingRate: fundingByMs.get(t).rate
}));

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const synchronizedText = JSON.stringify({
  experimentId: manifest.experimentId,
  trialNumber: 11,
  frozenAt: manifest.frozenAt,
  manifestSha256: sha256(manifestBytes),
  rows
}, null, 2) + '\n';
fs.writeFileSync(OUT_PATH, synchronizedText);

const rawSources = [
  writeRaw('kalshi-markets.json', marketsRaw),
  writeRaw('kalshi-funding.json', fundingRaw),
  writeRaw('kalshi-candles.json', kalshiCandlesRaw),
  ...coinbaseRaws.map((raw, index) => writeRaw(`coinbase-candles-${String(index).padStart(2, '0')}.json`, raw))
];
const sourceManifest = {
  experimentId: manifest.experimentId,
  trialNumber: 11,
  generatedAt: new Date().toISOString(),
  manifestSha256: sha256(manifestBytes),
  synchronizedSha256: sha256(Buffer.from(synchronizedText)),
  boundaryRows: rows.length,
  rawSources
};
fs.writeFileSync(SOURCES_PATH, JSON.stringify(sourceManifest, null, 2) + '\n');

console.log(JSON.stringify({
  experimentId: manifest.experimentId,
  acquisitionOnly: true,
  economicsCalculated: false,
  boundaryRows: rows.length,
  rawSourceFiles: rawSources.length,
  manifestSha256: sourceManifest.manifestSha256,
  synchronizedSha256: sourceManifest.synchronizedSha256
}, null, 2));
