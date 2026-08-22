#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2];
const summaryPath = process.argv[3];
const sourcesPath = process.argv[4];
const outPath = process.argv[5];
if (!manifestPath || !summaryPath || !sourcesPath || !outPath) {
  throw new Error('usage: carry-collateralized-promotion-check.js <manifest> <summary> <sources> <out>');
}
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite ${outPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-collateralized-v1' || manifest.trialNumber !== 16) throw new Error('Wrong Trial 16 manifest');
if (summary.experimentId !== manifest.experimentId || summary.trialNumber !== 16) throw new Error('Wrong Trial 16 summary');
if (sources.experimentId !== manifest.experimentId || sources.trialNumber !== 16 || sources.economicResultCalculated !== false) throw new Error('Wrong or contaminated Trial 16 source evidence');

const carry = summary.strategies?.fundingCarry;
if (!carry) throw new Error('Trial 16 carry metrics absent');
const coverage = sources.coverage ?? {};
const gapStress = summary.margin?.gapStress ?? {};
const frozenGaps = manifest.marginStress.additionalGapStressPct.map(String);
const gapChecks = Object.fromEntries(frozenGaps.map((gap) => [gap, {
  pass: gapStress[gap]?.breached === false,
  breached: gapStress[gap]?.breached,
  minimumExcessMargin: gapStress[gap]?.minimumExcessMargin
}]));

const checks = {
  positiveNetReturn: {pass: Number(carry.netReturn) > 0, observed: Number(carry.netReturn)},
  minimumSharpe: {pass: Number(carry.sharpe) >= Number(manifest.promotionCriteria.minimumSharpe), observed: Number(carry.sharpe), threshold: Number(manifest.promotionCriteria.minimumSharpe)},
  maximumDrawdown: {pass: Number(carry.maxDrawdown) >= Number(manifest.promotionCriteria.maximumAllowedDrawdown), observed: Number(carry.maxDrawdown), threshold: Number(manifest.promotionCriteria.maximumAllowedDrawdown)},
  noRealizedMarginBreach: {pass: summary.margin?.breached === false && summary.margin?.strategyValidWithoutHistoricalMarginBreach === true, observed: summary.margin},
  allFrozenGapStressesPass: {pass: Object.values(gapChecks).every((check) => check.pass), gaps: gapChecks},
  exactSourceUnion: {
    pass: Number(coverage.expectedBoundaryRows) === Number(coverage.synchronizedRows)
      && Number(coverage.overlapMismatchCount) === 0
      && Number(coverage.missingSpotRows) === 0
      && Number(coverage.missingPerpRows) === 0
      && Number(coverage.missingMarkRows) === 0,
    coverage
  }
};
const promotionEligible = Object.values(checks).every((check) => check.pass === true);
const result = {
  experimentId: manifest.experimentId,
  trialNumber: manifest.trialNumber,
  generatedAt: new Date().toISOString(),
  promotionEligible,
  promotionScope: promotionEligible ? 'paper_baseline_only' : 'none',
  realMoneyAllowed: false,
  checks,
  rule: manifest.promotionCriteria.interpretation,
  antiRescueRule: manifest.antiRescueRule
};
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx'});
console.log(JSON.stringify(result, null, 2));
