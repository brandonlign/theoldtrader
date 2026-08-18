function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
}

export function stdev(values, sample = true) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < (sample ? 2 : 1)) return NaN;
  const mu = mean(clean);
  const denominator = clean.length - (sample ? 1 : 0);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - mu) ** 2, 0) / denominator);
}

function softThreshold(value, threshold) {
  if (value > threshold) return value - threshold;
  if (value < -threshold) return value + threshold;
  return 0;
}

function weekStartSeconds(isoOrSeconds) {
  const date = typeof isoOrSeconds === 'string'
    ? new Date(isoOrSeconds)
    : new Date(finite(isoOrSeconds) * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid week timestamp');
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday) / 1000);
}

export function weeklyDecisionTimes(startIso, endExclusiveIso) {
  const start = Math.floor(Date.parse(startIso) / 1000);
  const end = Math.floor(Date.parse(endExclusiveIso) / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid weekly decision range');
  let time = weekStartSeconds(start);
  if (time < start) time += 7 * 86400;
  const out = [];
  while (time < end) {
    out.push(time);
    time += 7 * 86400;
  }
  return out;
}

function indexCandles(candles) {
  return [...(candles ?? [])]
    .map((row) => ({
      ...row,
      time: finite(row.time),
      open: finite(row.open, NaN),
      high: finite(row.high, NaN),
      low: finite(row.low, NaN),
      close: finite(row.close, NaN),
      quoteVolume: finite(row.quoteVolume, NaN)
    }))
    .filter((row) => Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);
}

function strictHistory(rows, decisionTime) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].time < decisionTime) lo = mid + 1;
    else hi = mid;
  }
  return rows.slice(0, lo);
}

function requireDailyContinuity(rows, minimumRows = 201) {
  if (rows.length < minimumRows) return false;
  const tail = rows.slice(-minimumRows);
  for (let i = 1; i < tail.length; i += 1) {
    if (tail[i].time - tail[i - 1].time !== 86400) return false;
  }
  return tail.every((row) => row.close > 0 && row.high > 0 && row.low > 0 && row.quoteVolume >= 0);
}

function sma(values, length) {
  if (values.length < length) return NaN;
  return mean(values.slice(-length));
}

function emaSeries(values, length) {
  if (values.length < length) return [];
  const alpha = 2 / (length + 1);
  const out = Array(values.length).fill(NaN);
  let current = mean(values.slice(0, length));
  out[length - 1] = current;
  for (let i = length; i < values.length; i += 1) {
    current = alpha * values[i] + (1 - alpha) * current;
    out[i] = current;
  }
  return out;
}

