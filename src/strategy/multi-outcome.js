import { Dec } from "../decimal.js";
import { cumulativeBreakpoints, quoteLevels } from "../orderbook.js";

function D(value = 0) { return Dec.from(value); }
function unique(values) {
  const map = new Map(values.map((value) => [D(value).toString(), D(value)]));
  return [...map.values()].sort((a, b) => a.comparedTo(b));
}
function depth(levels) {
  return levels.reduce((sum, level) => sum.plus(level.size), D(0));
}
function idFor(event, shares, books) {
  const text = [event.id, shares.toString(), ...books.map((book) => book.hash ?? book.timestampMs ?? "")].join("|");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `multi-${(hash >>> 0).toString(16).padStart(8, "0")}-${String(event.id).slice(0, 12)}`;
}

export function validateMultiOutcomeEvent(event, options = {}) {
  const reasons = [];
  const markets = event?.markets ?? [];
  if (!event?.negRisk) reasons.push("event-not-negative-risk");
  if (event?.negRiskAugmented) reasons.push("augmented-negative-risk-disabled");
  if (event?.active === false || event?.closed === true) reasons.push("event-not-active");
  if (markets.length < 3) reasons.push("fewer-than-three-outcomes");
  const groupIds = new Set();

  for (const market of markets) {
    if (!market.active || market.closed || !market.acceptingOrders) reasons.push(`inactive-market:${market.id}`);
    if (!market.negRisk) reasons.push(`market-not-negative-risk:${market.id}`);
    if (!market.yesTokenId) reasons.push(`missing-yes-token:${market.id}`);
    if (market.negRiskMarketId) groupIds.add(String(market.negRiskMarketId));
    const label = `${market.groupItemTitle ?? ""} ${market.question ?? ""}`.trim();
    if (market.negRiskOther || /\bother\b/i.test(label)) reasons.push(`unstable-other-outcome:${market.id}`);
    if (market.pendingDeployment || market.deploying) reasons.push(`market-deploying:${market.id}`);
  }

  if (groupIds.size > 1) reasons.push("mixed-negative-risk-groups");
  if (options.requireGroupId && groupIds.size !== 1) reasons.push("missing-negative-risk-group-id");
  return {
    valid: reasons.length === 0,
    reasons,
    outcomeCount: markets.length,
    groupId: [...groupIds][0] ?? null
  };
}

export function findMultiOutcomeOpportunity(event, booksByToken, feeSchedulesByCondition, options) {
  const validation = validateMultiOutcomeEvent(event, options);
  if (!validation.valid) return { validation, opportunity: null };

  const legs = [];
  for (const market of event.markets) {
    const book = booksByToken.get(market.yesTokenId);
    if (!book?.asks?.length) {
      return {
        validation: { ...validation, valid: false, reasons: [...validation.reasons, `missing-book:${market.id}`] },
        opportunity: null
      };
    }
    legs.push({
      market,
      book,
      feeSchedule: feeSchedulesByCondition.get(market.conditionId) ?? { rate: D(0), exponent: 2, takerOnly: true }
    });
  }

  const nowMs = options.nowMs ?? Date.now();
  const oldestBook = Math.min(...legs.map((leg) => Number(leg.book.timestampMs) || nowMs));
  if (nowMs - oldestBook > options.maxBookAgeMs) {
    return {
      validation: { ...validation, valid: false, reasons: [...validation.reasons, "stale-books"] },
      opportunity: null
    };
  }

  const cap = Dec.min(D(options.maxShares), ...legs.map((leg) => depth(leg.book.asks)));
  if (cap.lte(0)) return { validation, opportunity: null };
  const minOrder = Dec.max(...legs.map((leg) => D(leg.book.minOrderSize ?? 0)));
  const quantities = unique([
    ...legs.flatMap((leg) => cumulativeBreakpoints(leg.book.asks, cap)),
    cap
  ]).filter((quantity) => quantity.gte(minOrder));

  let best = null;
  for (const shares of quantities) {
    const quoted = legs.map((leg) => ({
      market: leg.market,
      quote: quoteLevels(leg.market.yesTokenId, "BUY", leg.book.asks, shares, leg.feeSchedule)
    }));
    if (quoted.some((leg) => !leg.quote)) continue;

    const cost = quoted.reduce((sum, leg) => sum.plus(leg.quote.notional), D(0));
    const fees = quoted.reduce((sum, leg) => sum.plus(leg.quote.fee), D(0));
    const buffer = cost.mul(options.safetyBufferBps).div(10_000);
    const fixed = D(options.fixedCostUsd ?? 0);
    const net = shares.minus(cost).minus(fees).minus(buffer).minus(fixed);
    const roi = cost.plus(fees).gt(0) ? net.div(cost.plus(fees)).mul(10_000) : D(0);
    if (net.lt(options.minNetProfitUsd) || roi.lt(options.minRoiBps)) continue;

    const candidate = {
      id: idFor(event, shares, legs.map((leg) => leg.book)),
      strategy: "MULTI_OUTCOME_COMPLETE_SET",
      direction: "BUY_ALL_YES",
      detectedAt: new Date(nowMs).toISOString(),
      eventId: String(event.id),
      question: event.title,
      slug: event.slug,
      shares,
      grossPayout: shares,
      grossCost: cost,
      fees,
      safetyBuffer: buffer,
      fixedCosts: fixed,
      netProfit: net,
      roiBps: roi,
      outcomeCount: event.markets.length,
      legs: quoted.map((leg) => ({
        marketId: leg.market.id,
        conditionId: leg.market.conditionId,
        label: leg.market.groupItemTitle || leg.market.question,
        tokenId: leg.market.yesTokenId,
        averagePrice: leg.quote.averagePrice,
        worstPrice: leg.quote.worstPrice,
        notional: leg.quote.notional,
        fee: leg.quote.fee
      })),
      warnings: [
        "Paper opportunity only; all outcome legs must fill.",
        "Negative-risk conversion and live orders are not implemented."
      ]
    };
    if (!best || candidate.netProfit.gt(best.netProfit)) best = candidate;
  }

  return { validation, opportunity: best };
}
