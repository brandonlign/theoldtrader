function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

export function stdev(values, sample = true) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < (sample ? 2 : 1)) return 0;
  const mu = mean(clean);
  const denom = sample ? clean.length - 1 : clean.length;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - mu) ** 2, 0) / Math.max(1, denom));
}

export function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) a[pivot][col] = 1e-12;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

export function fitRidge(samples, lambda = 10) {
  if (!samples.length) throw new Error('Cannot fit ridge with no samples');
  const p = samples[0].features.length;
  const xMeans = Array(p).fill(0);
  const xScales = Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    const column = samples.map((row) => row.features[j]);
    xMeans[j] = mean(column);
    xScales[j] = Math.max(stdev(column), 1e-9);
  }
  const yMean = mean(samples.map((row) => row.target));
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  for (const sample of samples) {
    const x = sample.features.map((value, j) => (value - xMeans[j]) / xScales[j]);
    const y = sample.target - yMean;
    for (let j = 0; j < p; j += 1) {
      xty[j] += x[j] * y;
      for (let k = 0; k < p; k += 1) xtx[j][k] += x[j] * x[k];
    }
  }
  for (let j = 0; j < p; j += 1) xtx[j][j] += Math.max(0, lambda);
  const coefficients = solveLinearSystem(xtx, xty);
  const residuals = samples.map((sample) => {
    const pred = yMean + sample.features.reduce(
      (sum, value, j) => sum + coefficients[j] * ((value - xMeans[j]) / xScales[j]), 0
    );
    return sample.target - pred;
  });
  return { coefficients, xMeans, xScales, yMean, residualStd: stdev(residuals) };
}

export function predictRidge(model, features) {
  return model.yMean + features.reduce(
    (sum, value, j) => sum + model.coefficients[j] * ((value - model.xMeans[j]) / model.xScales[j]), 0
  );
}

function logReturn(now, before) {
  return now > 0 && before > 0 ? Math.log(now / before) : 0;
}

function trailingReturns(candles, endIndex, bars) {
  const start = Math.max(1, endIndex - bars + 1);
  const returns = [];
  for (let i = start; i <= endIndex; i += 1) {
    returns.push(logReturn(candles[i].close, candles[i - 1].close));
  }
  return returns;
}

function buildIndex(candles) {
  return new Map(candles.map((candle, index) => [candle.time, index]));
}

export const FEATURE_NAMES = [
  'ret_1h', 'ret_4h', 'ret_24h', 'ret_7d', 'ret_30d',
  'rv_24h', 'rv_7d', 'range_24h', 'volume_ratio_24h_to_7d',
  'cross_mean_ret_24h', 'cross_dispersion_ret_24h'
];

