#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function gitBlobSha1(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

const manifestPath = process.argv[2] ?? 'research/crypto/manifests/cross-sectional-identity-clean-v1.json';
const universePath = process.argv[3] ?? 'research/crypto/universes/cross-sectional-identity-clean-v1-universe.json';
const manifest = readJson(manifestPath);
const universe = readJson(universePath);

if (manifest.experimentId !== 'cross-sectional-identity-clean-v1' || manifest.trialNumber !== 14) throw new Error('Wrong Trial 14 manifest identity');
if (manifest.status !== 'FROZEN_PRE_DEVELOPMENT') throw new Error('Trial 14 is not frozen pre-development');
if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) throw new Error('Trial 14 safety flags invalid');
if (manifest.multipleTesting?.projectWideAlphaTrialNumber !== 14 || manifest.multipleTesting?.trials5Through13AlreadyConsumedElsewhere !== true) throw new Error('Trial 14 multiple-testing identity is not frozen');

const baseRaw = fs.readFileSync(manifest.baseSpecification.path);
const sourceRaw = fs.readFileSync(manifest.sourceUniverse.path);
if (gitBlobSha1(baseRaw) !== manifest.baseSpecification.gitBlobSha) throw new Error('Base Trial 3 manifest blob mismatch');
if (gitBlobSha1(sourceRaw) !== manifest.sourceUniverse.gitBlobSha) throw new Error('Source Trial 3 universe blob mismatch');

const source = JSON.parse(sourceRaw.toString('utf8'));
const exclusions = new Set(manifest.identityStabilityRule.frozenIdentityExceptions.filter((row) => row.exclude).map((row) => row.symbol));
if (!exclusions.has('LUNAUSDT') || exclusions.size !== 1) throw new Error('Frozen Trial 14 identity-exception registry changed');
const derived = source.eligibleRanking.filter((row) => !exclusions.has(row.symbol)).slice(0, 30);
const membership = derived.map((row) => row.symbol);
if (JSON.stringify(membership) !== JSON.stringify(manifest.frozenMembership)) throw new Error('Manifest membership does not follow frozen identity-clean ranking rule');
if (JSON.stringify(membership) !== JSON.stringify(universe.membership)) throw new Error('Universe membership differs from manifest');
if (membership.length !== 30 || new Set(membership).size !== 30) throw new Error('Trial 14 membership must be 30 unique symbols');
if (membership.includes('LUNAUSDT') || membership.at(-1) !== 'EOSUSDT') throw new Error('Trial 14 identity repair membership is not frozen as expected');
if (universe.postFormationTrial14DataInspected !== false || universe.status !== 'UNIVERSE_FROZEN_PRE_DEVELOPMENT') throw new Error('Trial 14 universe firewall invalid');
if (universe.formationSourceManifestSha256 !== manifest.sourceUniverse.formationSourceManifestSha256) throw new Error('Formation source hash mismatch');

const finalGate = manifest.developmentPolicy?.finalAccessGateFrozenBeforeDevelopment;
if (!finalGate?.allRequired || !finalGate.candidateNetReturnGreaterThanCash || !finalGate.medianDevelopmentFoldSharpeStrictlyPositive || !finalGate.positiveReturnFoldsStrictMajority || !finalGate.noDataIntegrityException) {
  throw new Error('Trial 14 final-access development gate is not completely frozen');
}
if (manifest.finalPolicy?.finalHoldoutStart !== '2026-01-01T00:00:00Z' || manifest.finalPolicy?.finalHoldoutEndExclusive !== '2026-08-01T00:00:00Z') {
  throw new Error('Trial 14 final holdout boundaries changed');
}

console.log(JSON.stringify({
  status: 'TRIAL14_PRE_DEVELOPMENT_FREEZE_VERIFIED',
  experimentId: manifest.experimentId,
  trialNumber: manifest.trialNumber,
  membership,
  removed: [...exclusions],
  added: manifest.membershipDeltaFromTrial3.added,
  baseManifestGitBlobSha: manifest.baseSpecification.gitBlobSha,
  sourceUniverseGitBlobSha: manifest.sourceUniverse.gitBlobSha,
  finalHoldoutRowsInspected: 0
}, null, 2));
