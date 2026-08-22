#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const manifestPath = process.argv[2] ?? 'research/crypto/manifests/funding-carry-eth-v1.json';
const dataPath = process.argv[3];
const outPath = process.argv[4];
if (!dataPath || !outPath || process.argv[5] !== '--confirm-evaluation' || process.argv[6] !== 'YES') {
  throw new Error('usage: carry-eth-evaluate.js <manifest> <data.csv> <out.json> --confirm-evaluation YES');
}
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite Trial 17 result: ${outPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-eth-v1' || manifest.trialNumber !== 17 || manifest.status !== 'FROZEN_PRE_EVALUATION') {
  throw new Error('Wrong or unfrozen Trial 17 manifest');
}
if (manifest.evaluationWindow.ethCarryEconomicsObservedAtFreeze !== false) throw new Error('Trial 17 ETH economics were not sealed at freeze');
if (manifest.candidate.symbol !== 'ETHUSDT' || manifest.dataRequirements.symbol !== 'ETHUSDT') throw new Error('Trial 17 symbol drift');
if (manifest.candidate.futuresCollateralReservePct !== 0.50) throw new Error('Trial 17 collateral drift');

const basePath = path.join(path.dirname(manifestPath), 'funding-carry-v1.json');
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
if (base.experimentId !== 'funding-carry-v1' || base.trialNumber !== 2) throw new Error('Frozen Trial 2 core manifest unavailable');

const coreManifest = {
  ...base,
  experimentId: 'funding-carry-v1',
  trialNumber: 17,
  paperOnly: true,
  livePromotionAllowed: false,
  historicalRobustnessWindow: {
    ...base.historicalRobustnessWindow,
    startInclusive: manifest.evaluationWindow.startInclusive,
    endExclusive: manifest.evaluationWindow.endExclusive,
    reason: 'Trial 17 pre-frozen ETH cross-asset carry replication window.'
  },
  dataRequirements: {
    ...base.dataRequirements,
    symbol: 'ETHUSDT',
    fundingTimestampNormalization: manifest.dataRequirements.fundingTimestampNormalization
  },
  candidate: manifest.candidate,
  costModel: manifest.costModel,
  marginStress: manifest.marginStress,
  evaluation: {
    ...base.evaluation,
    historicalHoldoutIntegrity: 'Trial 17 is a disclosed cross-asset ETH replication: ETH carry-specific funding/basis/perpetual economics were unobserved at freeze; unrelated ETH spot paths had been visible previously.',
    promotionRequires: manifest.promotionCriteria.interpretation
  },
  antiRescueRule: manifest.antiRescueRule
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-trial17-'));
try {
  const transient = path.join(tmp, 'manifest.json');
  fs.writeFileSync(transient, `${JSON.stringify(coreManifest, null, 2)}\n`);
  const evaluator = path.join(path.dirname(new URL(import.meta.url).pathname), 'carry-evaluate.js');
  const run = spawnSync(process.execPath, [evaluator, transient, dataPath], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Frozen carry core evaluator failed:\n${run.stdout}\n${run.stderr}`);
  const core = JSON.parse(run.stdout);
  if (core.trialNumber !== 17 || core.input?.frozenWindowStart !== manifest.evaluationWindow.startInclusive || core.input?.frozenWindowEndExclusive !== manifest.evaluationWindow.endExclusive) {
    throw new Error('Core evaluator returned unexpected Trial 17 identity/window');
  }
  const frozenPosition = { ...core.frozenPosition, ethUnits: core.frozenPosition.btcUnits };
  delete frozenPosition.btcUnits;
  const strategies = {
    fundingCarry: core.strategies.fundingCarry,
    ethSpotBuyHold15: core.strategies.btcSpotBuyHold15,
    cash: core.strategies.cash
  };
  const result = {
    ...core,
    experimentId: manifest.experimentId,
    trialNumber: 17,
    status: 'OBSERVED_EVALUATION_ONCE',
    symbol: 'ETHUSDT',
    frozenPosition,
    strategies,
    selectionDisclosure: manifest.selectionDisclosure,
    sourcePrior: manifest.sourcePrior,
    evaluationWindow: manifest.evaluationWindow,
    paperOnly: true,
    livePromotionAllowed: false
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
