#!/usr/bin/env node
import fs from 'node:fs';

const [manifestPath, mode, summaryPath, adaSourcesPath, dogeSourcesPath, outPath] = process.argv.slice(2);
if (!manifestPath || !mode || !summaryPath || !adaSourcesPath || !dogeSourcesPath || !outPath) throw new Error('usage: funding-regime-carry-gate.js <manifest> <development|final> <summary> <ada-sources> <doge-sources> <out>');
if (!['development', 'final'].includes(mode)) throw new Error('bad mode');
if (fs.existsSync(outPath)) throw new Error(`refusing overwrite ${outPath}`);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const ada = JSON.parse(fs.readFileSync(adaSourcesPath, 'utf8'));
const doge = JSON.parse(fs.readFileSync(dogeSourcesPath, 'utf8'));
if (m.experimentId !== 'funding-regime-carry-v1' || m.trialNumber !== 19 || s.experimentId !== m.experimentId || s.trialNumber !== 19 || s.mode !== mode) throw new Error('Trial 19 identity mismatch');
const expectedWindow = mode === 'development' ? m.developmentWindow : m.finalHoldout;
if (s.window.startInclusive !== expectedWindow.startInclusive || s.window.endExclusive !== expectedWindow.endExclusive) throw new Error('Trial 19 window mismatch');
function sourcePass(src, symbol) {
  const c = src.coverage;
  return src.experimentId === m.experimentId && src.trialNumber === 19 && src.mode === mode && src.symbol === symbol && src.economicResultCalculated === false && c.expectedBoundaryRows === c.synchronizedRows && c.overlapMismatchCount === 0 && c.missingSpotRows === 0 && c.missingPerpRows === 0 && c.missingMarkRows === 0;
}
function stressPass(sleeve) {
  if (sleeve.diagnostics.marginBreach) return false;
  return Object.values(sleeve.diagnostics.gapStress).every((x) => x.breached === false && Number.isFinite(x.minimumExcessMargin) && x.minimumExcessMargin >= 0);
}
const exactSources = sourcePass(ada, 'ADAUSDT') && sourcePass(doge, 'DOGEUSDT');
const noMarginBreach = !s.sleeves.ADAUSDT.diagnostics.marginBreach && !s.sleeves.DOGEUSDT.diagnostics.marginBreach;
const allStress = stressPass(s.sleeves.ADAUSDT) && stressPass(s.sleeves.DOGEUSDT);
const criteria = mode === 'development' ? m.developmentGate : m.promotionCriteria;
const checks = mode === 'development' ? {
  positiveBasketNetReturn: { pass: s.basket.netReturn > 0, observed: s.basket.netReturn },
  minimumBasketSharpe: { pass: s.basket.sharpe >= criteria.minimumBasketSharpe, observed: s.basket.sharpe, threshold: criteria.minimumBasketSharpe },
  maximumAllowedBasketDrawdown: { pass: s.basket.maxDrawdown >= criteria.maximumAllowedBasketDrawdown, observed: s.basket.maxDrawdown, threshold: criteria.maximumAllowedBasketDrawdown },
  minimumCompletedRoundTrips: { pass: s.completedRoundTrips >= criteria.minimumCompletedRoundTrips, observed: s.completedRoundTrips, threshold: criteria.minimumCompletedRoundTrips },
  noSleeveRealizedMarginBreach: { pass: noMarginBreach },
  allSleevesAllFrozenGapStressesPass: { pass: allStress },
  exactSourceUnionForBothSleeves: { pass: exactSources },
} : {
  positiveFinalBasketNetReturn: { pass: s.basket.netReturn > 0, observed: s.basket.netReturn },
  minimumFinalBasketSharpe: { pass: s.basket.sharpe >= criteria.minimumFinalBasketSharpe, observed: s.basket.sharpe, threshold: criteria.minimumFinalBasketSharpe },
  maximumAllowedFinalBasketDrawdown: { pass: s.basket.maxDrawdown >= criteria.maximumAllowedFinalBasketDrawdown, observed: s.basket.maxDrawdown, threshold: criteria.maximumAllowedFinalBasketDrawdown },
  minimumFinalCompletedRoundTrips: { pass: s.completedRoundTrips >= criteria.minimumFinalCompletedRoundTrips, observed: s.completedRoundTrips, threshold: criteria.minimumFinalCompletedRoundTrips },
  noSleeveRealizedMarginBreach: { pass: noMarginBreach },
  allSleevesAllFrozenGapStressesPass: { pass: allStress },
  exactSourceUnionForBothSleeves: { pass: exactSources },
};
const pass = Object.values(checks).every((x) => x.pass === true);
const result = {
  experimentId: m.experimentId,
  trialNumber: 19,
  mode,
  generatedAt: new Date().toISOString(),
  developmentGatePass: mode === 'development' ? pass : undefined,
  finalAccessAuthorizedByGate: mode === 'development' ? pass : undefined,
  promotionEligible: mode === 'final' ? pass : undefined,
  promotionScope: mode === 'final' && pass ? 'paper-baseline-proposal-only' : 'none',
  realMoneyAllowed: false,
  checks,
  rule: criteria.decision,
  antiRescueRule: m.antiRescueRule,
};
fs.mkdirSync(outPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