function wilderRsiSeries(closes, length = 14) {
  const out = Array(closes.length).fill(NaN);
  if (closes.length < length + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= length; i += 1) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let avgGain = gains / length;
  let avgLoss = losses / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = length + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = ((length - 1) * avgGain + Math.max(0, change)) / length;
    avgLoss = ((length - 1) * avgLoss + Math.max(0, -change)) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function stochasticKAt(rows, endIndex, length = 14) {
  if (endIndex < length - 1) return NaN;
  const window = rows.slice(endIndex - length + 1, endIndex + 1);
  const high = Math.max(...window.map((row) => row.high));
  const low = Math.min(...window.map((row) => row.low));
  if (!(high > low)) return 0.5;
  return (rows[endIndex].close - low) / (high - low);
}

export const CTREND_SIGNAL_NAMES = [
  'rsi14', 'stoch_k14', 'stoch_d3', 'stoch_rsi14', 'cci20',
  'price_sma3', 'price_sma5', 'price_sma10', 'price_sma20', 'price_sma50', 'price_sma100', 'price_sma200',
  'price_macd_12_26', 'price_macd_signal9',
  'volume_sma3', 'volume_sma5', 'volume_sma10', 'volume_sma20', 'volume_sma50', 'volume_sma100', 'volume_sma200',
  'volume_macd_12_26', 'volume_macd_signal9', 'chaikin_money_flow20',
  'bollinger_lower20', 'bollinger_mid20', 'bollinger_upper20', 'bollinger_width20'
];

export function rawTechnicalSignals(candles, decisionTime) {
  const history = strictHistory(indexCandles(candles), decisionTime);
  if (!requireDailyContinuity(history, 201)) return null;
  const rows = history.slice(-201);
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.quoteVolume);
  const currentClose = closes.at(-1);
  const currentVolume = volumes.at(-1);
  if (!(currentClose > 0) || !(currentVolume > 0)) return null;

  const rsi = wilderRsiSeries(closes, 14);
  const rsiNow = rsi.at(-1);
  const recentRsi = rsi.slice(-14).filter(Number.isFinite);
  const rsiLow = Math.min(...recentRsi);
  const rsiHigh = Math.max(...recentRsi);
  const stochRsi = recentRsi.length === 14 && rsiHigh > rsiLow ? (rsiNow - rsiLow) / (rsiHigh - rsiLow) : 0.5;

  const stochK = stochasticKAt(rows, rows.length - 1, 14);
  const stochKs = [0, 1, 2].map((lag) => stochasticKAt(rows, rows.length - 1 - lag, 14));
  const stochD = mean(stochKs);

  const typical = rows.map((row) => (row.high + row.low + row.close) / 3);
  const tp20 = typical.slice(-20);
  const tpMean = mean(tp20);
  const meanDeviation = mean(tp20.map((value) => Math.abs(value - tpMean)));
  const cci20 = meanDeviation > 0 ? (typical.at(-1) - tpMean) / (0.015 * meanDeviation) : 0;

  const priceEma12 = emaSeries(closes, 12);
  const priceEma26 = emaSeries(closes, 26);
  const priceMacdSeries = closes.map((_, i) => {
    const fast = priceEma12[i];
    const slow = priceEma26[i];
    return Number.isFinite(fast) && Number.isFinite(slow) && fast !== 0 ? (fast - slow) / fast : NaN;
  });
  const priceMacd = priceMacdSeries.at(-1);
  const priceMacdClean = priceMacdSeries.filter(Number.isFinite);
  const priceMacdSignal = emaSeries(priceMacdClean, 9).at(-1);

  const volumeEma12 = emaSeries(volumes, 12);
  const volumeEma26 = emaSeries(volumes, 26);
  const volumeMacdSeries = volumes.map((_, i) => {
    const fast = volumeEma12[i];
    const slow = volumeEma26[i];
    return Number.isFinite(fast) && Number.isFinite(slow) && fast !== 0 ? (fast - slow) / fast : NaN;
  });
  const volumeMacd = volumeMacdSeries.at(-1);
  const volumeMacdClean = volumeMacdSeries.filter(Number.isFinite);
  const volumeMacdSignal = emaSeries(volumeMacdClean, 9).at(-1);

  const cmfWindow = rows.slice(-20);
  const mfv = cmfWindow.map((row) => {
    const range = row.high - row.low;
    const multiplier = range > 0 ? ((row.close - row.low) - (row.high - row.close)) / range : 0;
    return multiplier * row.quoteVolume;
  });
  const volume20 = cmfWindow.reduce((sum, row) => sum + row.quoteVolume, 0);
  const chaikin = volume20 > 0 ? mfv.reduce((sum, value) => sum + value, 0) / volume20 : 0;

  const close20 = closes.slice(-20);
  const bollMid = mean(close20);
  const bollStd = stdev(close20, false);
  const bollLower = bollMid - 2 * bollStd;
  const bollUpper = bollMid + 2 * bollStd;

  const signals = [
    rsiNow,
    stochK,
    stochD,
    stochRsi,
    cci20,
    ...[3, 5, 10, 20, 50, 100, 200].map((length) => sma(closes, length) / currentClose),
    priceMacd,
    priceMacd - priceMacdSignal,
    ...[3, 5, 10, 20, 50, 100, 200].map((length) => sma(volumes, length) / currentVolume),
    volumeMacd,
    volumeMacd - volumeMacdSignal,
    chaikin,
    bollLower / currentClose,
    bollMid / currentClose,
    bollUpper / currentClose,
    bollMid !== 0 ? (bollUpper - bollLower) / bollMid : 0
  ];
  return signals.length === 28 && signals.every(Number.isFinite) ? signals : null;
}