export function buildDailySamples(dataset, manifest) {
  const products = manifest.data.products;
  const granularity = manifest.data.granularitySeconds;
  const horizonBars = manifest.candidate.labelHorizonBars;
  const indexes = Object.fromEntries(products.map((product) => [product, buildIndex(dataset.products[product] ?? [])]));
  const reference = dataset.products[products[0]] ?? [];
  const samples = [];
  const maxLookback = 30 * 24 * 3600;
  const startSec = Math.floor(Date.parse(manifest.data.start) / 1000) + maxLookback;
  const endSec = Math.floor(Date.parse(manifest.data.end) / 1000) - horizonBars * granularity;

  for (const ref of reference) {
    const time = ref.time;
    if (time < startSec || time > endSec || time % 86400 !== 0) continue;
    const crossRet24 = [];
    let crossReady = true;
    for (const product of products) {
      const candles = dataset.products[product] ?? [];
      const index = indexes[product].get(time);
      const pastIndex = indexes[product].get(time - 24 * 3600);
      if (index === undefined || pastIndex === undefined) { crossReady = false; break; }
      crossRet24.push(logReturn(candles[index].close, candles[pastIndex].close));
    }
    if (!crossReady) continue;
    const crossMean = mean(crossRet24);
    const crossDispersion = stdev(crossRet24, false);

    for (const product of products) {
      const candles = dataset.products[product] ?? [];
      const idx = indexes[product].get(time);
      const futureIdx = indexes[product].get(time + horizonBars * granularity);
      const idx1h = indexes[product].get(time - 3600);
      const idx4h = indexes[product].get(time - 4 * 3600);
      const idx24h = indexes[product].get(time - 24 * 3600);
      const idx7d = indexes[product].get(time - 7 * 86400);
      const idx30d = indexes[product].get(time - 30 * 86400);
      if ([idx, futureIdx, idx1h, idx4h, idx24h, idx7d, idx30d].some((value) => value === undefined)) continue;
      if (idx < 7 * 24 * 4) continue;
      const close = candles[idx].close;
      const ret24 = trailingReturns(candles, idx, 96);
      const ret7d = trailingReturns(candles, idx, 672);
      const window24 = candles.slice(idx - 95, idx + 1);
      const window7d = candles.slice(idx - 671, idx + 1);
      if (window24.length < 96 || window7d.length < 672) continue;
      const avgRange24 = mean(window24.map((candle) => candle.close > 0 ? (candle.high - candle.low) / candle.close : 0));
      const vol24 = mean(window24.map((candle) => candle.volume));
      const vol7d = mean(window7d.map((candle) => candle.volume));
      const features = [
        logReturn(close, candles[idx1h].close),
        logReturn(close, candles[idx4h].close),
        logReturn(close, candles[idx24h].close),
        logReturn(close, candles[idx7d].close),
        logReturn(close, candles[idx30d].close),
        stdev(ret24, false),
        stdev(ret7d, false),
        avgRange24,
        vol7d > 0 ? vol24 / vol7d : 1,
        crossMean,
        crossDispersion
      ];
      if (!features.every(Number.isFinite)) continue;
      samples.push({
        time,
        labelEnd: time + horizonBars * granularity,
        product,
        features,
        target: logReturn(candles[futureIdx].close, close),
        close
      });
    }
  }
  return samples;
}

export function walkForwardPredictions(samples, manifest) {
  const minTrainSec = manifest.validation.walkForwardTrainMinDays * 86400;
  const embargoSec = manifest.validation.embargoHours * 3600;
  const dataStart = Math.floor(Date.parse(manifest.data.start) / 1000);
  const byTime = new Map();
  const times = [...new Set(samples.map((row) => row.time))].sort((a, b) => a - b);
  for (const time of times) {
    if (time - dataStart < minTrainSec) continue;
    const trainingCutoff = time - embargoSec;
    const train = samples.filter((row) => row.labelEnd <= trainingCutoff);
    if (train.length < 300) continue;
    const model = fitRidge(train, manifest.candidate.ridgeLambda);
    const rows = samples.filter((row) => row.time === time);
    byTime.set(time, rows.map((row) => ({
      ...row,
      prediction: predictRidge(model, row.features),
      trainingRows: train.length,
      residualStd: model.residualStd
    })));
  }
  return byTime;
}

function roundTripCostPct(costModel) {
  return ((2 * costModel.feeBpsPerSide) + (2 * costModel.slippageBpsPerSide) + costModel.historicalSpreadBpsRoundTrip) / 10_000;
}

function entryFill(mid, costModel) {
  return mid * (1 + (costModel.slippageBpsPerSide + costModel.historicalSpreadBpsRoundTrip / 2) / 10_000);
}

function exitFill(mid, costModel) {
  return mid * (1 - (costModel.slippageBpsPerSide + costModel.historicalSpreadBpsRoundTrip / 2) / 10_000);
}

function currentEquity(state, prices) {
  let positionValue = 0;
  for (const [product, position] of state.positions) {
    positionValue += position.units * finite(prices.get(product), position.lastPrice);
  }
  return { equity: state.cash + positionValue, positionValue };
}

function executeBuy(state, product, mid, notional, time, costModel) {
  if (notional <= 0 || state.positions.has(product)) return;
  const fill = entryFill(mid, costModel);
  const fee = notional * costModel.feeBpsPerSide / 10_000;
  const totalCash = notional + fee;
  if (state.cash + 1e-9 < totalCash) return;
  const units = notional / fill;
  state.cash -= totalCash;
  state.totalFees += fee;
  state.turnover += notional;
  state.positions.set(product, { units, entryCash: totalCash, openedAt: time, lastPrice: mid, highestPrice: mid, averageCost: fill });
  state.orders += 1;
}

