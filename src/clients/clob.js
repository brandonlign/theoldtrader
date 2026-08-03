import { Dec } from "../decimal.js";
import { fetchJson } from "./http.js";

function parseTimestamp(value) {
  if (value === undefined) return Date.now();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function parseLevels(levels, descending) {
  return (levels ?? [])
    .map((level) => ({ price: new Dec(level.price), size: new Dec(level.size) }))
    .filter((level) => level.price.gt(0) && level.price.lt(1) && level.size.gt(0))
    .sort((a, b) => descending ? b.price.comparedTo(a.price) : a.price.comparedTo(b.price));
}

function normalizeBook(raw) {
  if (!raw.market || !raw.asset_id) return null;
  const book = {
    market: raw.market,
    assetId: raw.asset_id,
    timestampMs: parseTimestamp(raw.timestamp),
    bids: parseLevels(raw.bids, true),
    asks: parseLevels(raw.asks, false),
    minOrderSize: new Dec(raw.min_order_size ?? 0),
    tickSize: new Dec(raw.tick_size ?? 0.01),
    negRisk: raw.neg_risk ?? false
  };
  if (raw.hash) book.hash = raw.hash;
  return book;
}

function chunks(values, size) {
  const output = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size));
  return output;
}

export class ClobClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async getOrderBooks(tokenIds, batchSize) {
    const books = new Map();
    for (const batch of chunks(tokenIds, batchSize)) {
      const url = new URL("/books", this.baseUrl);
      const rawBooks = await fetchJson(
        url.toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch.map((tokenId) => ({ token_id: tokenId })))
        },
        this.timeoutMs
      );

      for (const raw of rawBooks) {
        const book = normalizeBook(raw);
        if (book) books.set(book.assetId, book);
      }
    }
    return books;
  }

  async getFeeSchedule(conditionId) {
    const url = new URL(`/clob-markets/${encodeURIComponent(conditionId)}`, this.baseUrl);
    const info = await fetchJson(url.toString(), {}, this.timeoutMs);
    const exponent = Number(info.fd?.e ?? 2);
    if (!Number.isFinite(exponent)) throw new Error(`Invalid fee schedule for ${conditionId}`);
    return { rate: new Dec(info.fd?.r ?? 0), exponent, takerOnly: info.fd?.to ?? true };
  }
}
