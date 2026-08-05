function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "user-agent": "MoneyMog-paper-research/1.0"
      }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message ?? `Coinbase returned ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export class CoinbasePublicClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.exchange.coinbase.com";
    this.timeoutMs = finite(options.timeoutMs, 10_000);
  }

  async getCandles(productId, options = {}) {
    const granularity = Math.max(60, Math.trunc(finite(options.granularity, 300)));
    const url = new URL(`/products/${encodeURIComponent(productId)}/candles`, this.baseUrl);
    url.searchParams.set("granularity", String(granularity));
    const rows = await fetchJson(url, this.timeoutMs);
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
    const payload = await fetchJson(url, this.timeoutMs);
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
