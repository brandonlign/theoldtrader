import { fetchJson } from "./http.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const CATEGORY_SET = new Set(["OVERALL","POLITICS","SPORTS","CRYPTO","CULTURE","MENTIONS","WEATHER","ECONOMICS","TECH","FINANCE"]);

function requireWallet(wallet) {
  const value = String(wallet ?? "").trim();
  if (!WALLET_RE.test(value)) throw new Error(`Invalid Polymarket wallet: ${value || "<empty>"}`);
  return value.toLowerCase();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTrade(raw) {
  if (!raw?.proxyWallet || !raw.asset || !raw.conditionId || !raw.side) return null;
  return {
    proxyWallet: String(raw.proxyWallet).toLowerCase(),
    side: String(raw.side).toUpperCase(),
    asset: String(raw.asset),
    conditionId: String(raw.conditionId),
    size: number(raw.size),
    price: number(raw.price),
    timestamp: number(raw.timestamp),
    title: String(raw.title ?? ""),
    slug: String(raw.slug ?? ""),
    eventSlug: String(raw.eventSlug ?? ""),
    outcome: String(raw.outcome ?? ""),
    outcomeIndex: number(raw.outcomeIndex),
    transactionHash: String(raw.transactionHash ?? ""),
    name: String(raw.name ?? raw.pseudonym ?? "")
  };
}

function normalizePosition(raw) {
  if (!raw?.asset || !raw.conditionId) return null;
  return {
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    asset: String(raw.asset),
    conditionId: String(raw.conditionId),
    size: number(raw.size),
    avgPrice: number(raw.avgPrice),
    initialValue: number(raw.initialValue),
    currentValue: number(raw.currentValue),
    cashPnl: number(raw.cashPnl),
    realizedPnl: number(raw.realizedPnl),
    totalBought: number(raw.totalBought),
    curPrice: number(raw.curPrice),
    title: String(raw.title ?? ""),
    slug: String(raw.slug ?? ""),
    eventSlug: String(raw.eventSlug ?? ""),
    outcome: String(raw.outcome ?? ""),
    outcomeIndex: number(raw.outcomeIndex),
    endDate: String(raw.endDate ?? "")
  };
}

function normalizeClosedPosition(raw) {
  if (!raw?.asset || !raw.conditionId) return null;
  return {
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    asset: String(raw.asset),
    conditionId: String(raw.conditionId),
    avgPrice: number(raw.avgPrice),
    totalBought: number(raw.totalBought),
    realizedPnl: number(raw.realizedPnl),
    timestamp: number(raw.timestamp),
    title: String(raw.title ?? ""),
    slug: String(raw.slug ?? ""),
    eventSlug: String(raw.eventSlug ?? ""),
    outcome: String(raw.outcome ?? ""),
    outcomeIndex: number(raw.outcomeIndex),
    endDate: String(raw.endDate ?? "")
  };
}

export class DataApiClient {
  constructor(baseUrl = "https://data-api.polymarket.com", timeoutMs = 10_000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async leaderboard({ category = "OVERALL", timePeriod = "ALL", orderBy = "PNL", limit = 25, offset = 0 } = {}) {
    const normalizedCategory = String(category).toUpperCase();
    if (!CATEGORY_SET.has(normalizedCategory)) throw new Error(`Unsupported leaderboard category: ${category}`);
    const url = new URL("/v1/leaderboard", this.baseUrl);
    url.searchParams.set("category", normalizedCategory);
    url.searchParams.set("timePeriod", String(timePeriod).toUpperCase());
    url.searchParams.set("orderBy", String(orderBy).toUpperCase());
    url.searchParams.set("limit", String(Math.min(50, Math.max(1, Number(limit) || 25))));
    url.searchParams.set("offset", String(Math.max(0, Number(offset) || 0)));
    const rows = await fetchJson(url.toString(), {}, this.timeoutMs);
    return (rows ?? []).map((raw) => ({
      rank: number(raw.rank, 9999),
      proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
      userName: String(raw.userName ?? ""),
      volume: number(raw.vol),
      pnl: number(raw.pnl),
      profileImage: String(raw.profileImage ?? ""),
      xUsername: String(raw.xUsername ?? ""),
      verifiedBadge: Boolean(raw.verifiedBadge),
      category: normalizedCategory,
      timePeriod: String(timePeriod).toUpperCase()
    })).filter((row) => WALLET_RE.test(row.proxyWallet));
  }

  async trades(wallet, { limit = 100, offset = 0, takerOnly = true } = {}) {
    const url = new URL("/trades", this.baseUrl);
    url.searchParams.set("user", requireWallet(wallet));
    url.searchParams.set("limit", String(Math.min(10_000, Math.max(1, Number(limit) || 100))));
    url.searchParams.set("offset", String(Math.max(0, Number(offset) || 0)));
    url.searchParams.set("takerOnly", String(Boolean(takerOnly)));
    const rows = await fetchJson(url.toString(), {}, this.timeoutMs);
    return (rows ?? []).map(normalizeTrade).filter(Boolean);
  }

  async positions(wallet, { limit = 500, sizeThreshold = 0 } = {}) {
    const url = new URL("/positions", this.baseUrl);
    url.searchParams.set("user", requireWallet(wallet));
    url.searchParams.set("limit", String(Math.min(500, Math.max(1, Number(limit) || 500))));
    url.searchParams.set("sizeThreshold", String(Math.max(0, Number(sizeThreshold) || 0)));
    const rows = await fetchJson(url.toString(), {}, this.timeoutMs);
    return (rows ?? []).map(normalizePosition).filter(Boolean);
  }

  async closedPositions(wallet, { maxPositions = 150 } = {}) {
    const address = requireWallet(wallet);
    const rows = [];
    let offset = 0;
    while (rows.length < maxPositions) {
      const limit = Math.min(50, maxPositions - rows.length);
      const url = new URL("/closed-positions", this.baseUrl);
      url.searchParams.set("user", address);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("sortBy", "TIMESTAMP");
      url.searchParams.set("sortDirection", "DESC");
      const page = await fetchJson(url.toString(), {}, this.timeoutMs);
      if (!Array.isArray(page) || page.length === 0) break;
      rows.push(...page.map(normalizeClosedPosition).filter(Boolean));
      offset += page.length;
      if (page.length < limit) break;
    }
    return rows;
  }

  async tradedCount(wallet) {
    const url = new URL("/traded", this.baseUrl);
    url.searchParams.set("user", requireWallet(wallet));
    const row = await fetchJson(url.toString(), {}, this.timeoutMs);
    return Math.max(0, Math.trunc(number(row?.traded)));
  }
}