export function averageRanks(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = Array(values.length).fill(NaN);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor + 1;
    while (end < indexed.length && indexed[end].value === indexed[cursor].value) end += 1;
    const rank = ((cursor + 1) + end) / 2;
    for (let i = cursor; i < end; i += 1) ranks[indexed[i].index] = rank;
    cursor = end;
  }
  return ranks;
}

export function rankCrossSection(rows) {
  if (!rows.length) return [];
  const p = rows[0].rawSignals.length;
  if (p !== 28 || rows.some((row) => row.rawSignals.length !== p || !row.rawSignals.every(Number.isFinite))) {
    throw new Error('Invalid CTREND raw-signal matrix');
  }
  const ranked = rows.map((row) => ({ ...row, signals: Array(p).fill(NaN) }));
  for (let j = 0; j < p; j += 1) {
    const ranks = averageRanks(rows.map((row) => row.rawSignals[j]));
    const denominator = Math.max(1, rows.length - 1);
    for (let i = 0; i < rows.length; i += 1) ranked[i].signals[j] = rows.length === 1 ? 0 : (ranks[i] - 1) / denominator - 0.5;
  }
  return ranked;
}

export function buildCtrendPanel(dataset, manifest, membership) {
  const members = [...membership];
  if (members.length !== finite(manifest?.universe?.membershipSize, 30) || new Set(members).size !== members.length) {
    throw new Error('Trial 4 requires the exact frozen unique membership');
  }
  const products = Object.fromEntries(members.map((symbol) => {
    const rows = indexCandles(dataset?.products?.[symbol]);
    return [symbol, { rows, byTime: new Map(rows.map((row) => [row.time, row])) }];
  }));
  const startIso = manifest.historicalData.modelTrainingStart;
  const endIso = manifest.historicalData.finalHoldoutEndExclusive;
  const times = weeklyDecisionTimes(startIso, endIso);
  const panel = [];
  for (const time of times) {
    const next = time + 7 * 86400;
    const crossSection = [];
    for (const symbol of members) {
      const product = products[symbol];
      const openRow = product.byTime.get(time);
      if (!openRow || !(openRow.open > 0)) continue;
      const rawSignals = rawTechnicalSignals(product.rows, time);
      if (!rawSignals) continue;
      const nextRow = product.byTime.get(next);
      const target = nextRow?.open > 0 ? Math.log(nextRow.open / openRow.open) : null;
      crossSection.push({ time, labelEnd: next, symbol, open: openRow.open, rawSignals, target: Number.isFinite(target) ? target : null });
    }
    panel.push(...rankCrossSection(crossSection));
  }
  return panel;
}

function fitUnivariateCrossSection(rows, signalIndex) {
  const clean = rows.filter((row) => Number.isFinite(row.target) && Number.isFinite(row.signals?.[signalIndex]));
  if (clean.length < 3) return null;
  const x = clean.map((row) => row.signals[signalIndex]);
  const y = clean.map((row) => row.target);
  const xMean = mean(x);
  const yMean = mean(y);
  const denominator = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (!(denominator > 1e-12)) return { intercept: yMean, slope: 0, n: clean.length };
  const slope = clean.reduce((sum, row) => sum + (row.signals[signalIndex] - xMean) * (row.target - yMean), 0) / denominator;
  return { intercept: yMean - slope * xMean, slope, n: clean.length };
}

function weeklySlopes(panel, minAssets) {
  const times = [...new Set(panel.map((row) => row.time))].sort((a, b) => a - b);
  const out = new Map();
  for (const time of times) {
    const rows = panel.filter((row) => row.time === time && Number.isFinite(row.target));
    if (rows.length < minAssets) continue;
    const models = CTREND_SIGNAL_NAMES.map((_, signalIndex) => fitUnivariateCrossSection(rows, signalIndex));
    if (models.every(Boolean)) out.set(time, { time, labelEnd: time + 7 * 86400, models });
  }
  return out;
}

