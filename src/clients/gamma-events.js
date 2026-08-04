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

function parseFeeSchedule(raw) {
  if (!raw || raw.rate === undefined) return undefined;
  return {
    rate: new Dec(raw.rate),
    exponent: Number(raw.exponent ?? 2),
    takerOnly: raw.takerOnly ?? true
  };
}

function normalizeMarket(raw) {
  const outcomes = stringArray(raw.outcomes);
  const tokenIds = stringArray(raw.clobTokenIds);
  const yesIndex = outcomes.findIndex((value) => value.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((value) => value.toLowerCase() === "no");
  if (!raw.id || !raw.conditionId || yesIndex < 0 || noIndex < 0 || !tokenIds[yesIndex]) return null;
  return {
    id: String(raw.id),
    conditionId: String(raw.conditionId),
    question: String(raw.question ?? ""),
    slug: String(raw.slug ?? ""),
    groupItemTitle: String(raw.groupItemTitle ?? raw.groupItemLabel ?? ""),
    yesTokenId: tokenIds[yesIndex],
    noTokenId: tokenIds[noIndex],
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    acceptingOrders: Boolean(raw.acceptingOrders),
    enableOrderBook: Boolean(raw.enableOrderBook ?? raw.enable_order_book),
    negRisk: Boolean(raw.negRisk),
    negRiskOther: Boolean(raw.negRiskOther),
    negRiskMarketId: String(raw.negRiskMarketID ?? raw.negRiskMarketId ?? ""),
    pendingDeployment: Boolean(raw.pendingDeployment),
    deploying: Boolean(raw.deploying),
    feesEnabled: Boolean(raw.feesEnabled),
    feeSchedule: parseFeeSchedule(raw.feeSchedule)
  };
}

function normalizeEvent(raw) {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    slug: String(raw.slug ?? ""),
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    negRisk: Boolean(raw.negRisk),
    enableNegRisk: Boolean(raw.enableNegRisk),
    negRiskAugmented: Boolean(raw.negRiskAugmented),
    markets: (raw.markets ?? []).map(normalizeMarket).filter(Boolean)
  };
}

export class GammaEventsClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async listActiveNegRiskEvents(maxEvents = 100, pageSize = 50) {
    const output = [];
    let offset = 0;
    while (output.length < maxEvents) {
      const limit = Math.min(pageSize, maxEvents - output.length);
      const url = new URL("/events", this.baseUrl);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("order", "volume24hr");
      url.searchParams.set("ascending", "false");
      const page = await fetchJson(url.toString(), {}, this.timeoutMs);
      if (!Array.isArray(page) || !page.length) break;
      for (const raw of page) {
        const event = normalizeEvent(raw);
        if (event.negRisk && event.active && !event.closed && event.markets.length >= 3) output.push(event);
        if (output.length >= maxEvents) break;
      }
      offset += page.length;
      if (page.length < limit) break;
    }
    return output;
  }
}
