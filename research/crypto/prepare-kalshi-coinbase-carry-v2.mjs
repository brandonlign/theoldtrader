import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST_PATH = 'research/crypto/manifests/kalshi-coinbase-carry-v2.json';
const OUT_PATH = process.argv[2] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v2-synchronized.json';
const SOURCES_PATH = process.argv[3] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v2-sources.json';
const RAW_DIR = process.argv[4] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v2-raw';
const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2/margin';
const COINBASE_BASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';
const TICKER = 'KXBTCPERP';
const CONTRACT_SIZE = 0.0001;
const HOUR = 3600;
const STEP_MS = 8 * HOUR * 1000;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function rawJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TheOldTrader-Trial12/1.0' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${new URL(url).pathname}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Non-JSON response from ${url}`); }
  return { url, text, payload, sha256: sha256(Buffer.from(text)) };
}
const positive = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be finite positive`);
  return n;
};
const finite = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be finite numeric`);
  return n;
};
function preserve(name, raw) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, name);
  fs.writeFileSync(file, raw.text);
  return { file, url: raw.url, sha256: raw.sha256, bytes: Buffer.byteLength(raw.text) };
}

const manifestBytes = fs.readFileSync(MANIFEST_PATH);
const manifest = JSON.parse(manifestBytes);
if (manifest.experimentId !== 'kalshi-coinbase-carry-v2' || manifest.trialNumber !== 12 || manifest.status !== 'FROZEN_HISTORICAL_UNIT_REPLICATION_UNOBSERVED') throw new Error('Expected frozen Trial 12 manifest');
if (manifest.dataRequirements.kalshiTicker !== TICKER || manifest.dataRequirements.requireExactContractSizeBtc !== CONTRACT_SIZE) throw new Error('Trial 12 identity mismatch');

const startMs = Date.parse(manifest.historicalDevelopmentWindow.startInclusive);
const endMs = Date.parse(manifest.historicalDevelopmentWindow.endInclusive);
const expected = [];
for (let t = startMs; t <= endMs; t += STEP_MS) expected.push(t);
if (expected.length !== 234 || expected.at(-1) !== endMs) throw new Error('Frozen Trial 12 boundary grid drift');
const wanted = new Set(expected);

const marketsRaw = await rawJson(`${KALSHI_BASE}/markets?status=active`);
const exact = (marketsRaw.payload?.markets ?? []).filter((m) => String(m?.ticker ?? '') === TICKER);
if (exact.length !== 1 || exact[0].status !== 'active' || Number(exact[0].contract_size) !== CONTRACT_SIZE) throw new Error('Kalshi Trial 12 product identity/status drift');

const fundingRaw = await rawJson(`${KALSHI_BASE}/funding_rates/historical?ticker=${TICKER}`);
const funding = new Map();
for (const row of fundingRaw.payload?.funding_rates ?? []) {
  if (String(row?.market_ticker ?? '') !== TICKER) continue;
  const t = Date.parse(row.funding_time);
  if (!wanted.has(t)) continue;
  if (funding.has(t)) throw new Error(`Duplicate funding boundary ${row.funding_time}`);
  const rate = finite(row.funding_rate, 'funding_rate');
  if (Math.abs(rate) > 0.02 + 1e-12) throw new Error(`Funding sanity cap exceeded at ${row.funding_time}`);
  funding.set(t, { rate, mark: positive(row.mark_price, 'Kalshi mark_price') });
}
if (funding.size !== expected.length) throw new Error(`Funding coverage ${funding.size}/${expected.length}`);

const kalshiUrl = new URL(`${KALSHI_BASE}/markets/${TICKER}/candlesticks`);
kalshiUrl.searchParams.set('start_ts', String(Math.trunc(startMs / 1000)));
kalshiUrl.searchParams.set('end_ts', String(Math.trunc(endMs / 1000)));
kalshiUrl.searchParams.set('period_interval', '60');
const candlesRaw = await rawJson(kalshiUrl.toString());
const kalshi = new Map();
for (const row of candlesRaw.payload?.candlesticks ?? []) {
  const t = Number(row?.end_period_ts) * 1000;
  if (!wanted.has(t)) continue;
  if (kalshi.has(t)) throw new Error(`Duplicate Kalshi candle ${new Date(t).toISOString()}`);
  const bid = positive(row?.bid?.close, 'Kalshi bid.close');
  const ask = positive(row?.ask?.close, 'Kalshi ask.close');
  if (ask < bid) throw new Error(`Crossed Kalshi candle ${new Date(t).toISOString()}`);
  kalshi.set(t, { bid, ask });
}
if (kalshi.size !== expected.length) throw new Error(`Kalshi candle coverage ${kalshi.size}/${expected.length}`);

const coinbase = new Map();
const coinbaseRaw = [];
const startSec = Math.trunc(startMs / 1000);
const endSec = Math.trunc(endMs / 1000);
for (let cursor = startSec; cursor <= endSec; cursor += 240 * HOUR) {
  const chunkEnd = Math.min(endSec + HOUR, cursor + 239 * HOUR);
  const url = new URL(COINBASE_BASE);
  url.searchParams.set('granularity', String(HOUR));
  url.searchParams.set('start', new Date(cursor * 1000).toISOString());
  url.searchParams.set('end', new Date(chunkEnd * 1000).toISOString());
  const raw = await rawJson(url.toString());
  coinbaseRaw.push(raw);
  if (!Array.isArray(raw.payload)) throw new Error('Coinbase candles response not array');
  for (const row of raw.payload) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]) * 1000;
    if (!wanted.has(t)) continue;
    const open = positive(row[3], 'Coinbase open');
    if (coinbase.has(t) && coinbase.get(t) !== open) throw new Error(`Conflicting Coinbase candle ${new Date(t).toISOString()}`);
    coinbase.set(t, open);
  }
}
if (coinbase.size !== expected.length) throw new Error(`Coinbase coverage ${coinbase.size}/${expected.length}`);

const rows = expected.map((t) => ({
  timestamp: new Date(t).toISOString(),
  coinbaseSpotOpen: coinbase.get(t),
  kalshiBidPerContractUsd: kalshi.get(t).bid,
  kalshiAskPerContractUsd: kalshi.get(t).ask,
  kalshiMarkPerContractUsd: funding.get(t).mark,
  fundingRate: funding.get(t).rate
}));
const synchronized = JSON.stringify({ experimentId: manifest.experimentId, trialNumber: 12, frozenAt: manifest.frozenAt, manifestSha256: sha256(manifestBytes), rows }, null, 2) + '\n';
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, synchronized);
const rawSources = [
  preserve('kalshi-markets.json', marketsRaw),
  preserve('kalshi-funding.json', fundingRaw),
  preserve('kalshi-candles.json', candlesRaw),
  ...coinbaseRaw.map((raw, i) => preserve(`coinbase-candles-${String(i).padStart(2, '0')}.json`, raw))
];
const sourceManifest = { experimentId: manifest.experimentId, trialNumber: 12, generatedAt: new Date().toISOString(), manifestSha256: sha256(manifestBytes), synchronizedSha256: sha256(Buffer.from(synchronized)), boundaryRows: rows.length, rawSources };
fs.writeFileSync(SOURCES_PATH, JSON.stringify(sourceManifest, null, 2) + '\n');
console.log(JSON.stringify({ experimentId: manifest.experimentId, acquisitionOnly: true, economicsCalculated: false, boundaryRows: rows.length, rawSourceFiles: rawSources.length, manifestSha256: sourceManifest.manifestSha256, synchronizedSha256: sourceManifest.synchronizedSha256 }, null, 2));
