function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (!(number > 0)) throw new Error(`Non-positive ${label}`);
  return number;
}

export function normalizeBookSnapshot(message, { symbol, priceIncrement, contractSizeBtc }) {
  if (!message || message.type !== "book") throw new Error("Expected Bitnomial book snapshot");
  if (String(message.symbol ?? "") !== String(symbol)) throw new Error(`Bitnomial book symbol mismatch: expected ${symbol}, got ${message.symbol}`);
  const increment = positive(priceIncrement, "price increment");
  const contractSize = positive(contractSizeBtc, "contract size BTC");
  const normalizeSide = (levels, side) => {
    if (!Array.isArray(levels)) throw new Error(`Bitnomial ${side} levels missing`);
    return levels.map((level, index) => {
      if (!Array.isArray(level) || level.length < 2) throw new Error(`Invalid Bitnomial ${side} level ${index}`);
      const ticks = positive(level[0], `${side} price ticks`);
      const contracts = positive(level[1], `${side} quantity contracts`);
      return {
        priceTicks: ticks,
        priceUsd: ticks * increment,
        contracts,
        btcQuantity: contracts * contractSize
      };
    });
  };
  const asks = normalizeSide(message.asks, "ask");
  const bids = normalizeSide(message.bids, "bid");
  if (!asks.length || !bids.length) throw new Error("Bitnomial book snapshot has an empty side");
  if (asks[0].priceUsd < bids[0].priceUsd) throw new Error("Bitnomial book is crossed");
  const timestampMs = Date.parse(message.timestamp);
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid Bitnomial book timestamp");
  return {
    symbol,
    ackId: String(message.ack_id ?? ""),
    timestamp: new Date(timestampMs).toISOString(),
    asks,
    bids,
    bestAskUsd: asks[0].priceUsd,
    bestBidUsd: bids[0].priceUsd,
    midpointUsd: (asks[0].priceUsd + bids[0].priceUsd) / 2,
    spreadBps: ((asks[0].priceUsd - bids[0].priceUsd) / ((asks[0].priceUsd + bids[0].priceUsd) / 2)) * 10_000
  };
}

export function executableVwap(book, { action, btcQuantity }) {
  const quantity = positive(btcQuantity, "execution BTC quantity");
  if (!["BUY", "SELL"].includes(action)) throw new Error("action must be BUY or SELL");
  const levels = action === "BUY" ? book.asks : book.bids;
  let remaining = quantity;
  let notional = 0;
  let filled = 0;
  const fills = [];
  for (const level of levels) {
    if (remaining <= 1e-12) break;
    const take = Math.min(remaining, positive(level.btcQuantity, "book level BTC quantity"));
    if (!(take > 0)) continue;
    notional += take * positive(level.priceUsd, "book level USD price");
    filled += take;
    remaining -= take;
    fills.push({ priceUsd: level.priceUsd, btcQuantity: take });
  }
  const pass = remaining <= Math.max(1e-12, quantity * 1e-10);
  return {
    pass,
    action,
    requestedBtc: quantity,
    filledBtc: filled,
    unfilledBtc: Math.max(0, remaining),
    vwapUsd: pass ? notional / quantity : null,
    notionalUsd: pass ? notional : null,
    levelsConsumed: fills.length,
    fills
  };
}

export function validateBookFreshness(book, recordedAt, maximumAgeSeconds) {
  const recorded = Date.parse(recordedAt);
  const bookTime = Date.parse(book?.timestamp);
  if (!Number.isFinite(recorded) || !Number.isFinite(bookTime)) throw new Error("Invalid book freshness timestamp");
  const ageMs = recorded - bookTime;
  const pass = ageMs >= -1_000 && ageMs <= Number(maximumAgeSeconds) * 1_000;
  return { pass, ageMs };
}
