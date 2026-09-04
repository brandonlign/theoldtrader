import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';

const rawPath = process.argv[2];
const ordersPath = process.argv[3];
const manifestPath = process.argv[4] ?? 'research/crypto/manifests/coinbase-maker-execution-v1.json';
if (!rawPath || !ordersPath) {
  throw new Error('Usage: node audit-coinbase-execution-integrity.mjs <recording.ndjson.gz> <maker-orders.csv> [manifest.json]');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'coinbase-maker-execution-v1' || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error('Unexpected execution manifest');
}
const allowedProducts = new Set(manifest.venue.products);
const takerFee = manifest.costComparison.takerFeeBpsPerSide / 10_000;

function finite(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}
function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function readOrders(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = ['id', 'product', 'side', 'notionalUsd', 'placedAt', 'arrivalMid', 'sizeBase', 'status', 'effectiveCostVsArrivalMidBps'];
  for (const column of required) if (!(column in index)) throw new Error(`Orders CSV missing ${column}`);
  return lines.slice(1).filter(Boolean).map((line) => {
    const row = parseCsvLine(line);
    return {
      id: Number(row[index.id]),
      product: row[index.product],
      side: row[index.side],
      notionalUsd: Number(row[index.notionalUsd]),
      placedAt: Date.parse(row[index.placedAt]),
      arrivalMid: Number(row[index.arrivalMid]),
      sizeBase: Number(row[index.sizeBase]),
      status: row[index.status],
      makerCostVsArrivalMidBps: Number(row[index.effectiveCostVsArrivalMidBps]),
      matchedBookAtPlacement: false,
      takerDepthSufficient: false,
      takerVwap: null,
      takerLevelsUsed: null,
      takerCostVsArrivalMidBps: null,
      priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: null
    };
  });
}

function makeBook() {
  return { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ready: false };
}
function recomputeBest(levels, side) {
  let best = null;
  for (const price of levels.keys()) {
    if (best === null || (side === 'bid' ? price > best : price < best)) best = price;
  }
  return best;
}
function applyLevel(book, update) {
  const rawSide = String(update.side).toLowerCase();
  const price = finite(update.price_level);
  const quantity = finite(update.new_quantity);
  if (!(price > 0) || !(quantity >= 0) || !['bid', 'offer', 'ask'].includes(rawSide)) return;
  const isBid = rawSide === 'bid';
  const levels = isBid ? book.bids : book.asks;
  const currentBest = isBid ? book.bestBid : book.bestAsk;
  if (quantity === 0) levels.delete(price);
  else levels.set(price, quantity);
  let best = currentBest;
  if (quantity > 0 && (best === null || (isBid ? price > best : price < best))) best = price;
  if (quantity === 0 && currentBest === price) best = recomputeBest(levels, isBid ? 'bid' : 'ask');
  if (isBid) book.bestBid = best;
  else book.bestAsk = best;
}
function marketableVwap(book, side, baseQuantity) {
  if (!book?.ready || !(baseQuantity > 0)) return null;
  const levels = side === 'BUY' ? book.asks : book.bids;
  const ordered = [...levels.entries()]
    .filter(([price, quantity]) => price > 0 && quantity > 0)
    .sort(([a], [b]) => side === 'BUY' ? a - b : b - a);
  let remaining = baseQuantity;
  let notional = 0;
  let levelsUsed = 0;
  for (const [price, quantity] of ordered) {
    if (remaining <= 1e-12) break;
    const take = Math.min(remaining, quantity);
    if (!(take > 0)) continue;
    notional += take * price;
    remaining -= take;
    levelsUsed += 1;
  }
  if (remaining > Math.max(1e-12, baseQuantity * 1e-9)) return null;
  return { vwap: notional / baseQuantity, levelsUsed };
}

const orders = readOrders(ordersPath);
const placements = new Map();
for (const order of orders) {
  if (!Number.isFinite(order.placedAt)) throw new Error(`Invalid placement timestamp for order ${order.id}`);
  const key = `${order.product}:${order.placedAt}`;
  if (!placements.has(key)) placements.set(key, []);
  placements.get(key).push(order);
}

const books = new Map([...allowedProducts].map((product) => [product, makeBook()]));
const sequenceByChannelProduct = new Map();
let product = null;
let firstReceived = null;
let lastReceived = null;
let disconnectedSince = null;
let connectionOpen = false;
let totalDisconnectMs = 0;
let maxDisconnectMs = 0;
let parseErrors = 0;
let productMismatchMessages = 0;
let l2SequenceGaps = 0;
let marketTradeSequenceGaps = 0;
let outOfOrderL2 = 0;
let outOfOrderMarketTrades = 0;

