#!/usr/bin/env node

import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildCrossSectionalPanel } from './lib/cross-sectional.js';

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
  for (const key of ['manifest', 'universe', 'data']) if (!out[key]) throw new Error(`Missing --${key}`);
  return out;
}

function coreManifestForPanel(base) {
  return base;
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = readJson(args.manifest);
  const universe = readJson(args.universe);
  const dataset = readGzipJson(args.data);
  const base = readJson(manifest.baseSpecification.path);

  if (manifest.experimentId !== 'cross-sectional-identity-clean-v1' || manifest.trialNumber !== 14) throw new Error('Wrong Trial 14 manifest');
  if (JSON.stringify(universe.membership) !== JSON.stringify(manifest.frozenMembership)) throw new Error('Trial 14 membership mismatch');
  if (dataset.experimentId !== manifest.experimentId || dataset.trialNumber !== 14) throw new Error('Trial 14 dataset identity mismatch');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Trial 14 dataset membership mismatch');
  if (dataset.endExclusive !== '2026-01-01T00:00:00Z') throw new Error('Trial 14 development hard stop mismatch');
  if (universe.membership.includes('LUNAUSDT') || !universe.membership.includes('EOSUSDT')) throw new Error('Identity-clean membership not present');

  const boundary = Date.parse('2026-01-01T00:00:00Z') / 1000;
  for (const [symbol, rows] of Object.entries(dataset.products ?? {})) {
    if (!universe.membership.includes(symbol)) throw new Error(`Out-of-universe product ${symbol}`);
    if (rows.some((row) => Number(row.time) >= boundary)) throw new Error(`Forbidden final-holdout row for ${symbol}`);
  }

  const indexes = Object.fromEntries(Object.entries(dataset.products ?? {}).map(([symbol, rows]) => [
    symbol,
    new Set(rows.map((row) => Number(row.time)))
  ]));
  const panel = buildCrossSectionalPanel(dataset, coreManifestForPanel(base), universe.membership);
  const gapRows = [];
  for (const row of panel) {
    if (!Number.isFinite(row.target)) continue;
    const index = indexes[row.symbol];
    for (let time = row.time; time <= row.labelEnd; time += 86400) {
      if (!index.has(time)) {
        gapRows.push({ symbol: row.symbol, decisionTime: row.time, labelEnd: row.labelEnd, firstMissingTime: time });
        break;
      }
    }
  }
  if (gapRows.length) throw new Error(`Trial 14 has ${gapRows.length} gap-bridging development labels; first ${JSON.stringify(gapRows[0])}`);

  const eligible = new Map();
  for (const row of panel) eligible.set(row.time, (eligible.get(row.time) ?? 0) + 1);
  const counts = [...eligible.values()];
  if (!counts.length || Math.min(...counts) < Number(base.model.minimumEligibleAssetsPerRebalance)) {
    throw new Error('Trial 14 eligible cross-section falls below frozen minimum');
  }

  console.log(JSON.stringify({
    status: 'TRIAL14_DEVELOPMENT_DATA_INTEGRITY_PASS',
    experimentId: manifest.experimentId,
    trialNumber: 14,
    finalHoldoutRowsAcquired: 0,
    membershipSize: universe.membership.length,
    panelRows: panel.length,
    targetRows: panel.filter((row) => Number.isFinite(row.target)).length,
    gapBridgingTargetRows: 0,
    minimumEligibleAssets: Math.min(...counts),
    maximumEligibleAssets: Math.max(...counts)
  }, null, 2));
}

main();