function smoothFirstStageModels(slopes, cutoff, windowWeeks) {
  const eligible = [...slopes.values()]
    .filter((entry) => entry.labelEnd <= cutoff)
    .sort((a, b) => a.time - b.time)
    .slice(-windowWeeks);
  if (eligible.length < windowWeeks) return null;
  return CTREND_SIGNAL_NAMES.map((_, j) => ({
    intercept: mean(eligible.map((entry) => entry.models[j].intercept)),
    slope: mean(eligible.map((entry) => entry.models[j].slope))
  }));
}

export function firstStageForecasts(panel, manifest) {
  const minAssets = Math.trunc(finite(manifest.model.minimumEligibleAssetsPerWeek, 10));
  const windowWeeks = Math.trunc(finite(manifest.model.minimumHistoryWeeks, 52));
  const slopes = weeklySlopes(panel, minAssets);
  const times = [...new Set(panel.map((row) => row.time))].sort((a, b) => a - b);
  const output = new Map();
  for (const time of times) {
    const current = panel.filter((row) => row.time === time);
    if (current.length < minAssets) continue;
    const cutoff = time - 7 * 86400;
    const models = smoothFirstStageModels(slopes, cutoff, windowWeeks);
    if (!models) continue;
    const rows = current.map((row) => ({
      ...row,
      firstStage: models.map((model, j) => model.intercept + model.slope * row.signals[j])
    }));
    output.set(time, { time, cutoff, models, rows });
  }
  return output;
}

function standardizeMatrix(samples) {
  const p = samples[0].features.length;
  const means = Array.from({ length: p }, (_, j) => mean(samples.map((sample) => sample.features[j])));
  const scales = Array.from({ length: p }, (_, j) => {
    const sd = stdev(samples.map((sample) => sample.features[j]), false);
    return Number.isFinite(sd) && sd > 1e-12 ? sd : 1;
  });
  return {
    means,
    scales,
    x: samples.map((sample) => sample.features.map((value, j) => (value - means[j]) / scales[j])),
    y: samples.map((sample) => sample.target)
  };
}

function elasticNetAtLambda(samples, lambda, alpha, maxIterations = 10_000, tolerance = 1e-9) {
  const { means, scales, x, y } = standardizeMatrix(samples);
  const n = y.length;
  const p = x[0].length;
  const yMean = mean(y);
  const centeredY = y.map((value) => value - yMean);
  const beta = Array(p).fill(0);
  const fitted = Array(n).fill(0);
  const norms = Array.from({ length: p }, (_, j) => x.reduce((sum, row) => sum + row[j] ** 2, 0) / n);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let maxChange = 0;
    for (let j = 0; j < p; j += 1) {
      const old = beta[j];
      let rho = 0;
      for (let i = 0; i < n; i += 1) rho += x[i][j] * (centeredY[i] - fitted[i] + x[i][j] * old);
      rho /= n;
      const updated = softThreshold(rho, lambda * alpha) / Math.max(1e-12, norms[j] + lambda * (1 - alpha));
      const delta = updated - old;
      if (delta !== 0) {
        beta[j] = updated;
        for (let i = 0; i < n; i += 1) fitted[i] += x[i][j] * delta;
        maxChange = Math.max(maxChange, Math.abs(delta));
      }
    }
    if (maxChange < tolerance) break;
  }

  const residuals = centeredY.map((value, i) => value - fitted[i]);
  const rss = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const nonzero = beta.filter((value) => Math.abs(value) > 1e-10).length;
  const k = nonzero + 1;
  const aic = n * Math.log(Math.max(rss / n, 1e-30)) + 2 * k;
  const aicc = n > k + 1 ? aic + (2 * k * (k + 1)) / (n - k - 1) : Infinity;
  return { intercept: yMean, coefficients: beta, featureMeans: means, featureScales: scales, lambda, alpha, rss, aicc, nonzero, n };
}

