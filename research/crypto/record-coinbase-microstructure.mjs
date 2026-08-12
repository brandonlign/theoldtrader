import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const WS_URL = 'wss://advanced-trade-ws.coinbase.com';
const ALLOWED_PRODUCTS = new Set(['BTC-USD', 'ETH-USD', 'SOL-USD']);

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function safeInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const durationMinutes = safeInt(arg('duration-minutes', '60'), 60);
const product = String(arg('product', '')).trim();
if (!ALLOWED_PRODUCTS.has(product)) {
  throw new Error(`--product must be one of ${[...ALLOWED_PRODUCTS].join(', ')}`);
}
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d+Z$/, 'Z');
const outputPath = path.resolve(arg(
  'output',
  `research/crypto/data-cache/coinbase-microstructure-${product}-${stamp}.ndjson.gz`
));

if (typeof WebSocket !== 'function') {
  throw new Error('This recorder requires a Node runtime with the standards-based WebSocket global (Node 22+ recommended).');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const file = fs.createWriteStream(outputPath, { flags: 'wx' });
const gzip = zlib.createGzip({ level: 6 });
gzip.pipe(file);

const startedAt = Date.now();
const stopAt = startedAt + durationMinutes * 60_000;
let stopped = false;
let connectionCounter = 0;
let ws = null;
let reconnectTimer = null;
let reconnectDelayMs = 1_000;
let messageCount = 0;
let parseErrors = 0;
let reconnects = 0;

function writeRecord(record) {
  if (stopped && record.kind !== 'recorder_stop') return;
  gzip.write(`${JSON.stringify(record)}\n`);
}

function payloadText(data) {
  if (typeof data === 'string') return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data).toString('utf8'));
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
  }
  if (data && typeof data.text === 'function') return data.text();
  return Promise.resolve(String(data));
}

function subscribe(socket) {
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'level2', product_ids: [product] }));
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'market_trades', product_ids: [product] }));
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }));
}

function scheduleReconnect(reason) {
  if (stopped || Date.now() >= stopAt) return;
  reconnects += 1;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(30_000, reconnectDelayMs * 2);
  writeRecord({
    kind: 'reconnect_scheduled',
    received_at: new Date().toISOString(),
    product,
    delay_ms: delay,
    reason
  });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay);
}

function connect() {
  if (stopped || Date.now() >= stopAt) return finish('duration_complete');
  const connectionId = ++connectionCounter;
  const socket = new WebSocket(WS_URL);
  ws = socket;

  socket.addEventListener('open', () => {
    reconnectDelayMs = 1_000;
    writeRecord({
      kind: 'connection_open',
      received_at: new Date().toISOString(),
      connection_id: connectionId,
      product
    });
    subscribe(socket);
  });

  socket.addEventListener('message', async (event) => {
    const receivedAt = new Date().toISOString();
    try {
      const text = await payloadText(event.data);
      const payload = JSON.parse(text);
      messageCount += 1;
      writeRecord({
        kind: 'coinbase_message',
        received_at: receivedAt,
        connection_id: connectionId,
        product,
        payload
      });
    } catch (error) {
      parseErrors += 1;
      writeRecord({
        kind: 'parse_error',
        received_at: receivedAt,
        connection_id: connectionId,
        product,
        error: String(error?.message ?? error)
      });
    }
  });

  socket.addEventListener('error', () => {
    writeRecord({
      kind: 'connection_error',
      received_at: new Date().toISOString(),
      connection_id: connectionId,
      product
    });
  });

  socket.addEventListener('close', (event) => {
    writeRecord({
      kind: 'connection_close',
      received_at: new Date().toISOString(),
      connection_id: connectionId,
      product,
      code: event.code,
      reason: event.reason || ''
    });
    if (ws === socket) ws = null;
    scheduleReconnect(`close-${event.code}`);
  });
}

let finishing = false;
function finish(reason) {
  if (finishing) return;
  finishing = true;
  stopped = true;
  clearTimeout(reconnectTimer);
  if (ws && ws.readyState < 2) {
    try { ws.close(1000, 'research-recorder-complete'); } catch { /* no-op */ }
  }
  writeRecord({
    kind: 'recorder_stop',
    received_at: new Date().toISOString(),
    reason,
    started_at: new Date(startedAt).toISOString(),
    duration_minutes_requested: durationMinutes,
    product,
    message_count: messageCount,
    parse_errors: parseErrors,
    reconnects
  });
  gzip.end();
}

file.on('close', () => {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(outputPath);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => {
    const digest = hash.digest('hex');
    fs.writeFileSync(`${outputPath}.sha256`, `${digest}  ${path.basename(outputPath)}\n`);
    console.log(JSON.stringify({
      product,
      output: outputPath,
      sha256: digest,
      messageCount,
      parseErrors,
      reconnects,
      startedAt: new Date(startedAt).toISOString(),
      stoppedAt: new Date().toISOString()
    }, null, 2));
  });
});

process.on('SIGINT', () => finish('sigint'));
process.on('SIGTERM', () => finish('sigterm'));
setTimeout(() => finish('duration_complete'), Math.max(1, stopAt - Date.now()));

writeRecord({
  kind: 'recorder_start',
  received_at: new Date().toISOString(),
  websocket_url: WS_URL,
  product,
  duration_minutes_requested: durationMinutes,
  paper_only: true,
  authenticated: false
});
connect();
