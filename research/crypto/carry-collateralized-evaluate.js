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

// The core evaluator also emits metadata from the original Trial 2 evaluation
// block. Reuse that already-frozen manifest as a compatibility template and
// override only the prospectively frozen Trial 16 identity/window/capitalization
// fields. This does not alter any economic calculation.
const baseManifestPath = path.join(path.dirname(manifestPath), 'funding-carry-v1.json');
const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));
if (baseManifest.experimentId !== 'funding-carry-v1' || baseManifest.trialNumber !== 2) {
  throw new Error('Frozen Trial 2 core manifest unavailable for Trial 16 compatibility');
}
const coreManifest = {
  ...baseManifest,
  experimentId: 'funding-carry-v1',
  trialNumber: 16,
  paperOnly: true,
  livePromotionAllowed: false,
  historicalRobustnessWindow: {
    ...baseManifest.historicalRobustnessWindow,
    startInclusive: manifest.confirmationWindow.startInclusive,
    endExclusive: manifest.confirmationWindow.endExclusive,
    reason: 'Trial 16 sealed confirmation window; no Trial 16 economic row was observed at freeze.'
  },
  dataRequirements: {
    ...baseManifest.dataRequirements,
    fundingTimestampNormalization: manifest.dataRequirements.fundingTimestampNormalization
  },
  candidate: manifest.candidate,
  costModel: manifest.costModel,
  marginStress: manifest.marginStress,
  evaluation: {
    ...baseManifest.evaluation,
    historicalHoldoutIntegrity: 'Trial 16 uses the separately frozen 2026-03-01 through 2026-08-01 confirmation window, which was not part of Trial 2U carry economics.',
    promotionRequires: manifest.promotionCriteria.interpretation
  },
  antiRescueRule: manifest.antiRescueRule
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