function executeSell(state, product, mid, time, costModel, reason = 'signal') {
  const position = state.positions.get(product);
  if (!position) return;
  const fill = exitFill(mid, costModel);
  const gross = position.units * fill;
  const fee = gross * costModel.feeBpsPerSide / 10_000;
  const net = gross - fee;
  const pnl = net - position.entryCash;
  state.cash += net;
  state.totalFees += fee;
  state.turnover += gross;
  state.closedTrades.push({ product, openedAt: position.openedAt, closedAt: time, pnl, entryCash: position.entryCash, reason });
  state.positions.delete(product);
  state.orders += 1;
}

function makeState(startingCash) {
  return { cash: startingCash, positions: new Map(), totalFees: 0, turnover: 0, orders: 0, closedTrades: [], equitySeries: [], exposureSeries: [], turnoverSeries: [], feeSeries: [] };
}

function snapshot(state, time, prices) {
  const { equity, positionValue } = currentEquity(state, prices);
  state.equitySeries.push({ time, value: equity });
  state.exposureSeries.push({ time, value: equity > 0 ? positionValue / equity : 0 });
  state.turnoverSeries.push({ time, value: state.turnover });
  state.feeSeries.push({ time, value: state.totalFees });
}

function priceMaps(dataset, products) {
  return Object.fromEntries(products.map((product) => [product, new Map((dataset.products[product] ?? []).map((candle) => [candle.time, candle.close]))]));
}

export function backtestDailyPolicy({ dataset, manifest, start, end, policy }) {
  const startSec = Math.floor(Date.parse(start) / 1000);
  const endSec = Math.floor(Date.parse(end) / 1000);
  const products = manifest.data.products;
  const maps = priceMaps(dataset, products);
  const reference = dataset.products[products[0]] ?? [];
  const state = makeState(manifest.portfolio.startingCash);
  const lastPrices = new Map();

  for (const candle of reference) {
    const time = candle.time;
    if (time < startSec || time >= endSec || time % 86400 !== 0) continue;
    const prices = new Map();
    let allReady = true;
    for (const product of products) {
      const price = maps[product].get(time);
      if (!Number.isFinite(price)) { allReady = false; break; }
      prices.set(product, price);
      lastPrices.set(product, price);
      const position = state.positions.get(product);
      if (position) {
        position.lastPrice = price;
        position.highestPrice = Math.max(position.highestPrice, price);
      }
    }
    if (!allReady) continue;

    const desired = policy({ time, prices, state });
    for (const product of products) {
      if (state.positions.has(product) && !desired.has(product)) {
        executeSell(state, product, prices.get(product), time, manifest.costModel, 'policy-exit');
      }
    }
    const { equity, positionValue } = currentEquity(state, prices);
    const targetNotional = equity * manifest.portfolio.maxSinglePositionPct;
    const exposureCap = equity * manifest.portfolio.maxTotalCryptoExposurePct;
    const reserve = equity * manifest.portfolio.cashReservePct;
    let exposureRoom = Math.max(0, exposureCap - positionValue);
    for (const product of products) {
      if (!desired.has(product) || state.positions.has(product)) continue;
      const maxByCash = Math.max(0, state.cash - reserve) / (1 + manifest.costModel.feeBpsPerSide / 10_000);
      const notional = Math.min(targetNotional, exposureRoom, maxByCash);
      executeBuy(state, product, prices.get(product), notional, time, manifest.costModel);
      exposureRoom = Math.max(0, exposureRoom - notional);
    }
    snapshot(state, time, prices);
  }

  const endTime = endSec - manifest.data.granularitySeconds;
  const prices = new Map();
  for (const product of products) {
    const candles = dataset.products[product] ?? [];
    let chosen;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      if (candles[i].time <= endTime) { chosen = candles[i]; break; }
    }
    if (chosen) prices.set(product, chosen.close);
  }
  for (const product of [...state.positions.keys()]) {
    const price = prices.get(product) ?? state.positions.get(product).lastPrice;
    executeSell(state, product, price, endSec, manifest.costModel, 'evaluation-end');
  }
  snapshot(state, endSec, prices);
  return state;
}

export function ridgePolicy(predictions, manifest) {
  const hurdle = roundTripCostPct(manifest.costModel);
  return ({ time }) => {
    const rows = predictions.get(time) ?? [];
    return new Set(rows.filter((row) => row.prediction > hurdle).map((row) => row.product));
  };
}

