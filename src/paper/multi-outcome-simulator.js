import { Dec } from "../decimal.js";
import { quoteAvailable } from "./realistic-simulator.js";

function D(value = 0) { return Dec.from(value); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function asIso(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

function exactQuote(tokenId, fills, shares, feeSchedule) {
  return quoteAvailable(tokenId, "BUY", fills, shares, feeSchedule, { liquidityHaircut: 1 });
}

export function simulateMultiOutcomeExecution(input, options = {}) {
  const detectedAt = asIso(input.detectedAt ?? Date.now());
  const executedAt = asIso(input.executedAt ?? Date.now());
  if (!detectedAt || !executedAt) throw new Error("Invalid execution timestamp");
  const executedMs = Date.parse(executedAt);
  const delayMs = Math.max(0, executedMs - Date.parse(detectedAt));
  const requestedShares = D(input.shares);
  const fixedCost = D(options.fixedCostUsd ?? 0);
  const minFillRatio = D(options.minPairedFillRatio ?? "0.9");
  const maxBookAgeMs = number(options.maxBookAgeMs, 15_000);
  const liquidityHaircut = number(options.liquidityHaircut, 0.8);
  const reasons = [];

  if (delayMs < number(options.executionDelayMs, 0)) reasons.push("execution-delay-not-elapsed");
  if (!Array.isArray(input.legs) || input.legs.length < 3) reasons.push("incomplete-outcome-set");
  if ((input.legs ?? []).some((leg) => executedMs - number(leg.book?.timestampMs, executedMs) > maxBookAgeMs)) {
    reasons.push("stale-execution-book");
  }

  const quotes = (input.legs ?? []).map((leg) => ({
    tokenId: leg.tokenId,
    label: leg.label,
    feeSchedule: leg.feeSchedule ?? { rate: D(0), exponent: 2, takerOnly: true },
    quote: quoteAvailable(
      leg.tokenId,
      "BUY",
      leg.book?.asks,
      requestedShares,
      leg.feeSchedule ?? { rate: D(0), exponent: 2, takerOnly: true },
      { liquidityHaircut }
    )
  }));

  const pairedShares = quotes.length
    ? Dec.min(...quotes.map((leg) => leg.quote?.filledShares ?? D(0)))
    : D(0);
  const pairedFillRatio = requestedShares.gt(0) ? pairedShares.div(requestedShares) : D(0);
  if (pairedShares.lte(0)) reasons.push("no-complete-set-fill");
  if (pairedFillRatio.lt(minFillRatio)) reasons.push("paired-fill-below-threshold");

  const pairedQuotes = quotes.map((leg) => ({
    ...leg,
    paired: pairedShares.gt(0)
      ? exactQuote(leg.tokenId, leg.quote?.fills ?? [], pairedShares, leg.feeSchedule)
      : null
  }));
  const totalCost = quotes.reduce((sum, leg) =>
    sum.plus(leg.quote?.notional ?? 0).plus(leg.quote?.fee ?? 0), D(0)).plus(fixedCost);
  const pairedCost = pairedQuotes.reduce((sum, leg) =>
    sum.plus(leg.paired?.notional ?? 0).plus(leg.paired?.fee ?? 0), D(0));
  const guaranteedProfit = pairedShares.minus(pairedCost).minus(fixedCost);
  const cashDelta = pairedShares.minus(totalCost);
  const openInventory = [];

  for (const leg of pairedQuotes) {
    const filled = leg.quote?.filledShares ?? D(0);
    const unmatched = filled.minus(pairedShares);
    if (unmatched.lte(0)) continue;
    const fullCost = (leg.quote?.notional ?? D(0)).plus(leg.quote?.fee ?? 0);
    const matchedCost = (leg.paired?.notional ?? D(0)).plus(leg.paired?.fee ?? 0);
    openInventory.push({
      tokenId: leg.tokenId,
      label: leg.label,
      side: "LONG",
      shares: unmatched,
      costBasis: fullCost.minus(matchedCost)
    });
  }

  const rejected = reasons.includes("execution-delay-not-elapsed") || reasons.includes("stale-execution-book") || reasons.includes("incomplete-outcome-set");
  const status = rejected
    ? "REJECTED"
    : pairedShares.lte(0)
      ? "FAILED"
      : openInventory.length || pairedFillRatio.lt(1)
        ? "PARTIAL_EXPOSURE"
        : "FILLED";

  return {
    id: String(input.id),
    strategy: "MULTI_OUTCOME_COMPLETE_SET",
    direction: "BUY_ALL_YES",
    detectedAt,
    executedAt,
    detectionToExecutionMs: delayMs,
    requestedShares,
    pairedShares,
    pairedFillRatio,
    legs: quotes,
    guaranteedProfit,
    cashDelta,
    capitalRequired: totalCost,
    openInventory,
    status,
    reasons,
    assumptions: { liquidityHaircut, minPairedFillRatio: minFillRatio, maxBookAgeMs }
  };
}
