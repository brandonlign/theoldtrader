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
  const momentumPeriod = Math.max(3, Math.trunc(finite(config.momentumPeriod, 12)));
  const minimumCandles = Math.max(slowPeriod + 5, momentumPeriod + 5, 45);
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

  const minTrend = finite(config.minTrend, 0.0015);
  const minMomentum = finite(config.minMomentum, 0.0025);
  const minRsi = finite(config.minRsi, 52);
  const maxRsi = finite(config.maxRsi, 72);
  const maxEntryVolatility = finite(config.maxEntryVolatility, 0.035);
  const stopLossPct = finite(config.stopLossPct, 0.025);
  const takeProfitPct = finite(config.takeProfitPct, 0.05);
  const trailingStopPct = finite(config.trailingStopPct, 0.02);

  const entryPrice = finite(position?.averageCost ?? position?.avgCost);
  const highestPrice = Math.max(finite(position?.highestPrice, latest.close), latest.close);
  const returnPct = entryPrice > 0 ? latest.close / entryPrice - 1 : 0;
  const drawdownPct = highestPrice > 0 ? latest.close / highestPrice - 1 : 0;

  const metrics = {
    emaFast: fast,
    emaSlow: slow,
    rsi: oscillator,
    atrPct: volatility,
    momentum,
    trend,
    volumeRatio,
    breakout,
    volatilityRank,
    returnPct,
    drawdownPct
  };

  if (position && finite(position.units) > 0) {
    const exitReasons = [];
    if (returnPct <= -stopLossPct) exitReasons.push("hard-stop-loss");
    if (returnPct >= takeProfitPct) exitReasons.push("take-profit");
    if (drawdownPct <= -trailingStopPct && returnPct > 0) exitReasons.push("trailing-stop");
    if (fast < slow && oscillator < finite(config.exitRsi, 47)) exitReasons.push("trend-reversal");
    if (exitReasons.length) {
      return {
        productId,
        action: "SELL",
        score: Math.min(100, 55 + exitReasons.length * 15),
        price: latest.close,
        candleTime: latest.time,
        reasons: exitReasons,
        metrics
      };
    }
    return {
      productId,
      action: "HOLD",
      score: Math.max(0, Math.min(100, 50 + trend * 8_000 + momentum * 3_000)),
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
    price: latest.close > slow,
    volume: volumeRatio >= finite(config.minVolumeRatio, 0.85),
    volatility: volatility <= maxEntryVolatility,
    breakout
  };
  const passed = Object.values(entryChecks).filter(Boolean).length;
  const score = Math.max(0, Math.min(100,
    18 * passed
    + Math.max(-10, Math.min(20, trend * 6_000))
    + Math.max(-10, Math.min(15, momentum * 2_500))
    - Math.max(0, (volatilityRank - 0.85) * 30)
  ));
  const requiredChecks = Math.max(4, Math.trunc(finite(config.requiredChecks, 6)));
  if (passed >= requiredChecks && entryChecks.trend && entryChecks.momentum && entryChecks.rsi) {
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
