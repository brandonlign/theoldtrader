import { createHash } from "node:crypto";
import { Dec } from "../decimal.js";
import { cumulativeBreakpoints, quoteLevels } from "../orderbook.js";

function uniqueSorted(values) {
  const byValue = new Map(values.map((value) => [value.toString(), value]));
  return [...byValue.values()].sort((a, b) => a.comparedTo(b));
}

function opportunityId(market, direction, yesHash, noHash, shares) {
  return createHash("sha256")
    .update([market.conditionId, direction, yesHash ?? "", noHash ?? "", shares.toString()].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function warningList(yesBook, noBook, direction, feeSchedule) {
  const warnings = [
    "Paper opportunity only; no real orders are submitted.",
    "Two CLOB legs are not atomic, so live execution would have legging risk."
  ];
  warnings.push(direction === "BUY_AND_MERGE"
    ? "Live completion would also require an on-chain merge operation."
    : "Live completion would require splitting collateral before selling both legs.");
  if (yesBook.negRisk || noBook.negRisk) {
    warnings.push("Market is marked neg-risk; this detector still evaluates only its binary YES/NO complete set.");
  }
  if (feeSchedule.exponent !== 2) {
    warnings.push(`Unusual fee exponent ${feeSchedule.exponent}; validate the protocol fee curve before live use.`);
  }
  return warnings;
}

function sumDepth(levels) {
  return levels.reduce((sum, level) => sum.plus(level.size), new Dec(0));
}

function evaluateDirection(market, yesBook, noBook, feeSchedule, direction, options) {
  const yesLevels = direction === "BUY_AND_MERGE" ? yesBook.asks : yesBook.bids;
  const noLevels = direction === "BUY_AND_MERGE" ? noBook.asks : noBook.bids;
  if (yesLevels.length === 0 || noLevels.length === 0) return null;

  const cap = Dec.min(options.maxShares, sumDepth(yesLevels), sumDepth(noLevels));
  if (cap.lte(0)) return null;

  const minOrderSize = Dec.max(yesBook.minOrderSize, noBook.minOrderSize);
  const quantities = uniqueSorted([
    ...cumulativeBreakpoints(yesLevels, cap),
    ...cumulativeBreakpoints(noLevels, cap),
    cap
  ]).filter((quantity) => quantity.gte(minOrderSize));

  const bookTimestampMs = Math.min(yesBook.timestampMs, noBook.timestampMs);
  const bookAgeMs = Math.max(0, options.nowMs - bookTimestampMs);
  if (bookAgeMs > options.maxBookAgeMs) return null;

  let best = null;
  for (const shares of quantities) {
    const side = direction === "BUY_AND_MERGE" ? "BUY" : "SELL";
    const yesLeg = quoteLevels(market.yesTokenId, side, yesLevels, shares, feeSchedule);
    const noLeg = quoteLevels(market.noTokenId, side, noLevels, shares, feeSchedule);
    if (!yesLeg || !noLeg) continue;

    const totalNotional = yesLeg.notional.plus(noLeg.notional);
    const fees = yesLeg.fee.plus(noLeg.fee);
    const reference = direction === "BUY_AND_MERGE" ? totalNotional : shares;
    const safetyBuffer = reference.mul(options.safetyBufferBps).div(10_000);
    const grossPayoutOrRevenue = direction === "BUY_AND_MERGE" ? shares : totalNotional;
    const grossCost = direction === "BUY_AND_MERGE" ? totalNotional : shares;
    const netProfit = grossPayoutOrRevenue
      .minus(grossCost)
      .minus(fees)
      .minus(safetyBuffer)
      .minus(options.fixedCostUsd);
    const roiDenominator = direction === "BUY_AND_MERGE" ? totalNotional.plus(fees) : shares;
    const roiBps = roiDenominator.gt(0) ? netProfit.div(roiDenominator).mul(10_000) : new Dec(0);

    if (netProfit.lt(options.minNetProfitUsd) || roiBps.lt(options.minRoiBps)) continue;

    const candidate = {
      id: opportunityId(market, direction, yesBook.hash, noBook.hash, shares),
      detectedAt: new Date(options.nowMs).toISOString(),
      marketId: market.id,
      conditionId: market.conditionId,
      question: market.question,
      slug: market.slug,
      direction,
      shares,
      grossPayoutOrRevenue,
      grossCost,
      fees,
      safetyBuffer,
      fixedCosts: options.fixedCostUsd,
      netProfit,
      roiBps,
      yesLeg,
      noLeg,
      bookTimestampMs,
      bookAgeMs,
      feeSchedule,
      warnings: warningList(yesBook, noBook, direction, feeSchedule)
    };

    if (!best || candidate.netProfit.gt(best.netProfit)) best = candidate;
  }
  return best;
}

export function findCompleteSetOpportunities(market, yesBook, noBook, feeSchedule, options) {
  if (yesBook.market !== market.conditionId || noBook.market !== market.conditionId) return [];
  return ["BUY_AND_MERGE", "SPLIT_AND_SELL"]
    .map((direction) => evaluateDirection(market, yesBook, noBook, feeSchedule, direction, options))
    .filter(Boolean)
    .sort((a, b) => b.netProfit.comparedTo(a.netProfit));
}
