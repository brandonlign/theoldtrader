function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function retryDelayMs({ attempt = 0, retryAfter = null, baseMs = 750, maxMs = 5_000 } = {}) {
  const parsedRetryAfter = Number(retryAfter);
  if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0) {
    return Math.min(maxMs, Math.max(100, parsedRetryAfter * 1_000));
  }
  return Math.min(maxMs, Math.max(100, baseMs * (2 ** Math.max(0, attempt))));
}

async function parsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function platformFetch(...args) {
  return fetch(...args);
}

export class CoinbasePublicClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.exchange.coinbase.com";
    this.timeoutMs = finite(options.timeoutMs, 10_000);
    this.maxRetries = Math.max(0, Math.min(4, Math.trunc(finite(options.maxRetries, 2))));
    this.retryBaseMs = Math.max(100, finite(options.retryBaseMs, 750));
    this.minRequestIntervalMs = Math.max(0, finite(options.minRequestIntervalMs, 250));
    this.fetchImpl = options.fetchImpl ?? platformFetch;
    this.nextRequestAt = 0;
  }

  async waitForRequestSlot() {
    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
  }

  async fetchJson(url) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1_000, this.timeoutMs));
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "cache-control": "no-cache",
            "user-agent": "MoneyMog-paper-research/2.0"
          }
        });
        const payload = await parsePayload(response);
        if (response.ok) return payload;

        const message = payload?.message ?? `Coinbase returned ${response.status}`;
        if (response.status === 429 && attempt < this.maxRetries) {
          await sleep(retryDelayMs({
            attempt,
            retryAfter: response.headers.get("retry-after"),
            baseMs: this.retryBaseMs
          }));
          continue;
        }

        const error = new Error(message);
        error.status = response.status;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Coinbase request exhausted retries");
  }

  async getCandles(productId, options = {}) {
    const granularity = Math.max(60, Math.trunc(finite(options.granularity, 300)));
    const url = new URL(`/products/${encodeURIComponent(productId)}/candles`, this.baseUrl);
    url.searchParams.set("granularity", String(granularity));
    const rows = await this.fetchJson(url);
    if (!Array.isArray(rows)) throw new Error(`Invalid candle response for ${productId}`);
    return rows.map((row) => ({
      time: finite(row[0]),
      low: finite(row[1]),
      high: finite(row[2]),
      open: finite(row[3]),
      close: finite(row[4]),
      volume: finite(row[5])
    })).filter((item) => item.time > 0 && item.close > 0)
      .sort((left, right) => left.time - right.time);
  }

  async getBook(productId) {
    const url = new URL(`/products/${encodeURIComponent(productId)}/book`, this.baseUrl);
    url.searchParams.set("level", "1");
    const payload = await this.fetchJson(url);
    const bid = payload?.bids?.[0] ?? [];
    const ask = payload?.asks?.[0] ?? [];
    const bestBid = finite(bid[0]);
    const bestAsk = finite(ask[0]);
    return {
      productId,
      bestBid,
      bestAsk,
      bidSize: finite(bid[1]),
      askSize: finite(ask[1]),
      mid: bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Math.max(bestBid, bestAsk),
      time: payload?.time ?? new Date().toISOString()
    };
  }
}
