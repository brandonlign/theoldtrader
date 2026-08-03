import { loadConfig } from "../../../src/config.js";
import { Dec } from "../../../src/decimal.js";
import { StructuralArbitrageScanner } from "../../../src/scanner.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nonNegativeDecimal(value, fallback) {
  try {
    const parsed = new Dec(value ?? fallback);
    return parsed.gte(0) ? parsed : new Dec(fallback);
  } catch {
    return new Dec(fallback);
  }
}

function positiveDecimal(value, fallback) {
  try {
    const parsed = new Dec(value ?? fallback);
    return parsed.gt(0) ? parsed : new Dec(fallback);
  } catch {
    return new Dec(fallback);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const base = loadConfig();
    const config = {
      ...base,
      maxMarkets: boundedInteger(body.maxMarkets, Math.min(base.maxMarkets, 120), 25, 250),
      maxShares: positiveDecimal(body.maxShares, base.maxShares),
      minNetProfitUsd: nonNegativeDecimal(body.minNetProfitUsd, base.minNetProfitUsd),
      minRoiBps: nonNegativeDecimal(body.minRoiBps, base.minRoiBps),
      safetyBufferBps: nonNegativeDecimal(body.safetyBufferBps, base.safetyBufferBps)
    };

    const scanner = new StructuralArbitrageScanner(config);
    const result = await scanner.scan();

    return Response.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("MoneyMog scan failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "The market scan failed."
    }, {
      status: 500,
      headers: { "cache-control": "no-store" }
    });
  }
}
