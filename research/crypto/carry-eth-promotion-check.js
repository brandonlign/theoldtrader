#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2];
const resultPath = process.argv[3];
const sourcesPath = process.argv[4];
const outPath = process.argv[5];
if (!manifestPath || !resultPath || !sourcesPath || !outPath) {
  throw new Error('usage: carry-eth-promotion-check.js <manifest> <result> <sources> <out>');
}
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite Trial 17 promotion: ${outPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-eth-v1' || manifest.trialNumber !== 17) throw new Error('Wrong Trial 17 manifest');
if (result.experimentId !== manifest.experimentId || result.trialNumber !== 17 || result.symbol !== 'ETHUSDT') throw new Error('Wrong Trial 17 result');
if (sources.experimentId !== manifest.experimentId || sources.trialNumber !== 17 || sources.symbol !== 'ETHUSDT') throw new Error('Wrong Trial 17 source manifest');

const candidate = result.strategies.fundingCarry;
const spot = result.strategies.ethSpotBuyHold15;
const coverage = sources.coverage;
const gaps = result.margin.gapStress;
const gapChecks = Object.fromEntries(Object.entries(gaps).map(([gap, row]) => [gap, {
  pass: row.breached === false && Number(row.minimumExcessMargin) >= 0,
  breached: row.breached,
  minimumExcessMargin: Number(row.minimumExcessMargin)
}]));
const checks = {
  positiveNetReturn: { pass: Number(candidate.netReturn) > 0, observed: Number(candidate.netReturn) },
  minimumSharpe: { pass: Number(candidate.sharpe) >= Number(manifest.promotionCriteria.minimumSharpe), observed: Number(candidate.sharpe), threshold: Number(manifest.promotionCriteria.minimumSharpe) },
  sharpeAboveSpotComparator: { pass: Number(candidate.sharpe) > Number(spot.sharpe), candidate: Number(candidate.sharpe), spotComparator: Number(spot.sharpe) },
  maximumDrawdown: { pass: Number(candidate.maxDrawdown) >= Number(manifest.promotionCriteria.maximumAllowedDrawdown), observed: Number(candidate.maxDrawdown), threshold: Number(manifest.promotionCriteria.maximumAllowedDrawdown) },
  noRealizedMarginBreach: { pass: result.margin.breached === false && result.margin.strategyValidWithoutHistoricalMarginBreach === true, observed: result.margin },
  allFrozenGapStressesPass: { pass: Object.values(gapChecks).every((row) => row.pass), gaps: gapChecks },
  exactSourceUnion: {
    pass: Number(coverage.synchronizedRows) === Number(coverage.expectedBoundaryRows)
      && Number(coverage.overlapMismatchCount) === 0
      && Number(coverage.missingSpotRows) === 0
      && Number(coverage.missingPerpRows) === 0
      && Number(coverage.missingMarkRows) === 0,
    coverage
  }
};
const promotionEligible = Object.values(checks).every((row) => row.pass === true);
const payload = {
  experimentId: manifest.experimentId,
  trialNumber: 17,
  generatedAt: new Date().toISOString(),
  promotionEligible,
  promotionScope: promotionEligible ? 'paper_baseline' : 'none',
  realMoneyAllowed: false,
  checks,
  rule: manifest.promotionCriteria.interpretation,
  antiRescueRule: manifest.antiRescueRule
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(payload, null, 2));
