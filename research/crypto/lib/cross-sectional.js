function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

export function stdev(values, sample = true) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < (sample ? 2 : 1)) return 0;
  const mu = mean(clean);
  const denominator = clean.length - (sample ? 1 : 0);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - mu) ** 2, 0) / Math.max(1, denominator));
}

export function quantileLinear(values, probability) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  if (clean.length === 1) return clean[0];
  const p = Math.min(1, Math.max(0, finite(probability)));
  const index = (clean.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return clean[lower];
  const weight = index - lower;
  return clean[lower] * (1 - weight) + clean[upper] * weight;
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

export function fitCrossSectionalRidge(samples, lambda = 10) {
  if (!samples.length) throw new Error('Cannot fit cross-sectional ridge with no samples');
  const p = samples[0].features.length;
  const dimension = p + 1;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  for (const sample of samples) {
    if (sample.features.length !== p || !sample.features.every(Number.isFinite) || !Number.isFinite(sample.target)) {
      throw new Error('Non-finite or inconsistent ridge sample');
    }
    const x = [1, ...sample.features];
    for (let j = 0; j < dimension; j += 1) {
      xty[j] += x[j] * sample.target;
      for (let k = 0; k < dimension; k += 1) xtx[j][k] += x[j] * x[k];
    }
  }
  for (let j = 1; j < dimension; j += 1) xtx[j][j] += Math.max(0, finite(lambda));
  const beta = solveLinearSystem(xtx, xty);
  return { intercept: beta[0], coefficients: beta.slice(1), lambda: Math.max(0, finite(lambda)), trainingRows: samples.length };
}

export function predictCrossSectionalRidge(model, features) {
  if (features.length !== model.coefficients.length || !features.every(Number.isFinite)) {
    throw new Error('Prediction feature mismatch');
  }
  return model.intercept + features.reduce((sum, value, index) => sum + value * model.coefficients[index], 0);
}

function monthStartSeconds(year, monthIndex) {
  return Math.floor(Date.UTC(year, monthIndex, 1, 0, 0, 0) / 1000);
}

export function previousMonthStart(time) {
  const date = new Date(finite(time) * 1000);
  return monthStartSeconds(date.getUTCFullYear(), date.getUTCMonth() - 1);
}

export function nextMonthStart(time) {
  const date = new Date(finite(time) * 1000);
  return monthStartSeconds(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

export function monthlyDecisionTimes(startIso, endExclusiveIso) {
  const start = new Date(startIso);
  const end = new Date(endExclusiveIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error('Invalid monthly decision range');
  }
  const out = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  let time = monthStartSeconds(year, month);
  if (time < Math.floor(start.getTime() / 1000)) {
    month += 1;
    time = monthStartSeconds(year, month);
  }
  const endSec = Math.floor(end.getTime() / 1000);
  while (time < endSec) {
    out.push(time);
    const date = new Date(time * 1000);
    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    time = monthStartSeconds(year, month);
  }
  return out;
}

function byTime(candles) {
  return new Map((candles ?? []).map((row) => [finite(row.time), row]));
}

function logReturn(end, start) {
  return end > 0 && start > 0 ? Math.log(end / start) : NaN;
}

function simpleReturn(end, start) {
  return end > 0 && start > 0 ? end / start - 1 : NaN;
}

function strictTrailingBars(index, decisionTime, days) {
  const rows = [];
  for (let lag = days; lag >= 1; lag -= 1) {
    const row = index.get(decisionTime - lag * 86400);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

function rawFeaturesForAsset(candles, index, decisionTime, firstObservedTime = null) {
  const prior90 = strictTrailingBars(index, decisionTime, 91);
  if (!prior90) return null;
  const recent30 = prior90.slice(-30);
  const last = prior90.at(-1);
  const close30Ago = prior90[prior90.length - 31];
  const close90Ago = prior90[0];
  if (!last || !close30Ago || !close90Ago) return null;

  const dailyReturns30 = [];
  const amihud = [];
  for (let i = prior90.length - 30; i < prior90.length; i += 1) {
    const now = prior90[i];
    const before = prior90[i - 1];
    if (!now || !before || finite(now.close) <= 0 || finite(before.close) <= 0 || finite(now.quoteVolume) <= 0) return null;
    const lr = logReturn(finite(now.close), finite(before.close));
    const sr = simpleReturn(finite(now.close), finite(before.close));
    if (!Number.isFinite(lr) || !Number.isFinite(sr)) return null;
    dailyReturns30.push(lr);
    amihud.push(Math.abs(sr) / finite(now.quoteVolume));
  }

  const fallbackFirst = candles?.[0] ? finite(candles[0].time, NaN) : NaN;
  const firstTime = Number.isFinite(Number(firstObservedTime)) ? Number(firstObservedTime) : fallbackFirst;
  if (!Number.isFinite(firstTime) || firstTime >= decisionTime) return null;
  const ageDays = Math.max(0, (decisionTime - firstTime) / 86400);
  const quoteVolumes = recent30.map((row) => finite(row.quoteVolume)).filter((value) => value > 0);
  if (quoteVolumes.length !== 30) return null;
  quoteVolumes.sort((a, b) => a - b);
  const medianVolume = quoteVolumes.length % 2
    ? quoteVolumes[Math.floor(quoteVolumes.length / 2)]
    : (quoteVolumes[quoteVolumes.length / 2 - 1] + quoteVolumes[quoteVolumes.length / 2]) / 2;

  const features = [
    logReturn(finite(last.close), finite(close30Ago.close)),
    logReturn(finite(last.close), finite(close90Ago.close)),
    stdev(dailyReturns30, true),
    Math.log(medianVolume),
    mean(amihud),
    Math.log1p(ageDays)
  ];
  return features.every(Number.isFinite) ? features : null;
}

export function winsorizeAndZscore(rows, lowerProbability = 0.05, upperProbability = 0.95) {
  if (!rows.length) return [];
  const p = rows[0].rawFeatures.length;
  const columns = Array.from({ length: p }, (_, featureIndex) => rows.map((row) => row.rawFeatures[featureIndex]));
  const bounds = columns.map((column) => ({
    lower: quantileLinear(column, lowerProbability),
    upper: quantileLinear(column, upperProbability)
  }));
  const winsorized = rows.map((row) => row.rawFeatures.map((value, featureIndex) => {
    const { lower, upper } = bounds[featureIndex];
    return Math.min(upper, Math.max(lower, value));
  }));
  const means = Array.from({ length: p }, (_, featureIndex) => mean(winsorized.map((row) => row[featureIndex])));
  const scales = Array.from({ length: p }, (_, featureIndex) => Math.max(stdev(winsorized.map((row) => row[featureIndex]), true), 1e-12));
  return rows.map((row, rowIndex) => ({
    ...row,
    features: winsorized[rowIndex].map((value, featureIndex) => (value - means[featureIndex]) / scales[featureIndex])
  }));
}

export function buildCrossSectionalPanel(dataset, manifest, membership) {
  const members = [...membership];
  if (!members.length || new Set(members).size !== members.length) throw new Error('Frozen membership is empty or non-unique');
  const firstObservedTimeBySymbol = dataset?.firstObservedTimeBySymbol ?? {};
  const data = Object.fromEntries(members.map((symbol) => {
    const candles = [...(dataset?.products?.[symbol] ?? [])].sort((a, b) => finite(a.time) - finite(b.time));
    const firstObservedTime = Number(firstObservedTimeBySymbol[symbol]);
    return [symbol, {
      candles,
      index: byTime(candles),
      firstObservedTime: Number.isFinite(firstObservedTime) ? firstObservedTime : null
    }];
  }));
  const startIso = manifest.historicalData.developmentStart;
  const endIso = manifest.historicalData.finalHoldoutEndExclusive;
  const times = monthlyDecisionTimes(startIso, endIso);
  const rows = [];

  for (const time of times) {
    const next = nextMonthStart(time);
    const crossSection = [];
    for (const symbol of members) {
      const { candles, index, firstObservedTime } = data[symbol];
      const openRow = index.get(time);
      if (!openRow || finite(openRow.open) <= 0) continue;
      const rawFeatures = rawFeaturesForAsset(candles, index, time, firstObservedTime);
      if (!rawFeatures) continue;
      const nextOpen = index.get(next);
      const target = nextOpen && finite(nextOpen.open) > 0
        ? logReturn(finite(nextOpen.open), finite(openRow.open))
        : null;
      crossSection.push({
        time,
        labelEnd: next,
        symbol,
        open: finite(openRow.open),
        rawFeatures,
        target: Number.isFinite(target) ? target : null
      });
    }
    const transformed = winsorizeAndZscore(crossSection, 0.05, 0.95);
    rows.push(...transformed);
  }
  return rows;
}

export function walkForwardCrossSectionalPredictions(panel, manifest, startIso, endExclusiveIso) {
  const startSec = Math.floor(Date.parse(startIso) / 1000);
  const endSec = Math.floor(Date.parse(endExclusiveIso) / 1000);
  const times = [...new Set(panel.map((row) => row.time))]
    .filter((time) => time >= startSec && time < endSec)
    .sort((a, b) => a - b);
  const output = new Map();
  const lambda = finite(manifest.model.ridgeLambda, 10);
  const minAssets = Math.trunc(finite(manifest.model.minimumEligibleAssetsPerRebalance, 10));
  const minTrainingMonths = Math.trunc(finite(manifest.model.minimumTrainingMonths, 12));

  for (const time of times) {
    const current = panel.filter((row) => row.time === time);
    if (current.length < minAssets) continue;
    const embargoCutoff = previousMonthStart(time);
    const train = panel.filter((row) => row.target !== null && row.labelEnd <= embargoCutoff);
    const trainingMonths = new Set(train.map((row) => row.time)).size;
    if (trainingMonths < minTrainingMonths || train.length < minAssets * minTrainingMonths) continue;
    const model = fitCrossSectionalRidge(train, lambda);
    output.set(time, {
      time,
      embargoCutoff,
      trainingMonths,
      trainingRows: train.length,
      model,
      rows: current.map((row) => ({ ...row, prediction: predictCrossSectionalRidge(model, row.features) }))
    });
  }
  return output;
}

export function costGateLogThreshold(manifest) {
  const bps = finite(manifest?.costModel?.roundTripCostBps, 140);
  return Math.log1p(Math.max(0, bps) / 10_000);
}

export function selectCrossSection(predictionRows, manifest) {
  const gate = costGateLogThreshold(manifest);
  const maxSelected = Math.trunc(finite(manifest?.portfolio?.maxSelectedAssets, 3));
  return [...predictionRows]
    .filter((row) => Number.isFinite(row.prediction) && row.prediction > gate)
    .sort((left, right) => right.prediction - left.prediction || left.symbol.localeCompare(right.symbol))
    .slice(0, maxSelected);
}
