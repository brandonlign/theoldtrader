import {
  CTREND_SIGNAL_NAMES,
  firstStageForecasts,
  fitElasticNetAicc,
  mean
} from './ctrend.js';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function eligibleTrainingWeeks(panel, cutoff, windowWeeks, minAssets) {
  const groups = new Map();
  for (const row of panel) {
    if (!Number.isFinite(row.target) || row.labelEnd > cutoff) continue;
    if (!groups.has(row.time)) groups.set(row.time, []);
    groups.get(row.time).push(row);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length >= minAssets)
    .sort((a, b) => a[0] - b[0])
    .slice(-windowWeeks);
}

function predictElasticNet(model, features) {
  return model.intercept + features.reduce((sum, value, j) => {
    const standardized = (value - model.featureMeans[j]) / model.featureScales[j];
    return sum + standardized * model.coefficients[j];
  }, 0);
}

/**
 * Frozen Trial 4 rolling estimator.
 *
 * At each prediction week, the first-stage 28 univariate FM coefficients are
 * smoothed over the same trailing 52 eligible training weeks. Those current
 * smoothed models are then applied to every asset-week in that training window
 * to construct the generated forecast regressors used by the elastic-net
 * selector. All labels end before the one-week embargo cutoff. This mirrors a
 * single 52-week rolling parameter-estimation window and avoids an unintended
 * second 52-week OOS stacking warm-up.
 */
export function walkForwardCtrendWindowedPredictions(panel, manifest, startIso, endExclusiveIso) {
  const start = Math.floor(Date.parse(startIso) / 1000);
  const end = Math.floor(Date.parse(endExclusiveIso) / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid CTREND evaluation range');

  const minAssets = Math.trunc(finite(manifest.model.minimumEligibleAssetsPerWeek, 10));
  const windowWeeks = Math.trunc(finite(manifest.model.minimumHistoryWeeks, 52));
  const alpha = finite(manifest.model.elasticNetAlpha, 0.5);
  const first = firstStageForecasts(panel, manifest);
  const output = new Map();

  for (const time of [...first.keys()].filter((value) => value >= start && value < end).sort((a, b) => a - b)) {
    const current = first.get(time);
    const embargoCutoff = time - 7 * 86400;
    const trainingWeeks = eligibleTrainingWeeks(panel, embargoCutoff, windowWeeks, minAssets);
    if (trainingWeeks.length < windowWeeks) continue;

    const training = trainingWeeks.flatMap(([, rows]) => rows.map((row) => ({
      features: current.models.map((model, j) => model.intercept + model.slope * row.signals[j]),
      target: row.target
    }))).filter((sample) => sample.features.every(Number.isFinite) && Number.isFinite(sample.target));
    if (training.length < minAssets * windowWeeks) continue;

    const model = fitElasticNetAicc(training, {
      alpha,
      lambdaGridPoints: finite(manifest.model.lambdaGridPoints, 50),
      lambdaMinRatio: finite(manifest.model.lambdaMinRatio, 1e-4),
      maxIterations: finite(manifest.model.maxIterations, 10_000),
      tolerance: finite(manifest.model.convergenceTolerance, 1e-9)
    });
    const selectedSignalIndexes = model.coefficients
      .map((coefficient, index) => ({ coefficient, index }))
      .filter((entry) => entry.coefficient > 1e-10)
      .map((entry) => entry.index);

    const rows = current.rows.map((row) => ({
      ...row,
      prediction: selectedSignalIndexes.length
        ? mean(selectedSignalIndexes.map((index) => row.firstStage[index]))
        : NaN
    }));

    output.set(time, {
      time,
      embargoCutoff,
      trainingWeeks: trainingWeeks.length,
      trainingRows: training.length,
      firstStageModels: current.models,
      lambda: model.lambda,
      aicc: model.aicc,
      selectedSignalIndexes,
      selectedSignals: selectedSignalIndexes.map((index) => CTREND_SIGNAL_NAMES[index]),
      diagnosticElasticNetPrediction: rows.map((row) => ({
        symbol: row.symbol,
        value: predictElasticNet(model, row.firstStage)
      })),
      rows
    });
  }
  return output;
}
