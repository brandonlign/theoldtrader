import { Dec } from "../decimal.js";
import { fetchJson } from "./http.js";

function stringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseFeeSchedule(value) {
  if (!value || value.rate === undefined) return undefined;
  const exponent = Number(value.exponent ?? 2);
  if (!Number.isFinite(exponent)) return undefined;
  return { rate: new Dec(value.rate), exponent, takerOnly: value.takerOnly ?? true };
}

function normalizeMarket(raw) {
  const outcomes = stringArray(raw.outcomes);
  const tokenIds = stringArray(raw.clobTokenIds);
  if (!raw.conditionId || !raw.question || !raw.slug || tokenIds.length !== 2 || outcomes.length !== 2) return null;

  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0) return null;
  const yesTokenId = tokenIds[yesIndex];
  const noTokenId = tokenIds[noIndex];
  if (!yesTokenId || !noTokenId) return null;

  const market = {
    id: String(raw.id ?? raw.conditionId),
    conditionId: raw.conditionId,
    question: raw.question,
    slug: raw.slug,
    yesTokenId,
    noTokenId,
    active: raw.active ?? false,
    closed: raw.closed ?? false,
    acceptingOrders: raw.acceptingOrders ?? false,
    negRisk: raw.negRisk ?? false,
    feesEnabled: raw.feesEnabled ?? false
  };
  const feeSchedule = parseFeeSchedule(raw.feeSchedule);
  if (feeSchedule) market.feeSchedule = feeSchedule;
  return market;
}

export class GammaClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async listActiveBinaryMarkets(maxMarkets, pageSize) {
    const markets = [];
    let offset = 0;

    while (markets.length < maxMarkets) {
      const limit = Math.min(pageSize, maxMarkets - markets.length);
      const url = new URL("/markets", this.baseUrl);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("enable_order_book", "true");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("order", "volume24hr");
      url.searchParams.set("ascending", "false");

      const page = await fetchJson(url.toString(), {}, this.timeoutMs);
      if (!Array.isArray(page) || page.length === 0) break;

      for (const raw of page) {
        const market = normalizeMarket(raw);
        if (market && market.active && !market.closed && market.acceptingOrders) markets.push(market);
        if (markets.length >= maxMarkets) break;
      }

      offset += page.length;
      if (page.length < limit) break;
    }

    return markets;
  }
}
