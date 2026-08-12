function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ema(values, period) {
  if (!Array.isArray(values) || !values.length) return 0;
  const size = Math.max(1, Math.trunc(period));
  const alpha = 2 / (size + 1);
  let value = finite(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    value = alpha * finite(values[index], value) + (1 - alpha) * value;
  }
  return value;
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < 2) return 50;
  const size = Math.max(2, Math.min(Math.trunc(period), values.length - 1));
  const start = values.length - size - 1;
  let gains = 0;
  let losses = 0;
  for (let index = Math.max(1, start + 1); index < values.length; index += 1) {
    const change = finite(values[index]) - finite(values[index - 1]);
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const averageGain = gains / size;
  const averageLoss = losses / size;
  if (averageLoss <= 1e-12) return averageGain > 0 ? 100 : 50;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

export function atrPercent(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
  const size = Math.max(2, Math.min(Math.trunc(period), candles.length - 1));
  const start = candles.length - size;
  let total = 0;
  for (let index = start; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = finite(candles[index - 1]?.close, candle.close);
    const high = finite(candle.high);
    const low = finite(candle.low);
    total += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }
  const close = finite(candles.at(-1)?.close);
  return close > 0 ? (total / size) / close : 0;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + finite(value), 0) / values.length;
}

function percentileRank(values, current) {
  if (!values.length) return 0.5;
  return values.filter((value) => finite(value) <= current).length / values.length;
}

function ageMinutes(position, candleTime) {
  if (!position?.openedAt) return Infinity;
  const opened = Date.parse(position.openedAt);
  const current = finite(candleTime) * 1000;
  if (!Number.isFinite(opened) || current <= 0) return Infinity;
  return Math.max(0, (current - opened) / 60_000);
}

