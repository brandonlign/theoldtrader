#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzipJson(file) {
  return JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const key of ['manifest', 'trial14-manifest', 'universe', 'data', 'out']) {
    if (!out[key]) throw new Error(`Missing --${key}`);
  }
  if (out['confirm-final'] !== 'YES') throw new Error('Trial 15 final is one-shot protected; pass --confirm-final YES');
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite Trial 15 result: ${args.out}`);

  const manifest = readJson(args.manifest);
  const trial14 = readJson(args['trial14-manifest']);
  const universe = readJson(args.universe);
  const dataset = readGzipJson(args.data);

  if (manifest.experimentId !== 'liquidity-core-v1' || manifest.trialNumber !== 15 || manifest.status !== 'FROZEN_PRE_FINAL') {
    throw new Error('Wrong or unfrozen Trial 15 manifest');
  }
  if (trial14.experimentId !== 'cross-sectional-identity-clean-v1' || trial14.trialNumber !== 14) throw new Error('Wrong identity-clean source manifest');
  if (universe.experimentId !== trial14.experimentId || universe.trialNumber !== 14) throw new Error('Wrong identity-clean universe');
  if (dataset.experimentId !== trial14.experimentId || dataset.trialNumber !== 14) throw new Error('Wrong identity-clean final dataset');
  if (dataset.endExclusive !== manifest.finalHoldout.endExclusive) throw new Error('Trial 15 final boundary mismatch');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Trial 15 dataset membership mismatch');

  const selected = manifest.universe.selectedSymbols;
  const ranked = (universe.eligibleRanking ?? []).slice(0, manifest.universe.selectedCount).map((row) => row.symbol);
  if (JSON.stringify(selected) !== JSON.stringify(ranked)) throw new Error('Trial 15 selected symbols are not the first three frozen identity-clean liquidity ranks');
  if (JSON.stringify(selected) !== JSON.stringify(['BTCUSDT', 'ETHUSDT', 'BNBUSDT'])) throw new Error('Trial 15 frozen selected-symbol identity changed');

  const finalStart = Date.parse(manifest.finalHoldout.startInclusive) / 1000;
  const finalEnd = Date.parse(manifest.finalHoldout.endExclusive) / 1000;
  const finalRows = Object.values(dataset.products ?? {}).flat().filter((row) => Number(row.time) >= finalStart && Number(row.time) < finalEnd);
  if (!finalRows.length) throw new Error('Trial 15 final holdout has no rows');
  if (Object.values(dataset.products ?? {}).flat().some((row) => Number(row.time) >= finalEnd)) throw new Error('Trial 15 final data crossed frozen boundary');

  const sourceUniverse = readJson(trial14.sourceUniverse.path);
  const exclusions = new Set(trial14.identityStabilityRule.frozenIdentityExceptions.filter((row) => row.exclude).map((row) => row.symbol));
  const derivedRanking = sourceUniverse.eligibleRanking.filter((row) => !exclusions.has(row.symbol)).slice(0, 30);
  if (JSON.stringify(derivedRanking.map((row) => row.symbol)) !== JSON.stringify(universe.membership)) {
    throw new Error('Identity-clean universe no longer derives from frozen source ranking');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-trial15-eval-'));
  try {
    const coreUniversePath = path.join(tmp, 'core-universe.json');
    const coreDataPath = path.join(tmp, 'core-data.json.gz');
    const coreOutPath = path.join(tmp, 'core-summary.json');
    const baseManifestPath = trial14.baseSpecification.path;

    const coreUniverse = {
      eligibleRanking: derivedRanking,
      experimentId: 'cross-sectional-v1',
      formationInformationEndExclusive: sourceUniverse.formationInformationEndExclusive,
      formationSourceManifest: sourceUniverse.formationSourceManifest,
      formationSourceManifestSha256: sourceUniverse.formationSourceManifestSha256,
      formedAt: universe.formedAt,
      membership: universe.membership,
      membershipSize: 30,
      postFormationDataInspected: false,
      ruleSummary: sourceUniverse.ruleSummary,
      status: 'UNIVERSE_FORMED_PRE_DEVELOPMENT'
    };
    fs.writeFileSync(coreUniversePath, `${JSON.stringify(coreUniverse, null, 2)}\n`);

    const coreDataset = structuredClone(dataset);
    coreDataset.experimentId = 'cross-sectional-v1';
    delete coreDataset.trialNumber;
    delete coreDataset.identityCleanSuccessorOf;
    delete coreDataset.identityExcludedSymbols;
    fs.writeFileSync(coreDataPath, gzipSync(Buffer.from(`${JSON.stringify(coreDataset)}\n`, 'utf8'), { level: 9, mtime: 0 }));

    const evaluator = path.join(path.dirname(new URL(import.meta.url).pathname), 'cross-sectional-evaluate.js');
    const run = spawnSync(process.execPath, [
      evaluator,
      '--mode', 'final',
      '--confirm-final', 'YES',
      '--manifest', baseManifestPath,
      '--universe', coreUniversePath,
      '--data', coreDataPath,
      '--out', coreOutPath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (run.status !== 0) throw new Error(`Frozen core evaluator failed for Trial 15:\n${run.stdout}\n${run.stderr}`);

    const core = readJson(coreOutPath);
    if (core.mode !== 'final' || core.start !== manifest.finalHoldout.startInclusive || core.endExclusive !== manifest.finalHoldout.endExclusive) {
      throw new Error('Core evaluator returned unexpected Trial 15 holdout boundaries');
    }
    const candidate = core.comparators?.formationLiquidityTop3StaticBuyHold;
    if (!candidate) throw new Error('Frozen formation-liquidity comparator absent from core evaluator');

    const result = {
      experimentId: manifest.experimentId,
      trialNumber: manifest.trialNumber,
      mode: 'final',
      generatedAt: new Date().toISOString(),
      start: core.start,
      endExclusive: core.endExclusive,
      selectedSymbols: selected,
      selectionRule: manifest.universe.ranking,
      candidate,
      comparators: {
        cash: core.comparators.cash,
        btc15pctBuyHold: core.comparators.btc15pctBuyHold,
        btcEthSol45pctEqualWeightBuyHold: core.comparators.btcEthSol45pctEqualWeightBuyHold
      },
      sourceCoreExperiment: 'cross-sectional-v1',
      sourceIdentityCleanUniverse: trial14.experimentId,
      finalHoldoutMemberDayRows: finalRows.length,
      paperOnly: true,
      realMoneyAllowed: false
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
