import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const manifestPath = path.join(here, 'manifests', 'coinbase-maker-execution-v1.json');
const recorderPath = path.join(here, 'record-coinbase-microstructure.mjs');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const mode = arg('mode', 'pilot');
if (!['pilot', 'scientific'].includes(mode)) {
  throw new Error('Usage: node research/crypto/run-coinbase-maker-e1.mjs --mode=pilot|scientific');
}

const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.experimentId !== 'coinbase-maker-execution-v1'
  || manifest.paperOnly !== true
  || manifest.livePromotionAllowed !== false
  || manifest.strategyTrial !== false) {
  throw new Error('E1 manifest is not the expected frozen paper-only execution experiment');
}

const products = [...manifest.venue.products];
if (products.join(',') !== 'BTC-USD,ETH-USD,SOL-USD') {
  throw new Error(`Unexpected frozen E1 product set: ${products.join(',')}`);
}

const durationMinutes = mode === 'scientific'
  ? manifest.recording.minimumScientificHours * 60
  : manifest.recording.engineeringPilotMinutes;
if (!(durationMinutes > 0)) throw new Error('Frozen E1 duration is invalid');

const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d+Z$/, 'Z');
const runId = `coinbase-maker-e1-${mode}-${stamp}`;
const runDir = path.join(here, 'data-cache', runId);
fs.mkdirSync(runDir, { recursive: false });

const recordings = Object.fromEntries(products.map((product) => [
  product,
  path.join(runDir, `${product}.ndjson.gz`)
]));
const runManifestPath = path.join(runDir, 'run-manifest.json');
const runManifest = {
  experimentId: manifest.experimentId,
  runId,
  mode,
  paperOnly: true,
  startedAt: new Date().toISOString(),
  requestedDurationMinutes: durationMinutes,
  minimumScientificHours: manifest.recording.minimumScientificHours,
  frozenManifest: {
    path: path.relative(root, manifestPath),
    sha256: crypto.createHash('sha256').update(manifestBytes).digest('hex')
  },
  products,
  recordings: Object.fromEntries(Object.entries(recordings).map(([product, file]) => [product, path.relative(root, file)])),
  status: 'RECORDING',
  childResults: null
};
fs.writeFileSync(runManifestPath, `${JSON.stringify(runManifest, null, 2)}\n`, { flag: 'wx' });

console.log(JSON.stringify({
  status: 'STARTING',
  runId,
  mode,
  durationMinutes,
  runManifest: path.relative(root, runManifestPath),
  recordings: runManifest.recordings
}, null, 2));

const children = new Map();
let stopping = false;
for (const product of products) {
  const child = spawn(process.execPath, [
    recorderPath,
    `--product=${product}`,
    `--duration-minutes=${durationMinutes}`,
    `--output=${recordings[product]}`
  ], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit']
  });
  children.set(product, child);
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const childResults = await Promise.all([...children.entries()].map(([product, child]) => new Promise((resolve) => {
  child.on('exit', (code, signal) => resolve({ product, code, signal }));
})));
const failed = childResults.filter((row) => row.code !== 0);
const completed = {
  ...runManifest,
  stoppedAt: new Date().toISOString(),
  status: failed.length ? 'FAILED' : 'COMPLETE',
  childResults
};
fs.writeFileSync(runManifestPath, `${JSON.stringify(completed, null, 2)}\n`);

console.log(JSON.stringify({
  status: completed.status,
  runId,
  runManifest: path.relative(root, runManifestPath),
  nextCommand: `node research/crypto/evaluate-coinbase-maker-e1-run.mjs ${path.relative(root, runManifestPath)}`,
  childResults
}, null, 2));
if (failed.length) process.exitCode = 1;