function sequenceCheck(record, payload, productId, channel) {
  const sequence = finite(payload.sequence_num, null);
  if (!Number.isFinite(sequence)) return 'OK';
  const key = `${record.connection_id ?? 'x'}:${channel}:${productId}`;
  const previous = sequenceByChannelProduct.get(key);
  if (!Number.isFinite(previous)) {
    sequenceByChannelProduct.set(key, sequence);
    return 'OK';
  }
  if (sequence < previous) {
    if (channel === 'l2_data') outOfOrderL2 += 1;
    else if (channel === 'market_trades') outOfOrderMarketTrades += 1;
    return 'STALE';
  }
  if (sequence > previous + 1) {
    if (channel === 'l2_data') l2SequenceGaps += 1;
    else if (channel === 'market_trades') marketTradeSequenceGaps += 1;
    sequenceByChannelProduct.set(key, sequence);
    return 'GAP';
  }
  if (sequence > previous) sequenceByChannelProduct.set(key, sequence);
  return 'OK';
}

function enrichPlacements(productId, timeMs) {
  const pending = placements.get(`${productId}:${timeMs}`);
  if (!pending?.length) return;
  const book = books.get(productId);
  for (const order of pending) {
    if (order.matchedBookAtPlacement) continue;
    order.matchedBookAtPlacement = true;
    const taker = marketableVwap(book, order.side, order.sizeBase);
    if (!taker) continue;
    order.takerDepthSufficient = true;
    order.takerVwap = taker.vwap;
    order.takerLevelsUsed = taker.levelsUsed;
    const direction = order.side === 'BUY' ? 1 : -1;
    const netTakerPrice = order.side === 'BUY' ? taker.vwap * (1 + takerFee) : taker.vwap * (1 - takerFee);
    order.takerCostVsArrivalMidBps = direction * (netTakerPrice / order.arrivalMid - 1) * 10_000;
    if (order.status === 'FILLED' && Number.isFinite(order.makerCostVsArrivalMidBps)) {
      order.priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps = order.takerCostVsArrivalMidBps - order.makerCostVsArrivalMidBps;
    }
  }
}

const rawHash = crypto.createHash('sha256');
const rawStream = fs.createReadStream(rawPath);
rawStream.on('data', (chunk) => rawHash.update(chunk));
const input = rawStream.pipe(zlib.createGunzip());
const rl = readline.createInterface({ input, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    parseErrors += 1;
    continue;
  }
  const received = Date.parse(record.received_at);
  if (Number.isFinite(received)) {
    if (firstReceived === null) firstReceived = received;
    lastReceived = received;
  }
  if (record.kind === 'recorder_start' && Number.isFinite(received)) {
    if (disconnectedSince === null && !connectionOpen) disconnectedSince = received;
    if (record.product) {
      if (product === null) product = String(record.product);
      else if (product !== String(record.product)) {
        productMismatchMessages += 1;
        parseErrors += 1;
      }
    }
  }
  if (record.kind === 'parse_error') parseErrors += 1;
  if (record.kind === 'connection_close' && Number.isFinite(received)) {
    if (connectionOpen) {
      disconnectedSince = received;
      connectionOpen = false;
    }
    const book = books.get(product);
    if (book) book.ready = false;
  }
  if (record.kind === 'connection_open' && Number.isFinite(received)) {
    if (disconnectedSince !== null) {
      const gap = Math.max(0, received - disconnectedSince);
      totalDisconnectMs += gap;
      maxDisconnectMs = Math.max(maxDisconnectMs, gap);
      disconnectedSince = null;
    }
    connectionOpen = true;
  }
  if (record.kind === 'recorder_stop' && disconnectedSince !== null && Number.isFinite(received)) {
    const gap = Math.max(0, received - disconnectedSince);
    totalDisconnectMs += gap;
    maxDisconnectMs = Math.max(maxDisconnectMs, gap);
    disconnectedSince = null;
  }
  if (record.kind !== 'coinbase_message' || !record.payload) continue;

  const payload = record.payload;
  const eventMs = Number.isFinite(Date.parse(payload.timestamp)) ? Date.parse(payload.timestamp) : received;
  if (payload.channel === 'l2_data') {
    for (const event of payload.events ?? []) {
      const productId = event.product_id;
      if (!allowedProducts.has(productId)) continue;
      if (product !== null && productId !== product) {
        productMismatchMessages += 1;
        parseErrors += 1;
        continue;
      }
      const state = sequenceCheck(record, payload, productId, 'l2_data');
      if (state === 'STALE') continue;
      const book = books.get(productId);
      if (state === 'GAP') book.ready = false;
      if (event.type === 'snapshot') {
        book.bids.clear();
        book.asks.clear();
        book.bestBid = null;
        book.bestAsk = null;
        book.ready = false;
      }
      for (const update of event.updates ?? []) applyLevel(book, update);
      if (event.type === 'snapshot') book.ready = true;
      if (book.ready) enrichPlacements(productId, eventMs);
    }
  } else if (payload.channel === 'market_trades') {
    const productIds = new Set();
    for (const event of payload.events ?? []) for (const trade of event.trades ?? []) if (trade.product_id) productIds.add(trade.product_id);
    if (!productIds.size && product) productIds.add(product);
    for (const productId of productIds) {
      if (!allowedProducts.has(productId)) continue;
      if (product !== null && productId !== product) {
        productMismatchMessages += 1;
        parseErrors += 1;
        continue;
      }
      sequenceCheck(record, payload, productId, 'market_trades');
    }
  }
}

