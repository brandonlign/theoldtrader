const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

function roundDiv(numerator, denominator) {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function normalizeNumericString(value) {
  const text = String(value).trim();
  if (!/[eE]/.test(text)) return text;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid decimal: ${text}`);
  return numeric.toFixed(SCALE_DIGITS);
}

function parseUnits(value) {
  if (value instanceof Dec) return value.units;
  if (typeof value === "bigint") return value * SCALE;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Invalid decimal: ${value}`);
  }

  let text = normalizeNumericString(value);
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*(?:\.\d*)?$/.test(text) || text === "" || text === ".") {
    throw new Error(`Invalid decimal: ${value}`);
  }

  const [whole = "0", fraction = ""] = text.split(".");
  const padded = `${fraction}${"0".repeat(SCALE_DIGITS)}`.slice(0, SCALE_DIGITS);
  let units = BigInt(whole || "0") * SCALE + BigInt(padded || "0");
  if (negative) units = -units;
  return units;
}

export class Dec {
  constructor(value = 0) {
    this.units = parseUnits(value);
  }

  static fromUnits(units) {
    const value = Object.create(Dec.prototype);
    value.units = units;
    return value;
  }

  static min(...values) {
    if (values.length === 0) throw new Error("Dec.min requires at least one value");
    return values.map((value) => Dec.from(value)).reduce((a, b) => a.lte(b) ? a : b);
  }

  static max(...values) {
    if (values.length === 0) throw new Error("Dec.max requires at least one value");
    return values.map((value) => Dec.from(value)).reduce((a, b) => a.gte(b) ? a : b);
  }

  static from(value) {
    return value instanceof Dec ? value : new Dec(value);
  }

  plus(value) {
    return Dec.fromUnits(this.units + Dec.from(value).units);
  }

  minus(value) {
    return Dec.fromUnits(this.units - Dec.from(value).units);
  }

  mul(value) {
    return Dec.fromUnits(roundDiv(this.units * Dec.from(value).units, SCALE));
  }

  div(value) {
    const divisor = Dec.from(value).units;
    return Dec.fromUnits(roundDiv(this.units * SCALE, divisor));
  }

  pow(exponent) {
    if (!Number.isInteger(exponent) || exponent < 0) {
      throw new Error("Decimal exponent must be a non-negative integer");
    }
    let result = new Dec(1);
    let base = this;
    let power = exponent;
    while (power > 0) {
      if (power % 2 === 1) result = result.mul(base);
      power = Math.floor(power / 2);
      if (power > 0) base = base.mul(base);
    }
    return result;
  }

  abs() {
    return this.units < 0n ? Dec.fromUnits(-this.units) : this;
  }

  comparedTo(value) {
    const other = Dec.from(value).units;
    return this.units < other ? -1 : this.units > other ? 1 : 0;
  }

  eq(value) { return this.comparedTo(value) === 0; }
  lt(value) { return this.comparedTo(value) < 0; }
  lte(value) { return this.comparedTo(value) <= 0; }
  gt(value) { return this.comparedTo(value) > 0; }
  gte(value) { return this.comparedTo(value) >= 0; }

  toDecimalPlaces(places) {
    if (!Number.isInteger(places) || places < 0 || places > SCALE_DIGITS) {
      throw new Error(`places must be an integer from 0 to ${SCALE_DIGITS}`);
    }
    const factor = 10n ** BigInt(SCALE_DIGITS - places);
    return Dec.fromUnits(roundDiv(this.units, factor) * factor);
  }

  toFixed(places) {
    const rounded = this.toDecimalPlaces(places);
    const negative = rounded.units < 0n;
    const absolute = negative ? -rounded.units : rounded.units;
    const whole = absolute / SCALE;
    const fraction = (absolute % SCALE).toString().padStart(SCALE_DIGITS, "0").slice(0, places);
    return `${negative ? "-" : ""}${whole.toString()}${places > 0 ? `.${fraction}` : ""}`;
  }

  toString() {
    const negative = this.units < 0n;
    const absolute = negative ? -this.units : this.units;
    const whole = absolute / SCALE;
    const fraction = (absolute % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
  }

  toJSON() {
    return this.toString();
  }
}
