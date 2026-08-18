#!/usr/bin/env node

import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { evaluateCtrend } from './ctrend-evaluate.js';

function parseArgs(argv) {
  const args = { mode: 'development' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  for (const required of ['manifest', 'universe', 'data', 'out']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  if (!['development', 'final'].includes(args.mode)) throw new Error('--mode must be development or final');
  if (args.mode === 'final' && args['confirm-final'] !== 'YES') {
    throw new Error('Final holdout is one-shot protected; pass --confirm-final YES explicitly');
  }
  return args;
}

function readDataset(file) {
  const raw = fs.readFileSync(file);
  const payload = file.endsWith('.gz') ? gunzipSync(raw) : raw;
  return JSON.parse(payload.toString('utf8'));
}

function assertAuthoritativeRestDataset(dataset) {
  if (dataset.experimentId !== 'ctrend-v1' || dataset.trialNumber !== 4) throw new Error('Wrong Trial 4 dataset identity');
  if (dataset.sourceType !== 'official Binance market-data-only REST /api/v3/klines') {
    throw new Error(`Non-authoritative Trial 4 data source: ${dataset.sourceType ?? 'missing'}`);
  }
  if (dataset.sourceBaseUrl !== 'https://data-api.binance.vision') {
    throw new Error(`Non-authoritative Trial 4 REST base: ${dataset.sourceBaseUrl ?? 'missing'}`);
  }
}

const args = parseArgs(process.argv);
assertAuthoritativeRestDataset(readDataset(args.data));
const result = evaluateCtrend(args);
console.log(JSON.stringify({
  out: args.out,
  mode: args.mode,
  authoritativeDataSource: 'https://data-api.binance.vision/api/v3/klines',
  firstPrediction: result.firstPrediction,
  candidate: result.candidate,
  developmentFoldSummary: result.developmentFoldSummary
}, null, 2));
