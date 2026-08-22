#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const manifestPath = process.argv[2] ?? 'research/crypto/manifests/funding-carry-collateralized-v1.json';
const dataPath = process.argv[3];
const outPath = process.argv[4];
if (!dataPath || !outPath || process.argv[5] !== '--confirm-final' || process.argv[6] !== 'YES') {
  throw new Error('usage: carry-collateralized-evaluate.js <manifest> <data.csv> <out.json> --confirm-final YES');
}
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite Trial 16 result: ${outPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'funding-carry-collateralized-v1' || manifest.trialNumber !== 16 || manifest.status !== 'FROZEN_PRE_FINAL') {
  throw new Error('Wrong or unfrozen Trial 16 manifest');
}
if (manifest.confirmationWindow.economicRowsObservedAtFreeze !== false) throw new Error('Trial 16 final was not sealed at freeze');
if (manifest.confirmationWindow.startInclusive !== '2026-03-01T00:00:00Z' || manifest.confirmationWindow.endExclusive !== '2026-08-01T00:00:00Z') {
  throw new Error('Trial 16 confirmation boundary drift');
}
if (manifest.candidate.futuresCollateralReservePct !== 0.50) throw new Error('Trial 16 frozen collateral drift');

const coreManifest = {
  experimentId: 'funding-carry-v1',
  trialNumber: 16,
  paperOnly: true,
  livePromotionAllowed: false,
  historicalRobustnessWindow: {
    startInclusive: manifest.confirmationWindow.startInclusive,
    endExclusive: manifest.confirmationWindow.endExclusive
  },
  dataRequirements: {
    fundingTimestampNormalization: manifest.dataRequirements.fundingTimestampNormalization
  },
  candidate: manifest.candidate,
  costModel: manifest.costModel,
  marginStress: manifest.marginStress
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-trial16-'));
try {
  const transient = path.join(tmp, 'manifest.json');
  fs.writeFileSync(transient, `${JSON.stringify(coreManifest, null, 2)}\n`);
  const evaluator = path.join(path.dirname(new URL(import.meta.url).pathname), 'carry-evaluate.js');
  const run = spawnSync(process.execPath, [evaluator, transient, dataPath], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Frozen carry evaluator failed:\n${run.stdout}\n${run.stderr}`);
  const core = JSON.parse(run.stdout);
  if (core.trialNumber !== 16 || core.input?.frozenWindowStart !== manifest.confirmationWindow.startInclusive || core.input?.frozenWindowEndExclusive !== manifest.confirmationWindow.endExclusive) {
    throw new Error('Core carry evaluator returned unexpected Trial 16 identity/window');
  }
  const result = {
    ...core,
    experimentId: manifest.experimentId,
    trialNumber: 16,
    status: 'OBSERVED_FINAL_ONCE',
    selectionDisclosure: manifest.selectionDisclosure,
    developmentEvidence: manifest.developmentEvidence,
    confirmationWindow: manifest.confirmationWindow,
    paperOnly: true,
    livePromotionAllowed: false
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
