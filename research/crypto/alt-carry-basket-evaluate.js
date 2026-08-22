#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stdev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1));
}
function dailyLast(series) {
  const byDay = new Map();
  for (const point of series) byDay.set(Math.floor(point.time / 86_400_000), point);
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}
function metrics(series, startValue, fees, firstTimestamp) {
  const daily = dailyLast(series);
  let previous = startValue;
  const returns = [];
  let peak = startValue;
  let maxDrawdown = 0;
  for (const point of daily) {
    returns.push(point.equity / previous - 1);
    previous = point.equity;
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const endValue = daily.at(-1)?.equity ?? startValue;
  const elapsedDays = Math.max(1, ((daily.at(-1)?.time ?? firstTimestamp) - firstTimestamp) / 86_400_000);
  const annualizedReturn = (endValue / startValue) ** (365 / elapsedDays) - 1;
  const sd = stdev(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideSd = stdev(downside);
  return {
    netReturn: endValue / startValue - 1,
    annualizedReturn,
    sharpe: sd > 0 ? Math.sqrt(365) * mean(returns) / sd : 0,
    sortino: downsideSd > 0 ? Math.sqrt(365) * mean(returns) / downsideSd : 0,
    maxDrawdown,
    calmar: maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null,
    fees,
    feeDrag: fees / startValue,
    startValue,
    endValue,
    elapsedDays
  };
}

const args = process.argv.slice(2);
if (args.length < 5) throw new Error('usage: alt-carry-basket-evaluate.js <manifest> <development|final> <eth.csv> <sol.csv> <out.json> [--confirm-final YES]');
const [manifestPath, mode, ethPath, solPath, outPath] = args;
if (!['development', 'final'].includes(mode)) throw new Error('mode must be development or final');
if (mode === 'final' && !(args[5] === '--confirm-final' && args[6] === 'YES')) throw new Error('final requires --confirm-final YES');
if (mode === 'development' && args.includes('--confirm-final')) throw new Error('final confirmation forbidden during development');
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite ${outPath}`);

const manifest = readJson(manifestPath);
if (manifest.experimentId !== 'alt-carry-basket-v1' || manifest.trialNumber !== 17 || manifest.status !== 'FROZEN_PRE_DEVELOPMENT') throw new Error('Wrong or unfrozen Trial 17 manifest');
const window = mode === 'development' ? manifest.developmentWindow : manifest.finalHoldout;
const baseManifestPath = path.join(path.dirname(manifestPath), 'funding-carry-v1.json');
const base = readJson(baseManifestPath);
if (base.experimentId !== 'funding-carry-v1' || base.trialNumber !== 2) throw new Error('Frozen carry core manifest unavailable');

function evaluateSleeve(symbol, csvPath, tmp) {
  const transient = structuredClone(base);
  transient.trialNumber = 17;
  transient.historicalRobustnessWindow = {
    ...base.historicalRobustnessWindow,
    startInclusive: window.startInclusive,
    endExclusive: window.endExclusive,
    reason: `Trial 17 ${mode} window for ${symbol}; derivative rows were not observed at Trial 17 freeze.`
  };
  transient.dataRequirements = {
    ...base.dataRequirements,
    symbol,
    fundingTimestampNormalization: {
      ...base.dataRequirements.fundingTimestampNormalization,
      maximumAbsoluteSkewMs: manifest.dataRequirements.fundingTimestampNormalizationMaximumAbsoluteSkewMs
    }
  };
  transient.candidate = {
    ...base.candidate,
    position: `long ${symbol.replace('USDT','')} spot and short exactly equal coin units of ${symbol} perpetual`,
    spotNotionalPctAtEntry: manifest.portfolio.spotNotionalPctOfSleeveAtEntry,
    futuresCollateralReservePct: manifest.portfolio.futuresCollateralReservePctOfSleeve,
    rebalancing: manifest.portfolio.rebalancing
  };
  transient.costModel = manifest.costModel;
  transient.marginStress = manifest.marginStress;
  transient.evaluation = {
    ...base.evaluation,
    historicalHoldoutIntegrity: `Trial 17 ${mode} ${symbol} derivative/carry evidence under prospectively frozen rules.`,
    promotionRequires: mode === 'development' ? manifest.developmentGate.decision : manifest.promotionCriteria.decision
  };
  transient.antiRescueRule = manifest.antiRescueRule;
  const mf = path.join(tmp, `${symbol}.json`);
  fs.writeFileSync(mf, `${JSON.stringify(transient, null, 2)}\n`);
  const evaluator = path.join(path.dirname(new URL(import.meta.url).pathname), 'carry-evaluate.js');
  const run = spawnSync(process.execPath, [evaluator, mf, csvPath], {encoding:'utf8'});
  if (run.status !== 0) throw new Error(`${symbol} frozen carry evaluator failed:\n${run.stdout}\n${run.stderr}`);
  const result = JSON.parse(run.stdout);
  if (result.trialNumber !== 17 || result.input?.frozenWindowStart !== window.startInclusive || result.input?.frozenWindowEndExclusive !== window.endExclusive) throw new Error(`${symbol} core evaluator identity/window mismatch`);
  return result;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-trial17-'));
try {
  const eth = evaluateSleeve('ETHUSDT', ethPath, tmp);
  const sol = evaluateSleeve('SOLUSDT', solPath, tmp);
  if (eth.dailyDiagnostics.length !== sol.dailyDiagnostics.length) throw new Error('Trial 17 sleeve daily diagnostic lengths differ');
  const series = [];
  for (let i=0;i<eth.dailyDiagnostics.length;i+=1) {
    const e=eth.dailyDiagnostics[i], s=sol.dailyDiagnostics[i];
    if (e.timestamp !== s.timestamp) throw new Error(`Trial 17 sleeve date mismatch at ${i}`);
    series.push({time: Date.parse(e.timestamp), equity: 0.5 * Number(e.equity) + 0.5 * Number(s.equity)});
  }
  const firstTime = Date.parse(eth.input.firstSynchronizedTimestamp);
  const ethLast = Date.parse(eth.input.lastSynchronizedTimestamp);
  const solLast = Date.parse(sol.input.lastSynchronizedTimestamp);
  if (ethLast !== solLast) throw new Error('Trial 17 sleeve final synchronized timestamps differ');
  const endValue = 0.5 * eth.strategies.fundingCarry.endValue + 0.5 * sol.strategies.fundingCarry.endValue;
  series.push({time: ethLast + 1, equity: endValue});
  const totalFees = 0.5 * eth.strategies.fundingCarry.fees + 0.5 * sol.strategies.fundingCarry.fees;
  const basket = metrics(series, 10000, totalFees, firstTime);
  const result = {
    experimentId: manifest.experimentId,
    trialNumber: 17,
    mode,
    generatedAt: new Date().toISOString(),
    window,
    sleeveWeights: manifest.portfolio.sleeveWeights,
    basket,
    sleeves: {ETHUSDT: eth, SOLUSDT: sol},
    paperOnly: true,
    realMoneyAllowed: false,
    interpretation: 'Basket equity is the exact 50/50 linear combination of two independently evaluated frozen carry sleeves. Each core sleeve uses a 10,000-unit normalization and is scaled by 0.5, equivalent to two 5,000 starting-capital sleeves because the frozen mechanics are linear in starting capital.'
  };
  fs.mkdirSync(path.dirname(outPath), {recursive:true});
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, {flag:'wx'});
  console.log(JSON.stringify({experimentId:result.experimentId, trialNumber:17, mode, basket, sleeveNetReturns:{ETHUSDT:eth.strategies.fundingCarry.netReturn,SOLUSDT:sol.strategies.fundingCarry.netReturn}}, null, 2));
} finally {
  fs.rmSync(tmp, {recursive:true, force:true});
}
