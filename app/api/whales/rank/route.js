import { DataApiClient } from "../../../../src/clients/data-api.js";
import { discoverWhales } from "../../../../src/whales/discovery.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_CATEGORIES = new Set(["OVERALL", "POLITICS", "SPORTS", "CRYPTO", "CULTURE", "WEATHER", "ECONOMICS", "TECH", "FINANCE"]);

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const categories = (Array.isArray(body.categories) ? body.categories : ["OVERALL", "POLITICS", "CRYPTO", "FINANCE"])
      .map((category) => String(category).toUpperCase())
      .filter((category) => ALLOWED_CATEGORIES.has(category))
      .slice(0, 4);
    const dataApi = new DataApiClient(
      process.env.DATA_API_BASE_URL ?? "https://data-api.polymarket.com",
      integer(process.env.MONEYMOG_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000)
    );
    const result = await discoverWhales(dataApi, {
      categories: categories.length ? categories : ["OVERALL"],
      leaderboardLimit: integer(body.leaderboardLimit, 8, 3, 12),
      maxCandidates: integer(body.maxCandidates, 12, 3, 16),
      maxClosedPositions: integer(body.maxClosedPositions, 50, 10, 100),
      recommendedCount: integer(body.recommendedCount, 10, 1, 15),
      concurrency: 3
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("MoneyMog whale ranking failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Wallet ranking failed." }, {
      status: 500,
      headers: { "cache-control": "no-store" }
    });
  }
}
