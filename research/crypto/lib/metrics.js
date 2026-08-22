function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function stdev(values, sample = true) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < (sample ? 2 : 1)) return 0;
  const mu = mean(clean);
  const denominator = clean.length - (sample ? 1 : 0);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - mu) ** 2, 0) / Math.max(1, denominator));
}

export function dailySeries(series) {
  const byDay = new Map();
  for (const point of series ?? []) {
    const day = Math.floor(finite(point.time) / 86400) * 86400;
    byDay.set(day, { time: day, value: finite(point.value) });
  }
  return [...byDay.values()].sort((left, right) => left.time - right.time);
}

export function returnsFromEquity(series, startingValue = 10_000) {
  const daily = dailySeries(series);
  const returns = [];
  let previous = Math.max(1e-12, finite(startingValue, 10_000));
  for (const point of daily) {
    returns.push(point.value / previous - 1);
    previous = point.value;
  }
  return { daily, returns };
}

export function drawdownSeries(series, startingValue = 10_000) {
  const daily = dailySeries(series);
  let peak = Math.max(1e-12, finite(startingValue, 10_000));
  return daily.map((point) => {
    peak = Math.max(peak, point.value);
    return { time: point.time, value: point.value / peak - 1 };
  });
}

export function rollingSharpe(series, window = 30, startingValue = 10_000) {
  const { daily, returns } = returnsFromEquity(series, startingValue);
  const out = [];
  for (let i = window; i <= returns.length; i += 1) {
    const chunk = returns.slice(i - window, i);
    const sd = stdev(chunk);
    const point = daily[Math.max(0, i - 1)];
    out.push({ time: point?.time ?? 0, value: sd > 0 ? Math.sqrt(365) * mean(chunk) / sd : 0 });
  }
  return out;
}

export function performanceMetrics(state, startingValue = 10_000) {
  const startValue = Math.max(1e-12, finite(startingValue, 10_000));
  const { daily, returns } = returnsFromEquity(state?.equitySeries, startValue);
  const endValue = daily.at(-1)?.value ?? startValue;
  const elapsedDays = daily.length > 1
    ? Math.max(1, (daily.at(-1).time - daily[0].time) / 86400)
    : 1;
  const annualizedReturn = (endValue / startValue) ** (365 / elapsedDays) - 1;
  const sd = stdev(returns);
  const sharpe = sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0;
  const downside = returns.filter((value) => value < 0);
  const downsideSd = stdev(downside);
  const sortino = downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0;
  const dd = drawdownSeries(state?.equitySeries, startValue);
  const maxDrawdown = dd.length ? Math.min(...dd.map((point) => point.value)) : 0;
  const closedTrades = state?.closedTrades ?? [];
  const wins = closedTrades.filter((trade) => finite(trade.pnl) > 0);
  const losses = closedTrades.filter((trade) => finite(trade.pnl) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + finite(trade.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + finite(trade.pnl), 0));
  const averageEquity = mean([startValue, ...daily.map((point) => point.value)]);
  const averageExposure = mean(dailySeries(state?.exposureSeries).map((point) => point.value));
  return {
    netReturn: endValue / startValue - 1,
    annualizedReturn,
    sharpe,
    sortino,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null,
    winRate: closedTrades.length ? wins.length / closedTrades.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    expectancyPerTrade: closedTrades.length ? mean(closedTrades.map((trade) => finite(trade.pnl))) : 0,
    turnover: finite(state?.turnover),
    turnoverToAverageEquity: averageEquity > 0 ? finite(state?.turnover) / averageEquity : 0,
    totalFees: finite(state?.totalFees),
    feeDrag: finite(state?.totalFees) / startValue,
    averageExposure,
    closedTrades: closedTrades.length,
    orderCount: Math.trunc(finite(state?.orders)),
    startValue,
    endValue,
    elapsedDays
  };
}
