import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, 'data-cache');
const prefix = 'coinbase-maker-e1-scientific-';

function safeStat(file) {
  try { return fs.statSync(file); } catch { return null; }
}

const dirs = fs.existsSync(cacheDir)
  ? fs.readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort()
  : [];

if (!dirs.length) {
  console.log(JSON.stringify({
    status: 'NOT_STARTED',
    sealedMonitoringOnly: true,
    candidateValuesExposed: false,
    experimentId: 'coinbase-maker-execution-v1'
  }, null, 2));
  process.exit(0);
}

const runDir = path.join(cacheDir, dirs.at(-1));
const manifestPath = path.join(runDir, 'run-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error('Latest E1 run directory has no run-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'coinbase-maker-execution-v1' || manifest.paperOnly !== true) {
  throw new Error('Unexpected E1 run manifest identity');
}

const startedMs = Date.parse(manifest.startedAt);
const requestedMinutes = Number(manifest.requestedDurationMinutes);
const expectedEndMs = startedMs + requestedMinutes * 60_000;
const now = Date.now();
const products = Object.fromEntries(Object.entries(manifest.recordings ?? {}).map(([product, relative]) => {
  const file = path.resolve(here, '..', '..', String(relative));
  const stat = safeStat(file);
  return [product, { bytesWritten: stat?.size ?? 0, exists: Boolean(stat) }];
}));

console.log(JSON.stringify({
  status: manifest.status,
  sealedMonitoringOnly: true,
  candidateValuesExposed: false,
  experimentId: manifest.experimentId,
  runId: manifest.runId,
  startedAt: manifest.startedAt,
  requestedDurationMinutes: requestedMinutes,
  elapsedHours: Number(((now - startedMs) / 3_600_000).toFixed(2)),
  remainingHours: Number((Math.max(0, expectedEndMs - now) / 3_600_000).toFixed(2)),
  products,
  childResultsAvailable: Array.isArray(manifest.childResults)
}, null, 2));