const rawSha256 = rawHash.digest('hex');
const checksumPath = `${rawPath}.sha256`;
let expectedRawSha256 = null;
let rawHashVerified = false;
if (fs.existsSync(checksumPath)) {
  const token = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(token)) {
    expectedRawSha256 = token;
    rawHashVerified = token === rawSha256;
  }
}

const wallDurationMs = Math.max(0, (lastReceived ?? 0) - (firstReceived ?? 0));
const durationHours = wallDurationMs / 3_600_000;
const connectedCoveragePct = wallDurationMs > 0 ? Math.max(0, 1 - totalDisconnectMs / wallDurationMs) : 0;
const eligible = orders.filter((order) => order.status !== 'DATA_GAP');
const matched = eligible.filter((order) => order.matchedBookAtPlacement);
const takerAvailable = eligible.filter((order) => order.takerDepthSufficient);
const filledComparable = eligible.filter((order) => order.status === 'FILLED' && Number.isFinite(order.priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps));
const unmatchedPlacementOrders = eligible.length - matched.length;
const scientificIntegrityPass = durationHours >= manifest.recording.minimumScientificHours
  && allowedProducts.has(product)
  && rawHashVerified
  && parseErrors === 0
  && productMismatchMessages === 0
  && l2SequenceGaps === 0
  && marketTradeSequenceGaps === 0
  && connectedCoveragePct >= manifest.recording.minimumConnectedCoveragePct
  && maxDisconnectMs <= manifest.recording.maximumSingleDisconnectSeconds * 1000
  && unmatchedPlacementOrders === 0;

const result = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  paperOnly: true,
  auditType: 'INDEPENDENT_FEED_INTEGRITY_AND_FULL_BOOK_TAKER',
  product,
  raw: {
    path: path.resolve(rawPath),
    rawSha256,
    checksumPath: fs.existsSync(checksumPath) ? path.resolve(checksumPath) : null,
    expectedRawSha256,
    rawHashVerified
  },
  integrity: {
    scientificIntegrityPass,
    firstReceived: firstReceived ? new Date(firstReceived).toISOString() : null,
    lastReceived: lastReceived ? new Date(lastReceived).toISOString() : null,
    durationHours,
    connectedCoveragePct,
    totalDisconnectSeconds: totalDisconnectMs / 1000,
    maxDisconnectSeconds: maxDisconnectMs / 1000,
    parseErrors,
    productMismatchMessages,
    l2SequenceGaps,
    marketTradeSequenceGaps,
    outOfOrderL2,
    outOfOrderMarketTrades,
    eligibleOrders: eligible.length,
    matchedPlacementOrders: matched.length,
    unmatchedPlacementOrders
  },
  fullBookTakerComparator: {
    takerDepthAvailableOrders: takerAvailable.length,
    takerDepthAvailabilityRate: eligible.length ? takerAvailable.length / eligible.length : null,
    filledOrdersWithFullBookComparator: filledComparable.length,
    meanTakerCostVsArrivalMidBpsConditionalOnMakerFill: mean(filledComparable.map((order) => order.takerCostVsArrivalMidBps)),
    medianTakerCostVsArrivalMidBpsConditionalOnMakerFill: median(filledComparable.map((order) => order.takerCostVsArrivalMidBps)),
    meanPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: mean(filledComparable.map((order) => order.priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps)),
    medianPriceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps: median(filledComparable.map((order) => order.priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps)),
    note: 'The taker comparator executes the identical base quantity against the full recorded opposite-side book at maker-order placement. Insufficient recorded depth is reported as unavailable, never imputed. Savings are conditional on the maker order actually filling and are not a strategy-PnL claim.'
  }
};

const outBase = rawPath.replace(/\.ndjson\.gz$/, '');
const auditPath = `${outBase}-execution-integrity.json`;
fs.writeFileSync(auditPath, `${JSON.stringify(result, null, 2)}\n`);
const columns = [
  'id', 'product', 'side', 'notionalUsd', 'placedAt', 'status', 'matchedBookAtPlacement', 'takerDepthSufficient',
  'takerVwap', 'takerLevelsUsed', 'takerCostVsArrivalMidBps', 'makerCostVsArrivalMidBps',
  'priceAndFeeSavingsVsImmediateTakerConditionalOnMakerFillBps'
];
const csv = [columns.join(',')];
for (const order of orders) {
  csv.push(columns.map((column) => csvCell(column === 'placedAt' ? new Date(order.placedAt).toISOString() : order[column])).join(','));
}
fs.writeFileSync(`${outBase}-full-book-taker.csv`, `${csv.join('\n')}\n`);
console.log(JSON.stringify({ auditPath, ...result }, null, 2));
