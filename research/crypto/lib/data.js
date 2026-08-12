import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [time, low, high, open, close, volume] = row.map(Number);
  if (![time, low, high, open, close, volume].every(Number.isFinite) || time <= 0 || close <= 0) return null;
  return { time, low, high, open, close, volume };
}

export function datasetHash(dataset) {
  const stable = JSON.stringify(dataset);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

export function cachePathFor(manifest, rootDir) {
  const start = manifest.data.start.slice(0, 10);
  const end = manifest.data.end.slice(0, 10);
  return path.join(rootDir, 'research', 'crypto', 'data-cache', `coinbase-${manifest.data.granularitySeconds}s-${start}_${end}.json.gz`);
}

export function loadCache(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  const compressed = fs.readFileSync(cachePath);
  return JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
}

export function saveCache(cachePath, dataset) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const payload = Buffer.from(JSON.stringify(dataset));
  fs.writeFileSync(cachePath, zlib.gzipSync(payload, { level: 9 }));
}

async function fetchJson(url, { retries = 5, delayMs = 450 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MoneyMog-Research/1.0'
        }
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : delayMs * (2 ** attempt);
        await sleep(Math.min(wait, 12_000));
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Coinbase ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(Math.min(delayMs * (2 ** attempt), 12_000));
    }
  }
  throw lastError ?? new Error('Coinbase request failed');
}

export async function fetchCoinbaseCandles(productId, { start, end, granularitySeconds, requestDelayMs = 350 }) {
  const startSec = Math.floor(Date.parse(start) / 1000);
  const endSec = Math.floor(Date.parse(end) / 1000);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw new Error(`Invalid date range: ${start} -> ${end}`);
  }
  const maxCandles = 299;
  const chunkSeconds = maxCandles * granularitySeconds;
  const byTime = new Map();

  for (let cursor = startSec; cursor < endSec; cursor += chunkSeconds) {
    const chunkEnd = Math.min(endSec, cursor + chunkSeconds);
    const params = new URLSearchParams({
      start: new Date(cursor * 1000).toISOString(),
      end: new Date(chunkEnd * 1000).toISOString(),
      granularity: String(granularitySeconds)
    });
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/candles?${params}`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) throw new Error(`Unexpected Coinbase payload for ${productId}`);
    for (const row of payload) {
      const candle = normalizeCandle(row);
      if (candle && candle.time >= startSec && candle.time < endSec) byTime.set(candle.time, candle);
    }
    await sleep(requestDelayMs);
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function missingBarDiagnostics(candles, granularitySeconds) {
  if (!candles.length) return { bars: 0, missingIntervals: 0, largestGapBars: 0 };
  let missingIntervals = 0;
  let largestGapBars = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const gapBars = Math.max(0, Math.round((candles[i].time - candles[i - 1].time) / granularitySeconds) - 1);
    missingIntervals += gapBars;
    largestGapBars = Math.max(largestGapBars, gapBars);
  }
  return { bars: candles.length, missingIntervals, largestGapBars };
}

export async function loadOrFetchDataset(manifest, rootDir) {
  const cachePath = cachePathFor(manifest, rootDir);
  const cached = loadCache(cachePath);
  if (cached) return { dataset: cached, cachePath, source: 'cache' };

  const dataset = { metadata: { fetchedAt: new Date().toISOString() }, products: {} };
  for (const productId of manifest.data.products) {
    dataset.products[productId] = await fetchCoinbaseCandles(productId, {
      start: manifest.data.start,
      end: manifest.data.end,
      granularitySeconds: manifest.data.granularitySeconds
    });
  }
  saveCache(cachePath, dataset);
  return { dataset, cachePath, source: 'network' };
}
