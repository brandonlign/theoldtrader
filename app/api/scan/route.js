import { loadConfig } from "../../../src/config.js";
import { Dec } from "../../../src/decimal.js";
import { MultiOutcomeScanner } from "../../../src/multi-outcome-scanner.js";
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

function prefixedSkipped(prefix, skipped) {
  return Object.fromEntries(Object.entries(skipped ?? {}).map(([reason, count]) => [`${prefix}: ${reason}`, count]));
}

function routeLabel(opportunity) {
  if (opportunity.direction === "BUY_ALL_YES") return "Buy every outcome";
  return opportunity.direction === "BUY_AND_MERGE" ? "Buy both → merge" : "Split → sell both";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const base = loadConfig();
    const config = {
      ...base,
      maxMarkets: boundedInteger(body.maxMarkets, Math.min(base.maxMarkets, 120), 25, 250),
      maxMultiOutcomeEvents: boundedInteger(body.maxMultiOutcomeEvents, Math.min(base.maxMultiOutcomeEvents, 30), 1, 60),
      maxShares: positiveDecimal(body.maxShares, base.maxShares),
      minNetProfitUsd: nonNegativeDecimal(body.minNetProfitUsd, base.minNetProfitUsd),
      minRoiBps: nonNegativeDecimal(body.minRoiBps, base.minRoiBps),
      safetyBufferBps: nonNegativeDecimal(body.safetyBufferBps, base.safetyBufferBps)
    };

    const [binaryResult, multiResult] = await Promise.allSettled([
      new StructuralArbitrageScanner(config).scan(),
      new MultiOutcomeScanner(config).scan()
    ]);
    if (binaryResult.status === "rejected" && multiResult.status === "rejected") {
      throw binaryResult.reason;
    }

    const binary = binaryResult.status === "fulfilled" ? binaryResult.value : null;
    const multi = multiResult.status === "fulfilled" ? multiResult.value : null;
    const opportunities = [
      ...(binary?.opportunities ?? []),
      ...(multi?.opportunities ?? [])
    ].map((opportunity) => ({ ...opportunity, routeLabel: routeLabel(opportunity) }))
      .sort((a, b) => Number(b.netProfit) - Number(a.netProfit));

    return Response.json({
      scannedAt: new Date().toISOString(),
      marketsDiscovered: (binary?.marketsDiscovered ?? 0) + (multi?.eventsDiscovered ?? 0),
      binaryMarketsDiscovered: binary?.marketsDiscovered ?? 0,
      multiOutcomeEventsDiscovered: multi?.eventsDiscovered ?? 0,
      multiOutcomeEventsValidated: multi?.eventsValidated ?? 0,
      marketsWithBooks: binary?.marketsWithBooks ?? 0,
      opportunities,
      strategyCounts: {
        binaryCompleteSet: binary?.opportunities?.length ?? 0,
        multiOutcomeCompleteSet: multi?.opportunities?.length ?? 0
      },
      skipped: {
        ...prefixedSkipped("binary", binary?.skipped),
        ...prefixedSkipped("multi", multi?.skipped)
      },
      strategyErrors: {
        binary: binaryResult.status === "rejected" ? String(binaryResult.reason?.message ?? binaryResult.reason) : null,
        multiOutcome: multiResult.status === "rejected" ? String(multiOutcome?.message ?? multiOutcome) : null
      }
    }, {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("TheOldTrader scan failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "The market scan failed."
    }, {
      status: 500,
      headers: { "cache-control": "no-store" }
    });
  }
}
