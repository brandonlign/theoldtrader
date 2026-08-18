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
const audit = path.join(root, 'research', 'crypto', 'audit-coinbase-execution-integrity.mjs');
const manifest = path.join(root, 'research', 'crypto', 'manifests', 'coinbase-maker-execution-v1.json');
const base = Date.parse('2026-08-12T12:00:00Z');
const iso = (minutes = 0, seconds = 0) => new Date(base + minutes * 60_000 + seconds * 1000).toISOString();

function level(side, price, quantity, minute) {
  return { side, price_level: String(price), new_quantity: String(quantity), event_time: iso(minute) };
}
function l2(minute, sequence, updates, type = 'update') {
  return {
    kind: 'coinbase_message', received_at: iso(minute), connection_id: 1, product: 'BTC-USD',
    payload: {
      channel: 'l2_data', timestamp: iso(minute), sequence_num: sequence,
      events: [{ type, product_id: 'BTC-USD', updates }]
    }
  };
}
function trades(minute, seconds, sequence, rows) {
  return {
    kind: 'coinbase_message', received_at: iso(minute, seconds), connection_id: 1, product: 'BTC-USD',
    payload: {
      channel: 'market_trades', timestamp: iso(minute, seconds), sequence_num: sequence,
      events: [{ type: sequence === 0 ? 'snapshot' : 'update', trades: rows }]
    }
  };
}
function baseRecords(extraTradeGap = false) {
  const records = [
    { kind: 'recorder_start', received_at: iso(), product: 'BTC-USD' },
    { kind: 'connection_open', received_at: iso(), connection_id: 1, product: 'BTC-USD' },
    l2(0, 0, [
      level('bid', 99, 1, 0), level('bid', 98, 20, 0),
      level('offer', 101, 1, 0), level('offer', 102, 20, 0)
    ], 'snapshot'),
    l2(15, 1, [level('bid', 99, 1, 15), level('offer', 101, 1, 15)]),
    trades(15, 30, 0, [
      { trade_id: 'buy-maker', product_id: 'BTC-USD', price: '99', size: '7', side: 'BUY', time: iso(15, 30) },
      { trade_id: 'sell-maker', product_id: 'BTC-USD', price: '101', size: '20', side: 'SELL', time: iso(15, 30) }
    ])
  ];
  if (extraTradeGap) {
    records.push(trades(16, 0, 2, [
      { trade_id: 'gap', product_id: 'BTC-USD', price: '101', size: '0.1', side: 'SELL', time: iso(16, 0) }
    ]));
  }
  records.push(
    l2(17, 2, [level('bid', 99, 1, 17), level('offer', 101, 1, 17)]),
    l2(21, 3, [level('bid', 99, 1, 21), level('offer', 101, 1, 21)]),
    l2(31, 4, [
      level('bid', 99, 0, 31), level('offer', 101, 0, 31),
      level('bid', 100, 1, 31), level('offer', 102, 1, 31)
    ]),
    l2(76, 5, [
      level('bid', 100, 0, 76), level('offer', 102, 0, 76),
      level('bid', 101, 1, 76), level('offer', 103, 1, 76)
    ]),
    { kind: 'recorder_stop', received_at: iso(76, 1), product: 'BTC-USD' }
  );
  return records;
}

function run(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theoldtrader-exec-audit-'));
  const rawPath = path.join(dir, 'recording.ndjson.gz');
  const raw = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const compressed = zlib.gzipSync(raw);
  fs.writeFileSync(rawPath, compressed);
  const sha = crypto.createHash('sha256').update(compressed).digest('hex');
  fs.writeFileSync(`${rawPath}.sha256`, `${sha}  ${path.basename(rawPath)}\n`);

  const analyzed = spawnSync(process.execPath, [analyzer, rawPath, manifest], { cwd: root, encoding: 'utf8' });
  assert.equal(analyzed.status, 0, analyzed.stderr || analyzed.stdout);
  const ordersPath = rawPath.replace(/\.ndjson\.gz$/, '-maker-orders.csv');
  assert.ok(fs.existsSync(ordersPath));

  const audited = spawnSync(process.execPath, [audit, rawPath, ordersPath, manifest], { cwd: root, encoding: 'utf8' });
  assert.equal(audited.status, 0, audited.stderr || audited.stdout);
  return {
    maker: JSON.parse(analyzed.stdout),
    audit: JSON.parse(audited.stdout),
    fullBookCsv: fs.readFileSync(rawPath.replace(/\.ndjson\.gz$/, '-full-book-taker.csv'), 'utf8')
  };
}

test('independent audit uses full-book taker VWAP rather than best quote only', () => {
  const result = run(baseRecords(false));
  assert.equal(result.audit.raw.rawHashVerified, true);
  assert.equal(result.audit.product, 'BTC-USD');
  assert.equal(result.audit.integrity.l2SequenceGaps, 0);
  assert.equal(result.audit.integrity.marketTradeSequenceGaps, 0);
  assert.equal(result.audit.integrity.unmatchedPlacementOrders, 0);
  assert.equal(result.audit.fullBookTakerComparator.takerDepthAvailabilityRate, 1);
  assert.ok(result.audit.fullBookTakerComparator.filledOrdersWithFullBookComparator >= 3);
  assert.ok(Number.isFinite(result.audit.fullBookTakerComparator.meanTakerCostVsArrivalMidBpsConditionalOnMakerFill));
  assert.ok(Number.isFinite(result.audit.fullBookTakerComparator.meanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps));
  assert.match(result.fullBookCsv, /,2,/); // at least one immediate taker uses multiple price levels
  assert.equal(result.audit.integrity.scientificIntegrityPass, false); // short synthetic run remains engineering-only
});

test('independent audit rejects a dropped market_trades message', () => {
  const result = run(baseRecords(true));
  assert.equal(result.audit.integrity.marketTradeSequenceGaps, 1);
  assert.equal(result.audit.integrity.scientificIntegrityPass, false);
});
