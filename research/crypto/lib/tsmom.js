const DAY_SECONDS = 86_400;

function isoDay(time) {
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
}

export function sampleStd(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

export function annualizedTrailingVolatility(candlesByTime, decisionTime, lookbackDays, annualizationDays = 365) {
  const endTime = decisionTime - DAY_SECONDS;
  const closes = [];
  for (let offset = lookbackDays; offset >= 0; offset -= 1) {
    const candle = candlesByTime.get(endTime - offset * DAY_SECONDS);
    if (!candle || !Number.isFinite(candle.close) || candle.close <= 0) return null;
    closes.push(candle.close);
  }
  const logReturns = [];
  for (let i = 1; i < closes.length; i += 1) logReturns.push(Math.log(closes[i] / closes[i - 1]));
  const dailyStd = sampleStd(logReturns);
  return dailyStd == null ? null : dailyStd * Math.sqrt(annualizationDays);
}

export function exactMomentumReturn(candlesByTime, decisionTime, lookbackDays) {
  const endTime = decisionTime - DAY_SECONDS;
  const startTime = endTime - lookbackDays * DAY_SECONDS;
  const end = candlesByTime.get(endTime);
  const start = candlesByTime.get(startTime);
  if (!end || !start || !(end.close > 0) || !(start.close > 0)) return null;
  return end.close / start.close - 1;
}

export function targetWeightForProduct(candlesByTime, decisionTime, manifest, { volatilityScaling = true } = {}) {
  const lookbacks = manifest.signal.momentumLookbackDays;
  const momentumReturns = lookbacks.map((days) => exactMomentumReturn(candlesByTime, decisionTime, days));
  if (momentumReturns.some((value) => value == null)) {
    return { weight: 0, reason: "missing_exact_momentum_lookback", momentumReturns, volatility: null, positiveHorizons: 0 };
  }

  const positiveHorizons = momentumReturns.filter((value) => value > 0).length;
  if (positiveHorizons < 2) {
    return { weight: 0, reason: "momentum_not_positive_on_majority", momentumReturns, volatility: null, positiveHorizons };
  }

  const maxAssetWeight = finitePositive(manifest.risk.maxAssetWeight, "maxAssetWeight");
  const momentumWeight = maxAssetWeight * (positiveHorizons / lookbacks.length);
  if (!volatilityScaling) {
    return { weight: momentumWeight, reason: "long_unscaled", momentumReturns, volatility: null, positiveHorizons };
  }

  const volatility = annualizedTrailingVolatility(
    candlesByTime,
    decisionTime,
    manifest.risk.realizedVolLookbackDays,
    manifest.risk.annualizationDays
  );
  if (volatility == null || !(volatility > 0)) {
    return { weight: 0, reason: "missing_exact_volatility_lookback", momentumReturns, volatility, positiveHorizons };
  }
  const scale = Math.min(1, manifest.risk.targetAnnualizedVol / volatility);
  return {
    weight: momentumWeight * scale,
    reason: scale < 1 ? "long_vol_scaled_down" : "long_full_momentum_weight",
    momentumReturns,
    volatility,
    positiveHorizons
  };
}

function candleMaps(dataset, products) {
  return Object.fromEntries(products.map((product) => [
    product,
    new Map((dataset.products[product] ?? []).map((candle) => [Number(candle.time), candle]))
  ]));
}

function utcMonthStart(time) {
  const date = new Date(time * 1000);
  return date.getUTCDate() === 1;
}

function evaluationTimes(dataset, anchorProduct, startSec, endSec) {
  return (dataset.products[anchorProduct] ?? [])
    .map((candle) => Number(candle.time))
    .filter((time) => time >= startSec && time < endSec)
    .sort((a, b) => a - b);
}

function maxDrawdown(equityPath) {
  let peak = -Infinity;
  let worst = 0;
  for (const row of equityPath) {
    peak = Math.max(peak, row.equity);
    if (peak > 0) worst = Math.min(worst, row.equity / peak - 1);
  }
  return worst;
}

function dailyReturns(equityPath) {
  const values = [];
  for (let i = 1; i < equityPath.length; i += 1) {
    const previous = equityPath[i - 1].equity;
    const current = equityPath[i].equity;
    if (previous > 0) values.push(current / previous - 1);
  }
  return values;
}

export function summarizeBacktest(state, startingCash, annualizationDays = 365) {
  const returns = dailyReturns(state.equityPath);
  const std = sampleStd(returns);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  return {
    startingCash,
    finalEquity: state.finalEquity,
    netReturn: state.finalEquity / startingCash - 1,
    annualizedSharpe: std && std > 0 ? (mean / std) * Math.sqrt(annualizationDays) : 0,
    maxDrawdown: maxDrawdown(state.equityPath),
    turnoverUsd: state.turnoverUsd,
    turnoverOnStartingCash: state.turnoverUsd / startingCash,
    transactionCostsUsd: state.transactionCostsUsd,
    rebalanceCount: state.rebalances.length,
    tradeCount: state.trades.length,
    averageGrossExposure: state.equityPath.length
      ? state.equityPath.reduce((sum, row) => sum + row.grossExposure, 0) / state.equityPath.length
      : 0
  };
}

function requireDailyMark(maps, product, time, field) {
  const candle = maps[product].get(time);
  if (!candle || !(Number(candle[field]) > 0)) {
    throw new Error(`Missing exact ${field} for ${product} on ${isoDay(time)} while position may be live`);
  }
  return Number(candle[field]);
}

function costRate(manifest) {
  return Number(manifest.costModel.totalBpsPerDollarTurnover) / 10_000;
}

export function backtestTsmom(dataset, manifest, { start, end, volatilityScaling = true } = {}) {
  const products = manifest.data.products;
  const startSec = Date.parse(start) / 1000;
  const endSec = Date.parse(end) / 1000;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) throw new Error("Invalid evaluation range");
  const startingCash = Number(manifest.portfolio.startingCash);
  const maps = candleMaps(dataset, products);
  const times = evaluationTimes(dataset, products[0], startSec, endSec);
  if (times.length < 2) throw new Error("Insufficient daily candles in evaluation range");

  let cash = startingCash;
  const units = Object.fromEntries(products.map((product) => [product, 0]));
  const trades = [];
  const rebalances = [];
  const equityPath = [];
  let turnoverUsd = 0;
  let transactionCostsUsd = 0;
  const perTradeCostRate = costRate(manifest);

  for (const time of times) {
    const isDecision = utcMonthStart(time);
    if (isDecision) {
      const openPrices = Object.fromEntries(products.map((product) => [product, requireDailyMark(maps, product, time, "open")]));
      const equityAtOpen = cash + products.reduce((sum, product) => sum + units[product] * openPrices[product], 0);
      const decisions = Object.fromEntries(products.map((product) => [
        product,
        targetWeightForProduct(maps[product], time, manifest, { volatilityScaling })
      ]));
      const totalTargetWeight = Object.values(decisions).reduce((sum, row) => sum + row.weight, 0);
      if (totalTargetWeight > manifest.risk.maxTotalExposure + 1e-12) {
        throw new Error(`Target exposure ${totalTargetWeight} exceeds frozen cap ${manifest.risk.maxTotalExposure}`);
      }

      const targetUnits = Object.fromEntries(products.map((product) => [
        product,
        (equityAtOpen * decisions[product].weight) / openPrices[product]
      ]));
      // Sell first, then buy. The frozen exposure cap leaves ample cash, but this
      // ordering also prevents an artificial transient cash deficit during rebalance.
      const orderedProducts = [...products].sort((a, b) => (targetUnits[a] - units[a]) - (targetUnits[b] - units[b]));
      let rebalanceTurnover = 0;
      let rebalanceCost = 0;
      for (const product of orderedProducts) {
        const deltaUnits = targetUnits[product] - units[product];
        const notional = Math.abs(deltaUnits) * openPrices[product];
        if (notional <= 1e-9) continue;
        const cost = notional * perTradeCostRate;
        cash -= deltaUnits * openPrices[product] + cost;
        units[product] = targetUnits[product];
        turnoverUsd += notional;
        transactionCostsUsd += cost;
        rebalanceTurnover += notional;
        rebalanceCost += cost;
        trades.push({
          time: new Date(time * 1000).toISOString(),
          product,
          deltaUnits,
          price: openPrices[product],
          notional,
          cost,
          targetWeight: decisions[product].weight,
          reason: decisions[product].reason
        });
      }
      if (cash < -1e-6) throw new Error(`Frozen strategy created a negative cash balance: ${cash}`);
      rebalances.push({
        time: new Date(time * 1000).toISOString(),
        equityAtOpen,
        totalTargetWeight,
        turnoverUsd: rebalanceTurnover,
        transactionCostsUsd: rebalanceCost,
        decisions
      });
    }

    const closePrices = Object.fromEntries(products.map((product) => [product, requireDailyMark(maps, product, time, "close")]));
    const grossPositionValue = products.reduce((sum, product) => sum + units[product] * closePrices[product], 0);
    const equity = cash + grossPositionValue;
    equityPath.push({
      time: new Date(time * 1000).toISOString(),
      equity,
      cash,
      grossExposure: equity > 0 ? grossPositionValue / equity : 0
    });
  }

  const lastTime = times.at(-1);
  for (const product of products) {
    if (Math.abs(units[product]) <= 1e-12) continue;
    const close = requireDailyMark(maps, product, lastTime, "close");
    const notional = Math.abs(units[product]) * close;
    const cost = notional * perTradeCostRate;
    cash += units[product] * close - cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({
      time: new Date(lastTime * 1000).toISOString(),
      product,
      deltaUnits: -units[product],
      price: close,
      notional,
      cost,
      targetWeight: 0,
      reason: "evaluation_end_liquidation"
    });
    units[product] = 0;
  }
  equityPath.push({
    time: new Date(lastTime * 1000 + 1).toISOString(),
    equity: cash,
    cash,
    grossExposure: 0
  });

  return { finalEquity: cash, cash, units, trades, rebalances, equityPath, turnoverUsd, transactionCostsUsd };
}