export function trend30Policy(dataset, manifest) {
  const products = manifest.data.products;
  const indexes = Object.fromEntries(products.map((product) => [product, buildIndex(dataset.products[product] ?? [])]));
  return ({ time }) => {
    const active = new Set();
    for (const product of products) {
      const candles = dataset.products[product] ?? [];
      const now = indexes[product].get(time);
      const past = indexes[product].get(time - 30 * 86400);
      if (now === undefined || past === undefined) continue;
      if (candles[now].close > candles[past].close) active.add(product);
    }
    return active;
  };
}

export function buyHoldPolicy(products) {
  let initialized = false;
  return () => {
    if (!initialized) initialized = true;
    return new Set(products);
  };
}

export function btcBuyHoldPolicy() {
  return () => new Set(['BTC-USD']);
}

export function cashBacktest(manifest, start, end) {
  const startSec = Math.floor(Date.parse(start) / 1000);
  const endSec = Math.floor(Date.parse(end) / 1000);
  return {
    cash: manifest.portfolio.startingCash,
    positions: new Map(), totalFees: 0, turnover: 0, orders: 0, closedTrades: [],
    equitySeries: [{ time: startSec, value: manifest.portfolio.startingCash }, { time: endSec, value: manifest.portfolio.startingCash }],
    exposureSeries: [{ time: startSec, value: 0 }, { time: endSec, value: 0 }],
    turnoverSeries: [{ time: startSec, value: 0 }, { time: endSec, value: 0 }],
    feeSeries: [{ time: startSec, value: 0 }, { time: endSec, value: 0 }]
  };
}