export function fitElasticNetAicc(samples, options = {}) {
  if (!samples.length || !samples.every((sample) => Number.isFinite(sample.target) && sample.features?.length === 28 && sample.features.every(Number.isFinite))) {
    throw new Error('Invalid elastic-net training samples');
  }
  const alpha = finite(options.alpha, 0.5);
  const points = Math.max(3, Math.trunc(finite(options.lambdaGridPoints, 50)));
  const ratio = finite(options.lambdaMinRatio, 1e-4);
  const standardized = standardizeMatrix(samples);
  const yMean = mean(standardized.y);
  const centeredY = standardized.y.map((value) => value - yMean);
  const n = samples.length;
  let lambdaMax = 0;
  for (let j = 0; j < 28; j += 1) {
    const covariance = Math.abs(standardized.x.reduce((sum, row, i) => sum + row[j] * centeredY[i], 0) / n);
    lambdaMax = Math.max(lambdaMax, covariance / Math.max(alpha, 1e-12));
  }
  if (!(lambdaMax > 0)) lambdaMax = 1e-8;
  const lambdaMin = lambdaMax * Math.min(1, Math.max(1e-8, ratio));
  const lambdas = Array.from({ length: points }, (_, index) => {
    const fraction = index / (points - 1);
    return Math.exp(Math.log(lambdaMax) * (1 - fraction) + Math.log(lambdaMin) * fraction);
  });
  const fits = lambdas.map((lambda) => elasticNetAtLambda(samples, lambda, alpha, finite(options.maxIterations, 10_000), finite(options.tolerance, 1e-9)));
  return fits.sort((a, b) => a.aicc - b.aicc || b.lambda - a.lambda)[0];
}

function predictElasticNet(model, features) {
  return model.intercept + features.reduce((sum, value, j) => sum + ((value - model.featureMeans[j]) / model.featureScales[j]) * model.coefficients[j], 0);
}

export function walkForwardCtrendPredictions(panel, manifest, startIso, endExclusiveIso) {
  const start = Math.floor(Date.parse(startIso) / 1000);
  const end = Math.floor(Date.parse(endExclusiveIso) / 1000);
  const minAssets = Math.trunc(finite(manifest.model.minimumEligibleAssetsPerWeek, 10));
  const secondWindow = Math.trunc(finite(manifest.model.secondStageWindowWeeks, 52));
  const alpha = finite(manifest.model.elasticNetAlpha, 0.5);
  const first = firstStageForecasts(panel, manifest);
  const times = [...first.keys()].filter((time) => time >= start && time < end).sort((a, b) => a - b);
  const output = new Map();

  for (const time of times) {
    const current = first.get(time);
    const embargoCutoff = time - 7 * 86400;
    const eligibleTrainingWeeks = [...first.keys()]
      .filter((trainTime) => trainTime < time && trainTime + 7 * 86400 <= embargoCutoff)
      .sort((a, b) => a - b)
      .slice(-secondWindow);
    if (eligibleTrainingWeeks.length < secondWindow) continue;
    const training = eligibleTrainingWeeks.flatMap((trainTime) => first.get(trainTime).rows
      .filter((row) => Number.isFinite(row.target) && row.firstStage.every(Number.isFinite))
      .map((row) => ({ features: row.firstStage, target: row.target })));
    if (training.length < minAssets * secondWindow) continue;
    const model = fitElasticNetAicc(training, {
      alpha,
      lambdaGridPoints: finite(manifest.model.lambdaGridPoints, 50),
      lambdaMinRatio: finite(manifest.model.lambdaMinRatio, 1e-4),
      maxIterations: finite(manifest.model.maxIterations, 10_000),
      tolerance: finite(manifest.model.convergenceTolerance, 1e-9)
    });
    const surviving = model.coefficients.map((coefficient, index) => ({ coefficient, index })).filter((entry) => entry.coefficient > 1e-10).map((entry) => entry.index);
    const rows = current.rows.map((row) => {
      const prediction = surviving.length ? mean(surviving.map((j) => row.firstStage[j])) : NaN;
      return { ...row, prediction };
    });
    output.set(time, {
      time,
      embargoCutoff,
      trainingWeeks: eligibleTrainingWeeks.length,
      trainingRows: training.length,
      lambda: model.lambda,
      aicc: model.aicc,
      selectedSignalIndexes: surviving,
      selectedSignals: surviving.map((j) => CTREND_SIGNAL_NAMES[j]),
      diagnosticElasticNetPrediction: rows.map((row) => ({ symbol: row.symbol, value: predictElasticNet(model, row.firstStage) })),
      rows
    });
  }
  return output;
}
