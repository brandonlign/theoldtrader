import { Dec } from "../decimal.js";
import { quoteLevels } from "../orderbook.js";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tradeTimestampMs(trade) {
  const timestamp = number(trade.timestamp);
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

export function tradeKey(trade) {
  const hash = String(trade.transactionHash ?? "").toLowerCase();
  const parts = [hash || "nohash", trade.asset, trade.side, trade.timestamp, Number(trade.price).toFixed(8)];
  return parts.join(":");
}

function aggregateTrades(trades) {
  const grouped = new Map();
  for (const trade of trades) {
    const key = tradeKey(trade);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...trade, size: number(trade.size), _key: key });
      continue;
    }
    const oldNotional = existing.size * existing.price;
    const addedSize = number(trade.size);
    const newSize = existing.size + addedSize;
    existing.price = newSize > 0 ? (oldNotional + addedSize * number(trade.price)) / newSize : existing.price;
    existing.size = newSize;
  }
  return [...grouped.values()].sort((a, b) => tradeTimestampMs(a) - tradeTimestampMs(b));
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function inferCategory(trade) {
  const text = `${trade.title ?? ""} ${trade.slug ?? ""} ${trade.eventSlug ?? ""}`.toLowerCase();
  const rules = [
    ["POLITICS", /election|president|senate|congress|governor|primary|minister|parliament|trump|democrat|republican/],
    ["CRYPTO", /bitcoin|btc|ethereum|eth|crypto|solana|token|coinbase/],
    ["SPORTS", /\b(?:nba|nfl|nhl|mlb|ufc)\b|soccer|football|basketball|baseball|tennis|championship|world cup/],
    ["ECONOMICS", /inflation|cpi|gdp|recession|unemployment|fed|interest rate|payroll/],
    ["FINANCE", /stock|nasdaq|s&p|dow|earnings|ipo|market cap|oil price|gold price/],
    ["TECH", /openai|apple|google|microsoft|tesla|ai model|spacex|launch/],
    ["WEATHER", /temperature|hurricane|storm|rain|snow|weather/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "OVERALL";
}

function walletCategoryScore(wallet, category) {
  const ranks = wallet.categoryRanks ?? {};
  const rank = ranks[category] ?? ranks.OVERALL;
  if (!rank) return wallet.score ?? 0;
  const rankBoost = Math.max(0, 12 - (Number(rank) - 1) * 0.25);
  return Math.min(100, number(wallet.score) + rankBoost);
}

function classifyChurn(recentTrades, currentTrade) {
  const cutoff = tradeTimestampMs(currentTrade) - 6 * 60 * 60 * 1000;
  let sameSide = 0;
  let opposite = 0;
  for (const trade of recentTrades) {
    if (trade.asset !== currentTrade.asset || tradeTimestampMs(trade) < cutoff) continue;
    const notional = number(trade.size) * number(trade.price);
    if (trade.side === currentTrade.side) sameSide += notional;
    else opposite += notional;
  }
  const total = sameSide + opposite;
  return total > 0 ? opposite / total : 0;
}

function baseState() {
  return { version: 1, wallets: {}, recentSignals: [] };
}

export class WhaleMonitor {
  constructor({ dataApi, clob, config }) {
    this.dataApi = dataApi;
    this.clob = clob;
    this.config = config;
  }

  async observeOnce(wallets, state = baseState(), nowMs = Date.now()) {
    const nextState = structuredClone(state?.version ? state : baseState());
    nextState.wallets ??= {};
    nextState.recentSignals ??= [];
    const prepared = [];
    const baselined = [];
    const errors = [];

    for (const wallet of wallets) {
      const address = String(wallet.wallet).toLowerCase();
      try {
        const trades = aggregateTrades(await this.dataApi.trades(address, {
          limit: this.config.tradeLookback,
          takerOnly: true
        }));
        const cursor = nextState.wallets[address];
        if (!cursor) {
          const latestTimestamp = trades.reduce((max, trade) => Math.max(max, tradeTimestampMs(trade)), 0);
          nextState.wallets[address] = {
            lastTimestampMs: latestTimestamp,
            seenKeys: trades.slice(-this.config.seenKeyLimit).map((trade) => trade._key),
            baselinedAt: new Date(nowMs).toISOString()
          };
          baselined.push(address);
          continue;
        }

        const seen = new Set(cursor.seenKeys ?? []);
        const newTrades = trades.filter((trade) => {
          const timestampMs = tradeTimestampMs(trade);
          return timestampMs > number(cursor.lastTimestampMs) || (timestampMs === number(cursor.lastTimestampMs) && !seen.has(trade._key));
        });
        if (newTrades.length === 0) continue;

        const positions = await this.dataApi.positions(address, { limit: 500, sizeThreshold: 0 });
        const positionByAsset = new Map(positions.map((position) => [position.asset, position]));
        for (const trade of newTrades.slice(-this.config.maxNewTradesPerWallet)) {
          prepared.push({ wallet, trade, recentTrades: trades, position: positionByAsset.get(trade.asset) });
        }

        const latestTimestamp = Math.max(number(cursor.lastTimestampMs), ...newTrades.map(tradeTimestampMs));
        nextState.wallets[address] = {
          ...cursor,
          lastTimestampMs: latestTimestamp,
          seenKeys: [...new Set([...(cursor.seenKeys ?? []), ...newTrades.map((trade) => trade._key)])].slice(-this.config.seenKeyLimit),
          updatedAt: new Date(nowMs).toISOString()
        };
      } catch (error) {
        errors.push({ wallet: address, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const buyAssets = [...new Set(prepared.filter((item) => item.trade.side === "BUY").map((item) => item.trade.asset))];
    let books = new Map();
    if (buyAssets.length > 0) {
      try {
        books = await this.clob.getOrderBooks(buyAssets, this.config.bookBatchSize);
      } catch (error) {
        errors.push({ wallet: "orderbooks", error: error instanceof Error ? error.message : String(error) });
      }
    }

    const feeCache = new Map();
    const signals = [];
    for (const item of prepared) {
      let feeSchedule = { rate: new Dec(0), exponent: 2, takerOnly: true };
      if (item.trade.side === "BUY" && books.has(item.trade.asset)) {
        try {
          if (!feeCache.has(item.trade.conditionId)) {
            feeCache.set(item.trade.conditionId, await this.clob.getFeeSchedule(item.trade.conditionId));
          }
          feeSchedule = feeCache.get(item.trade.conditionId);
        } catch {
          feeSchedule = null;
        }
      }
      signals.push(this.evaluateTrade({ ...item, book: books.get(item.trade.asset), feeSchedule, nowMs }));
    }

    const candidatesByAsset = new Map();
    for (const signal of signals.filter((signal) => signal.preliminaryDecision === "COPY_CANDIDATE")) {
      const group = candidatesByAsset.get(signal.asset) ?? [];
      group.push(signal);
      candidatesByAsset.set(signal.asset, group);
    }

    for (const signal of signals) {
      if (signal.preliminaryDecision !== "COPY_CANDIDATE") {
        signal.decision = "REJECTED";
        continue;
      }
      const independentWallets = new Set((candidatesByAsset.get(signal.asset) ?? []).map((item) => item.wallet));
      signal.consensusCount = independentWallets.size;
      if (independentWallets.size < this.config.requiredConsensus) {
        signal.decision = "REJECTED";
        signal.reasons.push("insufficient-wallet-consensus");
      } else {
        signal.decision = "COPY_CANDIDATE";
      }
    }

    const remembered = [...signals, ...nextState.recentSignals]
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
      .slice(0, this.config.recentSignalLimit);
    nextState.recentSignals = remembered;
    nextState.lastRunAt = new Date(nowMs).toISOString();

    return {
      observedAt: new Date(nowMs).toISOString(),
      walletsChecked: wallets.length,
      baselined,
      newTrades: prepared.length,
      signals,
      errors,
      state: nextState
    };
  }

  evaluateTrade({ wallet, trade, recentTrades, position, book, feeSchedule, nowMs }) {
    const detectedAt = new Date(nowMs).toISOString();
    const timestampMs = tradeTimestampMs(trade);
    const detectionDelaySeconds = Math.max(0, (nowMs - timestampMs) / 1000);
    const tradeNotional = number(trade.size) * number(trade.price);
    const previousNotionals = recentTrades
      .filter((item) => tradeKey(item) !== trade._key)
      .map((item) => number(item.size) * number(item.price));
    const normalTradeNotional = median(previousNotionals) || tradeNotional;
    const relativeConviction = normalTradeNotional > 0 ? tradeNotional / normalTradeNotional : 1;
    const category = inferCategory(trade);
    const effectiveWalletScore = walletCategoryScore(wallet, category);
    const reasons = [];

    if (trade.side !== "BUY") reasons.push("sell-or-position-reduction");
    if (tradeNotional < this.config.minWhaleTradeUsd) reasons.push("trade-too-small");
    if (relativeConviction < this.config.minRelativeConviction) reasons.push("below-wallet-normal-size");
    if (effectiveWalletScore < this.config.minWalletScore) reasons.push("wallet-score-too-low");
    if (detectionDelaySeconds > this.config.maxDetectionDelaySeconds) reasons.push("signal-too-late");
    if (!position || number(position.size) <= 0.01) reasons.push("no-current-directional-position");
    if (classifyChurn(recentTrades, trade) > this.config.maxOppositeTurnoverRatio) reasons.push("high-two-sided-turnover");
    if (!book || !book.asks?.length) reasons.push("missing-live-ask");
    if (!feeSchedule) reasons.push("unknown-fee-schedule");

    let quote = null;
    let targetShares = 0;
    let slippagePoints = null;
    let slippageBps = null;
    let copyNotional = null;
    if (reasons.length === 0) {
      const bestAsk = number(book.asks[0].price);
      const maxByCash = this.config.maxCopyUsd / bestAsk;
      targetShares = Math.min(number(trade.size) * this.config.copyFraction, maxByCash);
      if (targetShares * bestAsk < this.config.minCopyUsd) targetShares = this.config.minCopyUsd / bestAsk;
      targetShares = Math.max(0, targetShares);
      quote = quoteLevels(trade.asset, "BUY", book.asks, new Dec(targetShares), feeSchedule);
      if (!quote) {
        reasons.push("insufficient-orderbook-depth");
      } else {
        const averagePrice = number(quote.averagePrice.toString());
        slippagePoints = averagePrice - number(trade.price);
        slippageBps = number(trade.price) > 0 ? (slippagePoints / number(trade.price)) * 10_000 : null;
        copyNotional = number(quote.notional.plus(quote.fee).toString());
        if (slippagePoints > this.config.maxPriceDeterioration) reasons.push("price-moved-too-far");
        if (averagePrice > this.config.maxEntryPrice) reasons.push("entry-price-too-high");
        if (copyNotional > this.config.maxCopyUsd * 1.02) reasons.push("copy-size-exceeds-cap");
        const ageMs = Math.max(0, nowMs - number(book.timestampMs));
        if (ageMs > this.config.maxBookAgeMs) reasons.push("stale-orderbook");
      }
    }

    return {
      id: trade._key,
      detectedAt,
      wallet: String(wallet.wallet).toLowerCase(),
      walletName: wallet.userName ?? "",
      walletScore: number(wallet.score),
      effectiveWalletScore,
      category,
      asset: trade.asset,
      conditionId: trade.conditionId,
      title: trade.title,
      slug: trade.slug,
      outcome: trade.outcome,
      whaleSide: trade.side,
      whalePrice: number(trade.price),
      whaleShares: number(trade.size),
      whaleNotional: tradeNotional,
      relativeConviction,
      detectionDelaySeconds,
      currentPositionSize: number(position?.size),
      copyShares: quote ? number(quote.shares.toString()) : targetShares,
      copyAveragePrice: quote ? number(quote.averagePrice.toString()) : null,
      copyWorstPrice: quote ? number(quote.worstPrice.toString()) : null,
      estimatedFee: quote ? number(quote.fee.toString()) : null,
      estimatedCost: copyNotional,
      slippagePoints,
      slippageBps,
      consensusCount: 1,
      preliminaryDecision: reasons.length === 0 ? "COPY_CANDIDATE" : "REJECTED",
      decision: reasons.length === 0 ? "COPY_CANDIDATE" : "REJECTED",
      reasons
    };
  }
}

export function defaultWhaleState() {
  return baseState();
}