export function deriveCryptoSignal({ productId, candles, position = null, config = {} }) {
  const ordered = [...(candles ?? [])]
    .map((item) => ({
      time: finite(item.time),
      low: finite(item.low),
      high: finite(item.high),
      open: finite(item.open),
      close: finite(item.close),
      volume: finite(item.volume)
    }))
    .filter((item) => item.time > 0 && item.close > 0)
    .sort((left, right) => left.time - right.time);

  const fastPeriod = Math.max(3, Math.trunc(finite(config.fastPeriod, 12)));
  const slowPeriod = Math.max(fastPeriod + 2, Math.trunc(finite(config.slowPeriod, 36)));
  const regimePeriod = Math.max(slowPeriod + 4, Math.trunc(finite(config.regimePeriod, 72)));
  const regimeLookback = Math.max(3, Math.trunc(finite(config.regimeLookback, 8)));
  const momentumPeriod = Math.max(3, Math.trunc(finite(config.momentumPeriod, 12)));
  const minimumCandles = Math.max(slowPeriod + 5, momentumPeriod + 5, regimePeriod + regimeLookback + 2, 60);
  if (ordered.length < minimumCandles) {
    return {
      productId,
      action: "HOLD",
      score: 0,
      price: finite(ordered.at(-1)?.close),
      candleTime: finite(ordered.at(-1)?.time),
      reasons: ["insufficient-candle-history"]
    };
  }

  const closes = ordered.map((item) => item.close);
  const volumes = ordered.map((item) => item.volume);
  const latest = ordered.at(-1);
  const fast = ema(closes.slice(-(fastPeriod * 4)), fastPeriod);
  const slow = ema(closes.slice(-(slowPeriod * 4)), slowPeriod);
  const regime = ema(closes.slice(-(regimePeriod * 4)), regimePeriod);
  const regimePastValues = closes.slice(0, -regimeLookback);
  const regimePast = ema(regimePastValues.slice(-(regimePeriod * 4)), regimePeriod);
  const regimeSlope = regimePast > 0 ? regime / regimePast - 1 : 0;
  const oscillator = rsi(closes, finite(config.rsiPeriod, 14));
  const volatility = atrPercent(ordered, finite(config.atrPeriod, 14));
  const momentumBase = closes.at(-(momentumPeriod + 1));
  const momentum = momentumBase > 0 ? latest.close / momentumBase - 1 : 0;
  const trend = slow > 0 ? fast / slow - 1 : 0;
  const recentVolumes = volumes.slice(-20);
  const volumeRatio = average(recentVolumes.slice(-5)) / Math.max(average(recentVolumes), 1e-9);
  const recentHigh = Math.max(...ordered.slice(-20, -1).map((item) => item.high));
  const breakout = latest.close >= recentHigh * finite(config.breakoutTolerance, 0.998);
  const volatilityRank = percentileRank(
    ordered.slice(-80).map((_, index, source) => {
      const local = source.slice(Math.max(0, index - 13), index + 1);
      return atrPercent(local, Math.min(14, Math.max(2, local.length - 1)));
    }),
    volatility
  );

  const minTrend = finite(config.minTrend, 0.0018);
  const minMomentum = finite(config.minMomentum, 0.004);
  const minRsi = finite(config.minRsi, 53);
  const maxRsi = finite(config.maxRsi, 68);
  const minRegimeSlope = finite(config.minRegimeSlope, 0.0008);
  const maxEntryVolatility = finite(config.maxEntryVolatility, 0.03);
  const roundTripCostPct = Math.max(0, finite(config.roundTripCostPct));
  const exitCostPct = Math.max(0, finite(config.exitCostPct));
  const minEdgeToCost = Math.max(1, finite(config.minEdgeToCost, 2));
  const minProjectedEdge = Math.max(0, finite(config.minProjectedEdge, 0.01));
  const stopLossPct = Math.max(finite(config.stopLossPct, 0.035), roundTripCostPct * 2.25);
  const takeProfitPct = Math.max(finite(config.takeProfitPct, 0.075), roundTripCostPct * 4);
  const trailingStopPct = Math.max(finite(config.trailingStopPct, 0.028), roundTripCostPct * 1.5);
  const minHoldMinutes = Math.max(0, finite(config.minHoldMinutes, 180));

  const entryPrice = finite(position?.averageCost ?? position?.avgCost);
  const highestPrice = Math.max(finite(position?.highestPrice, latest.close), latest.close);
  const grossReturnPct = entryPrice > 0 ? latest.close / entryPrice - 1 : 0;
  const netReturnPct = entryPrice > 0 ? (latest.close * (1 - exitCostPct)) / entryPrice - 1 : 0;
  const drawdownPct = highestPrice > 0 ? latest.close / highestPrice - 1 : 0;
  const directionalEdge = Math.max(0, momentum * 0.8 + trend * 1.5 + regimeSlope * 0.75);
  const requiredEdge = Math.max(minProjectedEdge, roundTripCostPct * minEdgeToCost);

  const metrics = {
    emaFast: fast,
    emaSlow: slow,
    emaRegime: regime,
    regimeSlope,
    rsi: oscillator,
    atrPct: volatility,
    momentum,
    trend,
    volumeRatio,
    breakout,
    volatilityRank,
    grossReturnPct,
    netReturnPct,
    drawdownPct,
    directionalEdge,
    requiredEdge,
    roundTripCostPct,
    exitCostPct,
    effectiveStopLossPct: stopLossPct,
    effectiveTakeProfitPct: takeProfitPct,
    positionAgeMinutes: ageMinutes(position, latest.time)
  };

  if (position && finite(position.units) > 0) {
    const exitReasons = [];
    if (netReturnPct <= -stopLossPct) exitReasons.push("hard-stop-loss");
    if (netReturnPct >= takeProfitPct) exitReasons.push("take-profit");
    if (drawdownPct <= -trailingStopPct && netReturnPct > roundTripCostPct * 1.5) exitReasons.push("trailing-stop");
    if (metrics.positionAgeMinutes >= minHoldMinutes && fast < slow && oscillator < finite(config.exitRsi, 46)) {
      exitReasons.push("confirmed-trend-reversal");
    }
    if (exitReasons.length) {
      return {
        productId,
        action: "SELL",
        score: Math.min(100, 60 + exitReasons.length * 15),
        price: latest.close,
        candleTime: latest.time,
        reasons: exitReasons,
        metrics
      };
    }
    return {
      productId,
      action: "HOLD",
      score: Math.max(0, Math.min(100, 50 + trend * 6_000 + momentum * 2_000 + regimeSlope * 3_000)),
      price: latest.close,
      candleTime: latest.time,
      reasons: ["position-open-no-exit"],
      metrics
    };
  }

  const entryChecks = {
    trend: fast > slow && trend >= minTrend,
    momentum: momentum >= minMomentum,
    rsi: oscillator >= minRsi && oscillator <= maxRsi,
    regime: latest.close > regime && regimeSlope >= minRegimeSlope,
    edge: directionalEdge >= requiredEdge,
    price: latest.close > slow,
    volume: volumeRatio >= finite(config.minVolumeRatio, 0.9),
    volatility: volatility <= maxEntryVolatility,
    breakout
  };
  const passed = Object.values(entryChecks).filter(Boolean).length;
  const hardGateNames = ["trend", "momentum", "rsi", "regime", "edge"];
  const hardGatesPass = hardGateNames.every((name) => entryChecks[name]);
  const rawScore = Math.max(0, Math.min(100,
    10 * passed
    + Math.max(-10, Math.min(18, trend * 5_000))
    + Math.max(-10, Math.min(14, momentum * 1_800))
    + Math.max(-8, Math.min(12, regimeSlope * 4_000))
    + Math.max(0, Math.min(12, directionalEdge / Math.max(requiredEdge, 1e-6) * 8 - 4))
    - Math.max(0, (volatilityRank - 0.85) * 25)
  ));
  const score = hardGatesPass ? rawScore : Math.min(rawScore, 64);
  const requiredChecks = Math.max(5, Math.trunc(finite(config.requiredChecks, 7)));

  if (passed >= requiredChecks && hardGatesPass) {
    return {
      productId,
      action: "BUY",
      score,
      price: latest.close,
      candleTime: latest.time,
      reasons: Object.entries(entryChecks).filter(([, ok]) => ok).map(([name]) => `${name}-confirmed`),
      metrics
    };
  }

  return {
    productId,
    action: "HOLD",
    score,
    price: latest.close,
    candleTime: latest.time,
    reasons: Object.entries(entryChecks).filter(([, ok]) => !ok).map(([name]) => `${name}-not-confirmed`),
    metrics
  };
}
