import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const analyzer = path.join(root, 'research', 'crypto', 'analyze-coinbase-maker-execution.mjs');
const manifest = path.join(root, 'research', 'crypto', 'manifests', 'coinbase-maker-execution-v1.json');
const base = Date.parse('2026-08-12T12:00:00Z');
const iso = (minutes = 0, seconds = 0) => new Date(base + minutes * 60_000 + seconds * 1000).toISOString();

function l2({ minute, sequence, updates, type = 'update', connectionId = 1 }) {
  return {
    kind: 'coinbase_message',
    received_at: iso(minute),
    connection_id: connectionId,
    product: 'BTC-USD',
    payload: {
      channel: 'l2_data',
      timestamp: iso(minute),
      sequence_num: sequence,
      events: [{ type, product_id: 'BTC-USD', updates }]
    }
  };
}
function level(side, price, quantity, minute) {
  return { side, price_level: String(price), new_quantity: String(quantity), event_time: iso(minute) };
}
function run(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymog-maker-'));
  const input = path.join(dir, 'recording.ndjson.gz');
  const raw = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const compressed = zlib.gzipSync(raw);
  fs.writeFileSync(input, compressed);
  const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  fs.writeFileSync(`${input}.sha256`, `${sha256}  ${path.basename(input)}\n`);
  const result = spawnSync(process.execPath, [analyzer, input, manifest], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    summary: JSON.parse(result.stdout),
    csv: fs.readFileSync(input.replace(/\.ndjson\.gz$/, '-maker-orders.csv'), 'utf8')
  };
}

test('maker simulator requires displayed queue consumption before fill', () => {
  const records = [
    { kind: 'recorder_start', received_at: iso(), product: 'BTC-USD' },
    { kind: 'connection_open', received_at: iso(), connection_id: 1, product: 'BTC-USD' },
    l2({ minute: 0, sequence: 0, type: 'snapshot', updates: [level('bid', 99, 1, 0), level('offer', 101, 1, 0)] }),
    l2({ minute: 15, sequence: 1, updates: [level('bid', 99, 1, 15), level('offer', 101, 1, 15)] }),
    {
      kind: 'coinbase_message', received_at: iso(15, 30), connection_id: 1, product: 'BTC-USD',
      payload: {
        channel: 'market_trades', timestamp: iso(15, 30), sequence_num: 2,
        events: [{ type: 'update', trades: [
          { trade_id: 'b', product_id: 'BTC-USD', price: '99', size: '7', side: 'BUY', time: iso(15, 30) },
          { trade_id: 's', product_id: 'BTC-USD', price: '101', size: '20', side: 'SELL', time: iso(15, 30) }
        ] }]
      }
    },
    l2({ minute: 17, sequence: 2, updates: [level('bid', 99, 1, 17), level('offer', 101, 1, 17)] }),
    l2({ minute: 21, sequence: 3, updates: [level('bid', 99, 1, 21), level('offer', 101, 1, 21)] }),
    l2({ minute: 31, sequence: 4, updates: [level('bid', 99, 0, 31), level('offer', 101, 0, 31), level('bid', 100, 1, 31), level('offer', 102, 1, 31)] }),
    l2({ minute: 76, sequence: 5, updates: [level('bid', 100, 0, 76), level('offer', 102, 0, 76), level('bid', 101, 1, 76), level('offer', 103, 1, 76)] }),
    { kind: 'recorder_stop', received_at: iso(76, 1), product: 'BTC-USD' }
  ];
  const { summary, csv } = run(records);
  assert.equal(summary.input.product, 'BTC-USD');
  assert.equal(summary.input.rawHashVerified, true);
  assert.equal(summary.groups.aggregate.filledOrders, 3);
  assert.ok(summary.groups.aggregate.orders >= 4);
  assert.match(csv, /BUY,500,[^\n]*FILLED/);
  assert.match(csv, /BUY,1500,[^\n]*EXPIRED/);
  assert.match(csv, /SELL,500,[^\n]*FILLED/);
  assert.match(csv, /SELL,1500,[^\n]*FILLED/);
  assert.equal(summary.recording.classification, 'ENGINEERING_PILOT_ONLY');
});

test('forward level2 sequence gap invalidates open hypothetical orders', () => {
  const records = [
    { kind: 'recorder_start', received_at: iso(), product: 'BTC-USD' },
    { kind: 'connection_open', received_at: iso(), connection_id: 1, product: 'BTC-USD' },
    l2({ minute: 0, sequence: 0, type: 'snapshot', updates: [level('bid', 99, 1, 0), level('offer', 101, 1, 0)] }),
    l2({ minute: 15, sequence: 1, updates: [level('bid', 99, 1, 15), level('offer', 101, 1, 15)] }),
    l2({ minute: 16, sequence: 3, updates: [level('bid', 99, 1, 16), level('offer', 101, 1, 16)] }),
    { kind: 'recorder_stop', received_at: iso(17), product: 'BTC-USD' }
  ];
  const { summary } = run(records);
  assert.equal(summary.input.rawHashVerified, true);
  assert.equal(summary.recording.l2SequenceGaps, 1);
  assert.equal(summary.groups.aggregate.eligibleOrders, 0);
  assert.equal(summary.groups.aggregate.statusCounts.DATA_GAP, 4);
});