export function backtestStaticWeights(dataset, manifest, { start, end, targetWeights }) {
  const products = manifest.data.products;
  const startSec = Date.parse(start) / 1000;
  const endSec = Date.parse(end) / 1000;
  const startingCash = Number(manifest.portfolio.startingCash);
  const maps = candleMaps(dataset, products);
  const times = evaluationTimes(dataset, products[0], startSec, endSec);
  if (times.length < 2) throw new Error("Insufficient daily candles for static comparator");
  const firstTime = times[0];
  const lastTime = times.at(-1);
  const perTradeCostRate = costRate(manifest);
  let cash = startingCash;
  let turnoverUsd = 0;
  let transactionCostsUsd = 0;
  const units = Object.fromEntries(products.map((product) => [product, 0]));
  const trades = [];

  const totalWeight = Object.values(targetWeights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (totalWeight > manifest.risk.maxTotalExposure + 1e-12) throw new Error("Static comparator exceeds exposure cap");
  for (const product of products) {
    const weight = Number(targetWeights[product] || 0);
    if (weight <= 0) continue;
    const open = requireDailyMark(maps, product, firstTime, "open");
    const notional = startingCash * weight;
    const cost = notional * perTradeCostRate;
    units[product] = notional / open;
    cash -= notional + cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({ time: new Date(firstTime * 1000).toISOString(), product, notional, price: open, cost, reason: "static_entry" });
  }

  const equityPath = [];
  for (const time of times) {
    const positionValue = products.reduce((sum, product) => {
      if (!units[product]) return sum;
      return sum + units[product] * requireDailyMark(maps, product, time, "close");
    }, 0);
    const equity = cash + positionValue;
    equityPath.push({ time: new Date(time * 1000).toISOString(), equity, cash, grossExposure: equity > 0 ? positionValue / equity : 0 });
  }

  for (const product of products) {
    if (!units[product]) continue;
    const close = requireDailyMark(maps, product, lastTime, "close");
    const notional = units[product] * close;
    const cost = notional * perTradeCostRate;
    cash += notional - cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({ time: new Date(lastTime * 1000).toISOString(), product, notional, price: close, cost, reason: "static_exit" });
    units[product] = 0;
  }
  equityPath.push({ time: new Date(lastTime * 1000 + 1).toISOString(), equity: cash, cash, grossExposure: 0 });
  return { finalEquity: cash, cash, units, trades, rebalances: [], equityPath, turnoverUsd, transactionCostsUsd };
}

export function cashComparator(manifest, start, end) {
  const startingCash = Number(manifest.portfolio.startingCash);
  return {
    finalEquity: startingCash,
    cash: startingCash,
    units: {},
    trades: [],
    rebalances: [],
    turnoverUsd: 0,
    transactionCostsUsd: 0,
    equityPath: [
      { time: start, equity: startingCash, cash: startingCash, grossExposure: 0 },
      { time: end, equity: startingCash, cash: startingCash, grossExposure: 0 }
    ]
  };
}

export { DAY_SECONDS };
