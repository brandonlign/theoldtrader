#!/usr/bin/env node

import crypto from 'node:crypto';
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

function gitBlobSha1(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const key of ['manifest', 'universe', 'data', 'out']) {
    if (!out[key]) throw new Error(`Missing --${key}`);
  }
  if (out.mode && out.mode !== 'development') throw new Error('Trial 14 adapter is development-only; final holdout remains sealed');
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite Trial 14 result: ${args.out}`);

  const manifest = readJson(args.manifest);
  const universe = readJson(args.universe);
  const dataset = readGzipJson(args.data);
  if (manifest.experimentId !== 'cross-sectional-identity-clean-v1' || manifest.trialNumber !== 14) throw new Error('Wrong Trial 14 manifest');
  if (manifest.status !== 'FROZEN_PRE_DEVELOPMENT') throw new Error('Trial 14 is not frozen pre-development');
  if (universe.experimentId !== manifest.experimentId || universe.trialNumber !== 14) throw new Error('Wrong Trial 14 universe');
  if (universe.status !== 'UNIVERSE_FROZEN_PRE_DEVELOPMENT' || universe.postFormationTrial14DataInspected !== false) throw new Error('Trial 14 universe firewall invalid');
  if (JSON.stringify(universe.membership) !== JSON.stringify(manifest.frozenMembership)) throw new Error('Trial 14 frozen membership mismatch');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Trial 14 dataset membership mismatch');
  if (dataset.experimentId !== manifest.experimentId || dataset.trialNumber !== 14) throw new Error('Trial 14 dataset identity mismatch');
  if (dataset.endExclusive !== '2026-01-01T00:00:00Z') throw new Error('Trial 14 development dataset crossed final boundary');
  if (universe.membership.includes('LUNAUSDT') || !universe.membership.includes('EOSUSDT')) throw new Error('Trial 14 identity repair missing');

  const baseManifestPath = manifest.baseSpecification.path;
  const sourceUniversePath = manifest.sourceUniverse.path;
  const baseManifestRaw = fs.readFileSync(baseManifestPath);
  const sourceUniverseRaw = fs.readFileSync(sourceUniversePath);
  if (gitBlobSha1(baseManifestRaw) !== manifest.baseSpecification.gitBlobSha) throw new Error('Frozen Trial 3 base manifest blob changed');
  if (gitBlobSha1(sourceUniverseRaw) !== manifest.sourceUniverse.gitBlobSha) throw new Error('Frozen Trial 3 source-universe blob changed');

  const sourceUniverse = JSON.parse(sourceUniverseRaw.toString('utf8'));
  const exclusions = new Set(manifest.identityStabilityRule.frozenIdentityExceptions.filter((row) => row.exclude).map((row) => row.symbol));
  const derivedRanking = sourceUniverse.eligibleRanking.filter((row) => !exclusions.has(row.symbol)).slice(0, 30);
  if (JSON.stringify(derivedRanking.map((row) => row.symbol)) !== JSON.stringify(universe.membership)) {
    throw new Error('Trial 14 membership no longer derives mechanically from frozen source ranking');
  }

  const finalBoundary = Date.parse('2026-01-01T00:00:00Z') / 1000;
  for (const [symbol, rows] of Object.entries(dataset.products ?? {})) {
    if (!universe.membership.includes(symbol)) throw new Error(`Out-of-universe Trial 14 product: ${symbol}`);
    if (rows.some((row) => Number(row.time) >= finalBoundary)) throw new Error(`Forbidden final-holdout row for ${symbol}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-trial14-eval-'));
  try {
    const coreUniversePath = path.join(tmp, 'core-universe.json');
    const coreDataPath = path.join(tmp, 'core-data.json.gz');
    const coreOutPath = path.join(tmp, 'core-summary.json');

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
      '--mode', 'development',
      '--manifest', baseManifestPath,
      '--universe', coreUniversePath,
      '--data', coreDataPath,
      '--out', coreOutPath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (run.status !== 0) {
      throw new Error(`Frozen Trial 3 core evaluator failed for Trial 14 adapter:\n${run.stdout}\n${run.stderr}`);
    }

    const core = readJson(coreOutPath);
    if (core.mode !== 'development' || core.endExclusive !== '2026-01-01T00:00:00Z') throw new Error('Core evaluator returned unexpected Trial 14 development boundary');
    const folds = core.developmentFolds ?? [];
    const gate = manifest.developmentPolicy.finalAccessGateFrozenBeforeDevelopment;
    const checks = {
      candidateNetReturnGreaterThanCash: Number(core.candidate.netReturn) > Number(core.comparators.cash.netReturn),
      medianDevelopmentFoldSharpeStrictlyPositive: Number(core.developmentFoldSummary?.medianSharpe) > 0,
      positiveReturnFoldsStrictMajority: Number(core.developmentFoldSummary?.positiveReturnFolds) > Number(core.developmentFoldSummary?.totalFolds) / 2,
      noDataIntegrityException: true
    };
    const finalAccessEligible = gate.allRequired === true && Object.values(checks).every(Boolean);

    const result = {
      ...core,
      experimentId: manifest.experimentId,
      trialNumber: 14,
      identityCleanSuccessorOf: 'cross-sectional-v1',
      projectWideAlphaTrialNumber: 14,
      sourceUniverseGitBlobSha: manifest.sourceUniverse.gitBlobSha,
      baseSpecificationGitBlobSha: manifest.baseSpecification.gitBlobSha,
      identityRepair: {
        rule: manifest.identityStabilityRule.definition,
        excludedSymbols: [...exclusions].sort(),
        membershipDeltaFromTrial3: manifest.membershipDeltaFromTrial3,
        membership: universe.membership
      },
      developmentGateForFinalAccess: {
        frozenBeforeDevelopment: true,
        checks,
        pass: finalAccessEligible,
        rule: 'Failure locks Trial 14 without opening the 2026 final holdout; passing permits only a separately protected one-shot final evaluation.'
      },
      multipleTesting: manifest.multipleTesting,
      diagnosticOnlyIfIntegrityFails: false
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({
      out: args.out,
      experimentId: result.experimentId,
      trialNumber: 14,
      candidate: result.candidate,
      developmentFoldSummary: result.developmentFoldSummary,
      developmentGateForFinalAccess: result.developmentGateForFinalAccess
    }, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
