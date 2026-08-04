import { Dec } from "../decimal.js";
import { calculateTakerFee } from "../fees.js";

function D(value = 0) { return Dec.from(value); }
function num(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function iso(value) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

function adjustedLevels(levels = [], liquidityHaircut = 1) {
  const factor = Math.max(0, Math.min(1, num(liquidityHaircut, 1)));
  return levels.map((level) => ({
    price: D(level.price),
    size: D(level.size).mul(factor)
  })).filter((level) => level.price.gt(0) && level.price.lt(1) && level.size.gt(0));
}

export function quoteAvailable(tokenId, side, levels, requestedShares, feeSchedule, options = {}) {
  const requested = D(requestedShares);
  if (requested.lte(0)) return null;
  const usable = adjustedLevels(levels, options.liquidityHaircut ?? 1);
  let remaining = requested;
  let filled = D(0);
  let notional = D(0);
  let fee = D(0);
  const fills = [];
  for (const level of usable) {
    if (remaining.lte(0)) break;
    const size = Dec.min(remaining, level.size);
    if (size.lte(0)) continue;
    const fillNotional = size.mul(level.price);
    const fillFee = calculateTakerFee(size, level.price, feeSchedule);
    fills.push({ price: level.price, size, notional: fillNotional, fee: fillFee });
    filled = filled.plus(size);
    remaining = remaining.minus(size);
    notional = notional.plus(fillNotional);
    fee = fee.plus(fillFee);
  }
  if (filled.lte(0)) return null;
  return {
    tokenId,
    side,
    requestedShares: requested,
    filledShares: filled,
    fillRatio: filled.div(requested),
    notional,
    fee,
    averagePrice: notional.div(filled),
    worstPrice: fills.at(-1).price,
    complete: remaining.lte(0),
    fills
  };
}

function quoteExact(tokenId, side, fills, shares, feeSchedule) {
  return quoteAvailable(tokenId, side, fills, shares, feeSchedule, { liquidityHaircut: 1 });
}

function bookAge(book, executionMs) {
  return Math.max(0, executionMs - num(book?.timestampMs, executionMs));
}

function chooseLegOrder(direction, yesBook, noBook, requestedOrder = "WORST_FIRST") {
  if (requestedOrder === "YES_FIRST" || requestedOrder === "NO_FIRST") return requestedOrder;
  const side = direction === "BUY_AND_MERGE" ? "asks" : "bids";
  const yes = num(yesBook?.[side]?.[0]?.price, direction === "BUY_AND_MERGE" ? 1 : 0);
  const no = num(noBook?.[side]?.[0]?.price, direction === "BUY_AND_MERGE" ? 1 : 0);
  if (direction === "BUY_AND_MERGE") return yes >= no ? "YES_FIRST" : "NO_FIRST";
  return yes <= no ? "YES_FIRST" : "NO_FIRST";
}

function inventoryItem(tokenId, shares, costBasis, side = "LONG") {
  if (D(shares).lte(0)) return null;
  return { tokenId, side, shares: D(shares), costBasis: D(costBasis) };
}

export function simulateCompleteSetExecution(input, options = {}) {
  const detectedAt = iso(input.detectedAt ?? Date.now());
  const executedAt = iso(input.executedAt ?? Date.now());
  if (!detectedAt || !executedAt) throw new Error("Invalid execution timestamp");
  const detectedMs = Date.parse(detectedAt);
  const executionMs = Date.parse(executedAt);
  const delayMs = Math.max(0, executionMs - detectedMs);
  const direction = input.direction;
  if (!["BUY_AND_MERGE", "SPLIT_AND_SELL"].includes(direction)) throw new Error(`Unsupported direction: ${direction}`);
  const requestedShares = D(input.shares);
  const minFillRatio = D(options.minPairedFillRatio ?? "0.9");
  const maxBookAgeMs = num(options.maxBookAgeMs, 15_000);
  const liquidityHaircut = num(options.liquidityHaircut, 0.8);
  const fixedCost = D(options.fixedCostUsd ?? 0);
  const feeSchedule = input.feeSchedule ?? { rate: D(0), exponent: 2, takerOnly: true };
  const reasons = [];
  if (delayMs < num(options.executionDelayMs, 0)) reasons.push("execution-delay-not-elapsed");
  if (bookAge(input.yesBook, executionMs) > maxBookAgeMs || bookAge(input.noBook, executionMs) > maxBookAgeMs) reasons.push("stale-execution-book");

  const levelKey = direction === "BUY_AND_MERGE" ? "asks" : "bids";
  const side = direction === "BUY_AND_MERGE" ? "BUY" : "SELL";
  const order = chooseLegOrder(direction, input.yesBook, input.noBook, options.legOrder);
  const firstIsYes = order === "YES_FIRST";
  const firstBook = firstIsYes ? input.yesBook : input.noBook;
  const secondBook = firstIsYes ? input.noBook : input.yesBook;
  const firstToken = firstIsYes ? input.yesTokenId : input.noTokenId;
  const secondToken = firstIsYes ? input.noTokenId : input.yesTokenId;
  const first = quoteAvailable(firstToken, side, firstBook?.[levelKey], requestedShares, feeSchedule, { liquidityHaircut });
  const secondTarget = first?.filledShares ?? D(0);
  const second = secondTarget.gt(0)
    ? quoteAvailable(secondToken, side, secondBook?.[levelKey], secondTarget, feeSchedule, { liquidityHaircut })
    : null;
  const pairedShares = Dec.min(first?.filledShares ?? D(0), second?.filledShares ?? D(0));
  const pairedRatio = requestedShares.gt(0) ? pairedShares.div(requestedShares) : D(0);
  if (pairedShares.lte(0)) reasons.push("no-paired-fill");
  if (pairedRatio.lt(minFillRatio)) reasons.push("paired-fill-below-threshold");

  const firstPaired = pairedShares.gt(0) ? quoteExact(firstToken, side, first?.fills ?? [], pairedShares, feeSchedule) : null;
  const secondPaired = pairedShares.gt(0) ? quoteExact(secondToken, side, second?.fills ?? [], pairedShares, feeSchedule) : null;
  const firstUnpairedShares = (first?.filledShares ?? D(0)).minus(pairedShares);
  const secondUnpairedShares = (second?.filledShares ?? D(0)).minus(pairedShares);
  const firstUnpaired = firstUnpairedShares.gt(0)
    ? quoteExact(firstToken, side, first?.fills ?? [], first?.filledShares, feeSchedule)
    : null;

  let cashDelta = D(0);
  let guaranteedProfit = D(0);
  let capitalRequired = D(0);
  const openInventory = [];
  if (direction === "BUY_AND_MERGE") {
    const totalFilledCost = (first?.notional ?? D(0)).plus(first?.fee ?? 0).plus(second?.notional ?? 0).plus(second?.fee ?? 0).plus(fixedCost);
    cashDelta = pairedShares.minus(totalFilledCost);
    guaranteedProfit = pairedShares
      .minus(firstPaired?.notional ?? 0).minus(firstPaired?.fee ?? 0)
      .minus(secondPaired?.notional ?? 0).minus(secondPaired?.fee ?? 0)
      .minus(fixedCost);
    capitalRequired = totalFilledCost;
    const unmatchedCost = firstUnpaired
      ? firstUnpaired.notional.plus(firstUnpaired.fee)
          .minus(firstPaired?.notional ?? 0).minus(firstPaired?.fee ?? 0)
      : D(0);
    const unmatched = inventoryItem(firstToken, firstUnpairedShares, unmatchedCost);
    if (unmatched) openInventory.push(unmatched);
    const unmatchedSecond = inventoryItem(secondToken, secondUnpairedShares, D(0));
    if (unmatchedSecond) openInventory.push(unmatchedSecond);
  } else {
    const collateral = requestedShares;
    const revenue = (first?.notional ?? D(0)).minus(first?.fee ?? 0).plus(second?.notional ?? 0).minus(second?.fee ?? 0);
    cashDelta = revenue.minus(collateral).minus(fixedCost);
    guaranteedProfit = (firstPaired?.notional ?? D(0)).minus(firstPaired?.fee ?? 0)
      .plus(secondPaired?.notional ?? D(0)).minus(secondPaired?.fee ?? 0)
      .minus(pairedShares).minus(fixedCost);
    capitalRequired = collateral.plus(fixedCost);
    const yesSold = firstIsYes ? first?.filledShares ?? D(0) : second?.filledShares ?? D(0);
    const noSold = firstIsYes ? second?.filledShares ?? D(0) : first?.filledShares ?? D(0);
    const yesRemaining = requestedShares.minus(yesSold);
    const noRemaining = requestedShares.minus(noSold);
    const yesInventory = inventoryItem(input.yesTokenId, yesRemaining, yesRemaining);
    const noInventory = inventoryItem(input.noTokenId, noRemaining, noRemaining);
    if (yesInventory) openInventory.push(yesInventory);
    if (noInventory) openInventory.push(noInventory);
  }

  const hasExposure = openInventory.some((item) => item.shares.gt(0));
  const hasAnyFill = (first?.filledShares ?? D(0)).gt(0) || (second?.filledShares ?? D(0)).gt(0);
  const status = reasons.includes("stale-execution-book") || reasons.includes("execution-delay-not-elapsed")
    ? "REJECTED"
    : hasExposure || (hasAnyFill && pairedRatio.lt(1))
      ? "PARTIAL_EXPOSURE"
      : pairedShares.lte(0)
        ? "FAILED"
        : "FILLED";

  return {
    id: String(input.id),
    strategy: input.strategy ?? "COMPLETE_SET",
    direction,
    detectedAt,
    executedAt,
    detectionToExecutionMs: delayMs,
    requestedShares,
    pairedShares,
    pairedFillRatio: pairedRatio,
    firstLeg: { tokenId: firstToken, quote: first },
    secondLeg: { tokenId: secondToken, quote: second },
    guaranteedProfit,
    cashDelta,
    capitalRequired,
    openInventory,
    status,
    reasons,
    assumptions: {
      liquidityHaircut,
      legOrder: order,
      minPairedFillRatio: minFillRatio,
      maxBookAgeMs
    }
  };
}

export function simulateDirectionalExecution(input, options = {}) {
  const detectedAt = iso(input.detectedAt ?? Date.now());
  const executedAt = iso(input.executedAt ?? Date.now());
  if (!detectedAt || !executedAt) throw new Error("Invalid execution timestamp");
  const executionMs = Date.parse(executedAt);
  const reasons = [];
  if (executionMs - Date.parse(detectedAt) < num(options.executionDelayMs, 0)) reasons.push("execution-delay-not-elapsed");
  if (bookAge(input.book, executionMs) > num(options.maxBookAgeMs, 15_000)) reasons.push("stale-execution-book");
  const quote = quoteAvailable(
    input.tokenId,
    input.side ?? "BUY",
    (input.side ?? "BUY") === "BUY" ? input.book?.asks : input.book?.bids,
    input.shares,
    input.feeSchedule ?? { rate: D(0), exponent: 2, takerOnly: true },
    { liquidityHaircut: options.liquidityHaircut ?? 0.8 }
  );
  if (!quote) reasons.push("no-fill");
  if (quote && input.limitPrice !== undefined) {
    const limit = D(input.limitPrice);
    if ((input.side ?? "BUY") === "BUY" ? quote.worstPrice.gt(limit) : quote.worstPrice.lt(limit)) reasons.push("price-limit-breached");
  }
  const status = reasons.length ? (quote ? "REJECTED" : "FAILED") : quote.complete ? "FILLED" : "PARTIAL";
  const signedCash = quote
    ? (input.side ?? "BUY") === "BUY"
      ? quote.notional.plus(quote.fee).mul(-1)
      : quote.notional.minus(quote.fee)
    : D(0);
  return {
    id: String(input.id), strategy: input.strategy ?? "WHALE_COPY", detectedAt, executedAt,
    tokenId: input.tokenId, side: input.side ?? "BUY", quote, status, reasons,
    cashDelta: signedCash,
    capitalRequired: signedCash.lt(0) ? signedCash.abs() : D(0),
    openInventory: quote ? [{ tokenId: input.tokenId, side: (input.side ?? "BUY") === "BUY" ? "LONG" : "REDUCE", shares: quote.filledShares, costBasis: quote.notional.plus(quote.fee) }] : []
  };
}
