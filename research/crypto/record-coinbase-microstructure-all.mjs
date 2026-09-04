import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PRODUCTS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const here = path.dirname(fileURLToPath(import.meta.url));
const recorder = path.join(here, 'record-coinbase-microstructure.mjs');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const duration = arg('duration-minutes', '60');
const children = new Map();
let stopping = false;

for (const product of PRODUCTS) {
  const child = spawn(process.execPath, [recorder, `--product=${product}`, `--duration-minutes=${duration}`], {
    cwd: process.cwd(),
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

const results = await Promise.all([...children.entries()].map(([product, child]) => new Promise((resolve) => {
  child.on('exit', (code, signal) => resolve({ product, code, signal }));
})));

const failed = results.filter((result) => result.code !== 0);
if (failed.length) {
  console.error(JSON.stringify({ status: 'FAILED', results }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: 'COMPLETE', results }, null, 2));
}
