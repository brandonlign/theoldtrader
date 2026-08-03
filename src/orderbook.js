import { Dec } from "./decimal.js";
import { calculateTakerFee } from "./fees.js";

export function cumulativeBreakpoints(levels, cap) {
  const points = [];
  let cumulative = new Dec(0);
  for (const level of levels) {
    cumulative = Dec.min(cap, cumulative.plus(level.size));
    if (cumulative.gt(0)) points.push(cumulative);
    if (cumulative.gte(cap)) break;
  }
  return points;
}

export function quoteLevels(tokenId, side, levels, shares, feeSchedule) {
  shares = Dec.from(shares);
  if (shares.lte(0)) return null;

  let remaining = shares;
  let notional = new Dec(0);
  let fee = new Dec(0);
  const fills = [];

  for (const level of levels) {
    if (remaining.lte(0)) break;
    const fillSize = Dec.min(remaining, level.size);
    if (fillSize.lte(0)) continue;
    const fillNotional = fillSize.mul(level.price);
    const fillFee = calculateTakerFee(fillSize, level.price, feeSchedule);
    fills.push({ price: level.price, size: fillSize, notional: fillNotional, fee: fillFee });
    notional = notional.plus(fillNotional);
    fee = fee.plus(fillFee);
    remaining = remaining.minus(fillSize);
  }

  if (remaining.gt(0) || fills.length === 0) return null;
  const finalFill = fills.at(-1);
  return {
    tokenId,
    side,
    shares,
    notional,
    fee,
    averagePrice: notional.div(shares),
    worstPrice: finalFill.price,
    levels: fills
  };
}
