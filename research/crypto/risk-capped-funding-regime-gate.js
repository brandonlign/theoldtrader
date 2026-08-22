#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length !== 8) throw new Error('usage: risk-capped-funding-regime-gate.js <manifest> <development|final> <summary> <link-sources> <bch-sources> <eos-sources> <uni-sources> <out>');
const [manifestPath, mode, summaryPath, linkPath, bchPath, eosPath, uniPath, outPath] = args;
if (!['development', 'final'].includes(mode)) throw new Error('bad mode');
if (fs.existsSync(outPath)) throw new Error(`refusing overwrite ${outPath}`);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
if (m.experimentId !== 'risk-capped-funding-regime-v1' || m.trialNumber !== 22 || s.experimentId !== m.experimentId || s.trialNumber !== 22 || s.mode !== mode) throw new Error('Trial 22 identity mismatch');
const symbols = ['LINKUSDT', 'BCHUSDT', 'EOSUSDT', 'UNIUSDT'];
const sourceFiles = { LINKUSDT: linkPath, BCHUSDT: bchPath, EOSUSDT: eosPath, UNIUSDT: uniPath };
const sources = Object.fromEntries(symbols.map((symbol) => [symbol, JSON.parse(fs.readFileSync(sourceFiles[symbol], 'utf8'))]));
const expectedWindow = mode === 'development' ? m.developmentWindow : m.finalHoldout;
if (s.window.startInclusive !== expectedWindow.startInclusive || s.window.endExclusive !== expectedWindow.endExclusive) throw new Error('Trial 22 window mismatch');

function exactSource(src, symbol) {
  const c = src.coverage ?? {};
  return src.experimentId === m.experimentId && src.trialNumber === 22 && src.mode === mode && src.symbol === symbol && src.economicResultCalculated === false &&
    Number(c.expectedBoundaryRows) === Number(c.synchronizedRows) && Number(c.overlapMismatchCount) === 0 &&
    Number(c.missingSpotRows) === 0 && Number(c.missingPerpRows) === 0 && Number(c.missingMarkRows) === 0;
}
function stressPass(sleeve) {
  if (sleeve.diagnostics.realizedMarginBreach) return false;
  const stress = sleeve.diagnostics.gapStress ?? {};
  return m.marginStress.additionalGapStressPct.every((g) => {
    const x = stress[String(g)];
    return x && x.breached === false && (x.minimumExcessMargin === null || Number(x.minimumExcessMargin) >= 0);
  });
}
const sourcePass = symbols.every((symbol) => exactSource(sources[symbol], symbol));
const noRealizedMarginBreach = symbols.every((symbol) => !s.sleeves[symbol].diagnostics.realizedMarginBreach);
const allStressPass = symbols.every((symbol) => stressPass(s.sleeves[symbol]));
const rules = mode === 'development' ? m.developmentGate : m.promotionCriteria;
const checks = mode === 'development' ? {
  positiveBasketNetReturn: { pass: s.basket.netReturn > 0, observed: s.basket.netReturn },
  minimumBasketSharpe: { pass: s.basket.sharpe >= rules.minimumBasketSharpe, observed: s.basket.sharpe, threshold: rules.minimumBasketSharpe },
  maximumAllowedBasketDrawdown: { pass: s.basket.maxDrawdown >= rules.maximumAllowedBasketDrawdown, observed: s.basket.maxDrawdown, threshold: rules.maximumAllowedBasketDrawdown },
  minimumCompletedRoundTrips: { pass: s.completedRoundTrips >= rules.minimumCompletedRoundTrips, observed: s.completedRoundTrips, threshold: rules.minimumCompletedRoundTrips },
  minimumSleevesWithActivity: { pass: s.sleevesWithActivity >= rules.minimumSleevesWithActivity, observed: s.sleevesWithActivity, threshold: rules.minimumSleevesWithActivity },
  noSleeveRealizedMarginBreach: { pass: noRealizedMarginBreach },
  allSleevesAllFrozenGapStressesPass: { pass: allStressPass },
  exactSourceUnionForAllSleeves: { pass: sourcePass },
} : {
  positiveFinalBasketNetReturn: { pass: s.basket.netReturn > 0, observed: s.basket.netReturn },
  minimumFinalBasketSharpe: { pass: s.basket.sharpe >= rules.minimumFinalBasketSharpe, observed: s.basket.sharpe, threshold: rules.minimumFinalBasketSharpe },
  maximumAllowedFinalBasketDrawdown: { pass: s.basket.maxDrawdown >= rules.maximumAllowedFinalBasketDrawdown, observed: s.basket.maxDrawdown, threshold: rules.maximumAllowedFinalBasketDrawdown },
  minimumFinalCompletedRoundTrips: { pass: s.completedRoundTrips >= rules.minimumFinalCompletedRoundTrips, observed: s.completedRoundTrips, threshold: rules.minimumFinalCompletedRoundTrips },
  minimumFinalSleevesWithActivity: { pass: s.sleevesWithActivity >= rules.minimumFinalSleevesWithActivity, observed: s.sleevesWithActivity, threshold: rules.minimumFinalSleevesWithActivity },
  noSleeveRealizedMarginBreach: { pass: noRealizedMarginBreach },
  allSleevesAllFrozenGapStressesPass: { pass: allStressPass },
  exactSourceUnionForAllSleeves: { pass: sourcePass },
};
const pass = Object.values(checks).every((x) => x.pass === true);
const result = {
  experimentId: m.experimentId,
  trialNumber: 22,
  mode,
  generatedAt: new Date().toISOString(),
  developmentGatePass: mode === 'development' ? pass : undefined,
  finalAccessAuthorizedByGate: mode === 'development' ? pass : undefined,
  promotionEligible: mode === 'final' ? pass : undefined,
  promotionScope: mode === 'final' && pass ? 'paper-baseline-proposal-only' : 'none',
  realMoneyAllowed: false,
  checks,
  rule: rules.decision,
  antiRescueRule: m.antiRescueRule,
};
fs.mkdirSync(outPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
