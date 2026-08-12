import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

const inputPath = process.argv[2];
const manifestPath = process.argv[3] ?? 'research/crypto/manifests/coinbase-maker-execution-v1.json';
if (!inputPath) throw new Error('Usage: node analyze-coinbase-maker-execution.mjs <recording.ndjson.gz> [manifest.json]');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.experimentId !== 'coinbase-maker-execution-v1' || manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error('Unexpected execution manifest');
}

const cadenceMs = manifest.hypotheticalOrders.placementCadenceMinutes * 60_000;
const ttlMs = manifest.hypotheticalOrders.timeToLiveSeconds * 1000;
const markoutOffsets = manifest.markouts.secondsAfterFill.map((seconds) => ({ seconds, ms: seconds * 1000 }));
const makerFee = manifest.costComparison.makerFeeBpsPerSide / 10_000;
const takerFee = manifest.costComparison.takerFeeBpsPerSide / 10_000;
const products = new Set(manifest.venue.products);

function finite(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
function fmtCsv(value) {
  if (value === null || value === undefined) return '';
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function makeBook() {
  return {
    bids: new Map(),
    asks: new Map(),
    bestBid: null,
    bestAsk: null,
    ready: false,
    lastPlacementBucket: null,
    lastConnectionId: null
  };
}

const books = new Map([...products].map((product) => [product, makeBook()]));
const activeByProduct = new Map([...products].map((product) => [product, new Set()]));
const pendingMarkouts = new Set();
const orders = [];
const lastL2Sequence = new Map();
let firstReceived = null;
let lastReceived = null;
let parseErrors = 0;
let reconnects = 0;
let l2SequenceGaps = 0;
let outOfOrderL2 = 0;
let dataGapOrders = 0;
let disconnectedSince = null;
let totalDisconnectMs = 0;
let maxDisconnectMs = 0;
let connectionIsOpen = false;

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

function bbo(book) {
  if (!book?.ready || !(book.bestBid > 0) || !(book.bestAsk > book.bestBid)) return null;
  return {
    bid: book.bestBid,
    ask: book.bestAsk,
    mid: (book.bestBid + book.bestAsk) / 2,
    bidQty: book.bids.get(book.bestBid) ?? 0,
    askQty: book.asks.get(book.bestAsk) ?? 0
  };
}

function closeAsDataGap(order, reason, timeMs) {
  if (order.status !== 'OPEN') return;
  order.status = 'DATA_GAP';
  order.endedAt = timeMs;
  order.dataGapReason = reason;
  activeByProduct.get(order.product)?.delete(order);
  dataGapOrders += 1;
}

function invalidateProduct(product, reason, timeMs) {
  const book = books.get(product);
  if (!book) return;
  book.ready = false;
  for (const order of [...(activeByProduct.get(product) ?? [])]) closeAsDataGap(order, reason, timeMs);
}

function invalidateAll(reason, timeMs) {
  for (const product of products) invalidateProduct(product, reason, timeMs);
}

function maybePlace(product, timeMs) {
  const book = books.get(product);
  const quote = bbo(book);
  if (!quote) return;
  const bucket = Math.floor(timeMs / cadenceMs) * cadenceMs;

  // The first valid book observation establishes cadence state only. No synthetic order is
  // retroactively placed at a bucket boundary that occurred before recording began.
  if (book.lastPlacementBucket === null) {
    book.lastPlacementBucket = bucket;
    return;
  }
  if (bucket <= book.lastPlacementBucket) return;
  book.lastPlacementBucket = bucket;

  for (const side of manifest.hypotheticalOrders.directions) {
    const limit = side === 'BUY' ? quote.bid : quote.ask;
    const queueAheadBase = side === 'BUY' ? quote.bidQty : quote.askQty;
    for (const notionalUsd of manifest.hypotheticalOrders.notionalUsd) {
      const sizeBase = notionalUsd / limit;
      const order = {
        id: orders.length + 1,
        product,
        side,
        notionalUsd,
        placedAt: timeMs,
        expiresAt: timeMs + ttlMs,
        limit,
        arrivalBid: quote.bid,
        arrivalAsk: quote.ask,
        arrivalMid: quote.mid,
        spreadBps: (quote.ask - quote.bid) / quote.mid * 10_000,
        queueAheadBase,
        queueAheadUsd: queueAheadBase * limit,
        sizeBase,
        consumedSamePriceBase: 0,
        status: 'OPEN',
        fillAt: null,
        timeToFillSeconds: null,
        markouts: {}
      };
      orders.push(order);
      activeByProduct.get(product).add(order);
    }
  }
}

function expireProduct(product, timeMs) {
  const active = activeByProduct.get(product);
  if (!active?.size) return;
  for (const order of [...active]) {
    if (order.status === 'OPEN' && timeMs > order.expiresAt) {
      order.status = 'EXPIRED';
      order.endedAt = order.expiresAt;
      active.delete(order);
    }
  }
}

function expireAll(timeMs) {
  for (const product of products) expireProduct(product, timeMs);
}

function fill(order, timeMs, reason) {
  if (order.status !== 'OPEN') return;
  order.status = 'FILLED';
  order.fillAt = timeMs;
  order.endedAt = timeMs;
  order.timeToFillSeconds = (timeMs - order.placedAt) / 1000;
  order.fillReason = reason;
  activeByProduct.get(order.product)?.delete(order);
  pendingMarkouts.add(order);
}

function processTrade(trade) {
  const product = trade.product_id;
  const timeMs = Date.parse(trade.time);
  const price = finite(trade.price);
  const size = finite(trade.size);
  const makerSide = String(trade.side).toUpperCase();
  if (!products.has(product) || !Number.isFinite(timeMs) || !(price > 0) || !(size > 0)) return;

  expireProduct(product, timeMs);
  const active = activeByProduct.get(product);
  if (!active?.size) return;
  for (const order of [...active]) {
    if (order.status !== 'OPEN' || timeMs < order.placedAt || timeMs > order.expiresAt || makerSide !== order.side) continue;
    const tradedThrough = order.side === 'BUY' ? price < order.limit : price > order.limit;
    if (tradedThrough) {
      fill(order, timeMs, 'trade_through');
      continue;
    }
    if (Math.abs(price / order.limit - 1) < 1e-10) {
      order.consumedSamePriceBase += size;
      if (order.consumedSamePriceBase + 1e-12 >= order.queueAheadBase + order.sizeBase) {
        fill(order, timeMs, 'queue_consumed');
      }
    }
  }
}

function updateMarkouts(product, timeMs) {
  const quote = bbo(books.get(product));
  if (!quote || !pendingMarkouts.size) return;
  for (const order of [...pendingMarkouts]) {
    if (order.product !== product) continue;
    for (const target of markoutOffsets) {
      if (order.markouts[target.seconds] !== undefined) continue;
      if (timeMs >= order.fillAt + target.ms) {
        const direction = order.side === 'BUY' ? 1 : -1;
        order.markouts[target.seconds] = direction * (quote.mid / order.limit - 1) * 10_000;
      }
    }
    if (markoutOffsets.every(({ seconds }) => order.markouts[seconds] !== undefined)) pendingMarkouts.delete(order);
  }
}

function sequenceState(record, payload, event) {
  const product = event.product_id;
  const sequence = finite(payload.sequence_num, null);
  if (!products.has(product) || !Number.isFinite(sequence)) return 'OK';
  const key = `${record.connection_id ?? 'x'}:${product}`;
  const previous = lastL2Sequence.get(key);
  if (!Number.isFinite(previous)) {
    lastL2Sequence.set(key, sequence);
    return 'OK';
  }
  if (sequence < previous) {
    outOfOrderL2 += 1;
    return 'STALE';
  }
  if (sequence > previous + 1) {
    l2SequenceGaps += 1;
    lastL2Sequence.set(key, sequence);
    return `GAP:${previous}:${sequence}`;
  }
  if (sequence > previous) lastL2Sequence.set(key, sequence);
  return 'OK';
}

const input = fs.createReadStream(inputPath).pipe(zlib.createGunzip());
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
  if (record.kind === 'parse_error') parseErrors += 1;
  if (record.kind === 'reconnect_scheduled') reconnects += 1;
  if (record.kind === 'connection_close' && Number.isFinite(received)) {
    if (connectionIsOpen) {
      disconnectedSince = received;
      connectionIsOpen = false;
    }
    invalidateAll(`connection-${record.connection_id ?? 'x'}-closed`, received);
  }
  if (record.kind === 'connection_open' && Number.isFinite(received)) {
    if (disconnectedSince !== null) {
      const gap = Math.max(0, received - disconnectedSince);
      totalDisconnectMs += gap;
      maxDisconnectMs = Math.max(maxDisconnectMs, gap);
      disconnectedSince = null;
    }
    connectionIsOpen = true;
    if (record.connection_id > 1) invalidateAll(`connection-${record.connection_id}-opened`, received);
  }
  if (record.kind === 'recorder_stop' && disconnectedSince !== null && Number.isFinite(received)) {
    const gap = Math.max(0, received - disconnectedSince);
    totalDisconnectMs += gap;
    maxDisconnectMs = Math.max(maxDisconnectMs, gap);
    disconnectedSince = null;
  }
  if (record.kind !== 'coinbase_message' || !record.payload) continue;

  const payload = record.payload;
  const channel = payload.channel;
  const eventMs = Number.isFinite(Date.parse(payload.timestamp)) ? Date.parse(payload.timestamp) : received;
  if (channel === 'l2_data') {
    for (const event of payload.events ?? []) {
      const product = event.product_id;
      if (!products.has(product)) continue;
      const book = books.get(product);
      const sequence = sequenceState(record, payload, event);
      if (sequence === 'STALE') continue;
      if (sequence.startsWith('GAP:')) invalidateProduct(product, `l2-sequence-${sequence.slice(4).replace(':', '-to-')}`, eventMs);

      if (event.type === 'snapshot') {
        book.bids.clear();
        book.asks.clear();
        book.bestBid = null;
        book.bestAsk = null;
        book.ready = false;
        book.lastConnectionId = record.connection_id ?? null;
      }
      for (const update of event.updates ?? []) applyLevel(book, update);
      if (event.type === 'snapshot') book.ready = true;
      maybePlace(product, eventMs);
      updateMarkouts(product, eventMs);
      expireProduct(product, eventMs);
    }
  } else if (channel === 'market_trades') {
    for (const event of payload.events ?? []) {
      for (const trade of event.trades ?? []) processTrade(trade);
    }
  }
}

if (Number.isFinite(lastReceived)) expireAll(lastReceived + ttlMs + 1);

for (const order of orders) {
  if (order.status !== 'FILLED') continue;
  const direction = order.side === 'BUY' ? 1 : -1;
  const makerNetPrice = order.side === 'BUY' ? order.limit * (1 + makerFee) : order.limit * (1 - makerFee);
  const takerPrice = order.side === 'BUY' ? order.arrivalAsk : order.arrivalBid;
  const takerNetPrice = order.side === 'BUY' ? takerPrice * (1 + takerFee) : takerPrice * (1 - takerFee);
  order.effectiveCostVsArrivalMidBps = direction * (makerNetPrice / order.arrivalMid - 1) * 10_000;
  order.immediateTakerCostVsArrivalMidBps = direction * (takerNetPrice / order.arrivalMid - 1) * 10_000;
  order.effectiveSavingsVsImmediateTakerBps = order.immediateTakerCostVsArrivalMidBps - order.effectiveCostVsArrivalMidBps;
}

function summarize(group) {
  const eligible = group.filter((order) => order.status !== 'DATA_GAP');
  const filled = eligible.filter((order) => order.status === 'FILLED');
  const markout = (seconds) => filled.map((order) => order.markouts[seconds]).filter(Number.isFinite);
  const statusCounts = {};
  for (const order of group) statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
  return {
    orders: group.length,
    eligibleOrders: eligible.length,
    filledOrders: filled.length,
    statusCounts,
    fillRate: eligible.length ? filled.length / eligible.length : null,
    medianTimeToFillSeconds: median(filled.map((order) => order.timeToFillSeconds)),
    medianSpreadBpsAtPlacement: median(eligible.map((order) => order.spreadBps)),
    medianQueueAheadUsd: median(eligible.map((order) => order.queueAheadUsd)),
    meanEffectiveCostVsArrivalMidBps: mean(filled.map((order) => order.effectiveCostVsArrivalMidBps)),
    medianEffectiveCostVsArrivalMidBps: median(filled.map((order) => order.effectiveCostVsArrivalMidBps)),
    meanSavingsVsImmediateTakerBps: mean(filled.map((order) => order.effectiveSavingsVsImmediateTakerBps)),
    medianSavingsVsImmediateTakerBps: median(filled.map((order) => order.effectiveSavingsVsImmediateTakerBps)),
    markoutBps: Object.fromEntries(markoutOffsets.map(({ seconds }) => {
      const values = markout(seconds);
      return [String(seconds), { mean: mean(values), median: median(values), n: values.length }];
    }))
  };
}

const grouped = { aggregate: summarize(orders) };
for (const product of manifest.venue.products) {
  for (const side of manifest.hypotheticalOrders.directions) {
    for (const notionalUsd of manifest.hypotheticalOrders.notionalUsd) {
      const key = `${product}|${side}|${notionalUsd}`;
      grouped[key] = summarize(orders.filter((order) => order.product === product && order.side === side && order.notionalUsd === notionalUsd));
    }
  }
}

const durationHours = Number.isFinite(firstReceived) && Number.isFinite(lastReceived)
  ? (lastReceived - firstReceived) / 3_600_000
  : 0;
const wallDurationMs = Math.max(0, (lastReceived ?? 0) - (firstReceived ?? 0));
const connectedCoveragePct = wallDurationMs > 0 ? Math.max(0, 1 - totalDisconnectMs / wallDurationMs) : 0;
const scientificWindow = durationHours >= manifest.recording.minimumScientificHours
  && parseErrors === 0
  && l2SequenceGaps === 0
  && connectedCoveragePct >= manifest.recording.minimumConnectedCoveragePct
  && maxDisconnectMs <= manifest.recording.maximumSingleDisconnectSeconds * 1000;
const result = {
  experimentId: manifest.experimentId,
  generatedAt: new Date().toISOString(),
  paperOnly: true,
  strategyTrial: false,
  input: path.resolve(inputPath),
  recording: {
    firstReceived: firstReceived ? new Date(firstReceived).toISOString() : null,
    lastReceived: lastReceived ? new Date(lastReceived).toISOString() : null,
    durationHours,
    minimumScientificHours: manifest.recording.minimumScientificHours,
    classification: scientificWindow ? 'SCIENTIFIC_WINDOW' : 'ENGINEERING_PILOT_ONLY',
    parseErrors,
    reconnects,
    l2SequenceGaps,
    outOfOrderL2,
    dataGapOrders,
    totalDisconnectSeconds: totalDisconnectMs / 1000,
    maxDisconnectSeconds: maxDisconnectMs / 1000,
    connectedCoveragePct,
    minimumConnectedCoveragePct: manifest.recording.minimumConnectedCoveragePct,
    maximumSingleDisconnectSeconds: manifest.recording.maximumSingleDisconnectSeconds,
    note: 'Reconnect-spanning orders are DATA_GAP and excluded. A recording is scientific only if duration, connected coverage, maximum disconnect, parse integrity, and level2 sequence rules all pass the frozen manifest.'
  },
  groups: grouped,
  antiSelectionRule: manifest.antiSelectionRule
};

const outBase = inputPath.replace(/\.ndjson\.gz$/, '');
fs.writeFileSync(`${outBase}-maker-summary.json`, `${JSON.stringify(result, null, 2)}\n`);
const columns = [
  'id', 'product', 'side', 'notionalUsd', 'placedAt', 'expiresAt', 'limit', 'arrivalBid', 'arrivalAsk', 'arrivalMid',
  'spreadBps', 'queueAheadBase', 'queueAheadUsd', 'sizeBase', 'status', 'fillAt', 'timeToFillSeconds', 'fillReason',
  'dataGapReason', 'effectiveCostVsArrivalMidBps', 'immediateTakerCostVsArrivalMidBps', 'effectiveSavingsVsImmediateTakerBps',
  ...markoutOffsets.map(({ seconds }) => `markout_${seconds}s_bps`)
];
const csvRows = [columns.join(',')];
for (const order of orders) {
  const values = columns.map((column) => {
    if (['placedAt', 'expiresAt', 'fillAt'].includes(column)) return order[column] ? new Date(order[column]).toISOString() : '';
    if (column.startsWith('markout_')) {
      const seconds = column.match(/markout_(\d+)s/)[1];
      return order.markouts[seconds] ?? '';
    }
    return order[column] ?? '';
  });
  csvRows.push(values.map(fmtCsv).join(','));
}
fs.writeFileSync(`${outBase}-maker-orders.csv`, `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(result, null, 2));
