import { Dec } from "./decimal.js";

/**
 * Current documented Polymarket fee curve:
 * fee = shares * rate * p * (1 - p)
 *
 * Exponent 2 is the documented curve. Other exponents are modeled as
 * [p(1-p)]^(exponent - 1), isolated here for easy replacement if protocol
 * documentation changes. This module is paper-only.
 */
export function calculateTakerFee(shares, price, schedule) {
  shares = Dec.from(shares);
  price = Dec.from(price);
  if (!schedule.takerOnly || schedule.rate.lte(0) || shares.lte(0)) return new Dec(0);
  if (price.lte(0) || price.gte(1)) throw new Error(`Invalid outcome price: ${price}`);

  const power = Math.max(1, schedule.exponent - 1);
  const curve = price.mul(new Dec(1).minus(price)).pow(power);
  return shares.mul(schedule.rate).mul(curve).toDecimalPlaces(5);
}
