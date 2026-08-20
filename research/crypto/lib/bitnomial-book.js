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
      return { priceTicks: ticks, priceUsd: ticks * increment, contracts, btcQuantity: contracts * contractSize };
    });
  };
  const asks = normalizeSide(message.asks, "ask");
  const bids = normalizeSide(message.bids, "bid");
  if (!asks.length || !bids.length) throw new Error("Bitnomial book snapshot has an empty side");
  if (asks[0].priceUsd < bids[0].priceUsd) throw new Error("Bitnomial book is crossed");
  const timestampMs = Date.parse(message.timestamp);
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid Bitnomial book timestamp");
  return { symbol, timestamp: new Date(timestampMs).toISOString(), asks, bids };
}
export function displayedDepthPass(book, btcQuantity) {
  const quantity = positive(btcQuantity, "execution BTC quantity");
  const sum = (levels) => levels.reduce((total, level) => total + positive(level.btcQuantity, "book level BTC quantity"), 0);
  return { buy: sum(book.asks) + 1e-12 >= quantity, sell: sum(book.bids) + 1e-12 >= quantity };
}