function dailySeries(series) {
  const byDay = new Map();
  for (const point of series) {
    const day = Math.floor(point.time / 86400) * 86400;
    byDay.set(day, { time: day, value: point.value });
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

function returnsFromEquity(series) {
  const daily = dailySeries(series);
  const returns = [];
  for (let i = 1; i < daily.length; i += 1) {
    const prev = daily[i - 1].value;
    returns.push(prev > 0 ? daily[i].value / prev - 1 : 0);
  }
  return { daily, returns };
}

export function rollingSharpe(series, window = 30) {
  const { daily, returns } = returnsFromEquity(series);
  const out = [];
  for (let i = window; i <= returns.length; i += 1) {
    const chunk = returns.slice(i - window, i);
    const sd = stdev(chunk);
    out.push({ time: daily[i].time, value: sd > 0 ? Math.sqrt(365) * mean(chunk) / sd : 0 });
  }
  return out;
}

export function drawdownSeries(series) {
  const daily = dailySeries(series);
  let peak = -Infinity;
  return daily.map((point) => {
    peak = Math.max(peak, point.value);
    return { time: point.time, value: peak > 0 ? point.value / peak - 1 : 0 };
  });
}

export function performanceMetrics(state) {
  const { daily, returns } = returnsFromEquity(state.equitySeries);
  const startValue = daily[0]?.value ?? 0;
  const endValue = daily.at(-1)?.value ?? startValue;
  const elapsedDays = daily.length > 1 ? Math.max(1, (daily.at(-1).time - daily[0].time) / 86400) : 1;
  const annReturn = startValue > 0 ? (endValue / startValue) ** (365 / elapsedDays) - 1 : 0;
  const sd = stdev(returns);
  const sharpe = sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0;
  const downside = returns.filter((value) => value < 0);
  const downsideSd = stdev(downside);
  const sortino = downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0;
  const dd = drawdownSeries(state.equitySeries);
  const maxDrawdown = dd.length ? Math.min(...dd.map((point) => point.value)) : 0;
  const wins = state.closedTrades.filter((trade) => trade.pnl > 0);
  const losses = state.closedTrades.filter((trade) => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const avgEquity = mean(daily.map((point) => point.value));
  const avgExposure = mean(dailySeries(state.exposureSeries).map((point) => point.value));
  return {
    netReturn: startValue > 0 ? endValue / startValue - 1 : 0,
    annualizedReturn: annReturn,
    sharpe,
    sortino,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annReturn / Math.abs(maxDrawdown) : null,
    winRate: state.closedTrades.length ? wins.length / state.closedTrades.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    expectancyPerTrade: state.closedTrades.length ? mean(state.closedTrades.map((trade) => trade.pnl)) : 0,
    turnover: state.turnover,
    turnoverToAverageEquity: avgEquity > 0 ? state.turnover / avgEquity : 0,
    totalFees: state.totalFees,
    feeDrag: startValue > 0 ? state.totalFees / startValue : 0,
    averageExposure: avgExposure,
    closedTrades: state.closedTrades.length,
    orderCount: state.orders,
    startValue,
    endValue,
    elapsedDays
  };
}

export function foldRanges(manifest) {
  const devEnd = Math.floor(Date.parse(manifest.validation.developmentEnd) / 1000) + 1;
  const minStart = Math.floor(Date.parse(manifest.data.start) / 1000) + manifest.validation.walkForwardTrainMinDays * 86400;
  const step = manifest.validation.walkForwardTestDays * 86400;
  const ranges = [];
  for (let start = minStart; start < devEnd; start += step) {
    const end = Math.min(devEnd, start + step);
    if (end - start >= 20 * 86400) ranges.push({ start, end });
  }
  return ranges;
}

export function regimeByDay(dataset, manifest, start, end) {
  const btc = dataset.products['BTC-USD'] ?? [];
  const index = buildIndex(btc);
  const startSec = Math.floor(Date.parse(start) / 1000);
  const endSec = Math.floor(Date.parse(end) / 1000);
  const out = new Map();
  const realized = new Map();
  for (const candle of btc) {
    if (candle.time % 86400 !== 0) continue;
    const i = index.get(candle.time);
    const p30 = index.get(candle.time - 30 * 86400);
    if (p30 === undefined || i === undefined || i < 96 * 30) continue;
    const ret30 = logReturn(candle.close, btc[p30].close);
    const vol30 = stdev(trailingReturns(btc, i, 96 * 30), false);
    realized.set(candle.time, vol30);
    if (candle.time < startSec || candle.time >= endSec) continue;
    const pastVols = [];
    for (let t = candle.time - 180 * 86400; t < candle.time; t += 86400) {
      if (realized.has(t)) pastVols.push(realized.get(t));
    }
    const volMedian = median(pastVols);
    const direction = ret30 >= 0 ? 'UP' : 'DOWN';
    const vol = pastVols.length >= 60 && vol30 > volMedian ? 'HIGH_VOL' : 'LOW_VOL';
    out.set(candle.time, `${direction}_${vol}`);
  }
  return out;
}

export function regimePerformance(state, regimes) {
  const { daily } = returnsFromEquity(state.equitySeries);
  const buckets = new Map();
  for (let i = 1; i < daily.length; i += 1) {
    const regime = regimes.get(daily[i].time);
    if (!regime) continue;
    const r = daily[i - 1].value > 0 ? daily[i].value / daily[i - 1].value - 1 : 0;
    if (!buckets.has(regime)) buckets.set(regime, []);
    buckets.get(regime).push(r);
  }
  return Object.fromEntries([...buckets.entries()].map(([name, returns]) => {
    const sd = stdev(returns);
    return [name, {
      days: returns.length,
      netReturn: returns.reduce((value, r) => value * (1 + r), 1) - 1,
      sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
      positiveDayRate: returns.length ? returns.filter((r) => r > 0).length / returns.length : 0
    }];
  }));
}

export function coefficientStability(samples, manifest) {
  const embargoSec = manifest.validation.embargoHours * 3600;
  const snapshots = [];
  for (const range of foldRanges(manifest)) {
    const train = samples.filter((row) => row.labelEnd <= range.start - embargoSec);
    if (train.length < 300) continue;
    const model = fitRidge(train, manifest.candidate.ridgeLambda);
    snapshots.push({ time: range.start, trainingRows: train.length, coefficients: model.coefficients });
  }
  const features = FEATURE_NAMES.map((name, j) => {
    const values = snapshots.map((s) => s.coefficients[j]).filter(Number.isFinite);
    const nonzero = values.filter((v) => Math.abs(v) > 1e-12);
    const positive = nonzero.filter((v) => v > 0).length;
    const negative = nonzero.filter((v) => v < 0).length;
    return {
      feature: name,
      snapshots: values.length,
      medianCoefficient: median(values),
      coefficientStd: stdev(values),
      signConsistency: nonzero.length ? Math.max(positive, negative) / nonzero.length : 1
    };
  });
  return { snapshots, features };
}
