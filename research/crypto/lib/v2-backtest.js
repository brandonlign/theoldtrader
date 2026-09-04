import { deriveCryptoSignal } from '../../../src/crypto/strategy.js';
import { riskSizedNotional } from '../../../src/crypto/risk.js';

function currentEquity(state, prices) {
  let positionValue = 0;
  for (const [product, position] of state.positions) {
    const price = prices.get(product) ?? position.lastPrice;
    positionValue += position.units * price;
  }
  return { equity: state.cash + positionValue, positionValue };
}

function entryFill(mid, costs) {
  return mid * (1 + (costs.slippageBpsPerSide + costs.historicalSpreadBpsRoundTrip / 2) / 10_000);
}

function exitFill(mid, costs) {
  return mid * (1 - (costs.slippageBpsPerSide + costs.historicalSpreadBpsRoundTrip / 2) / 10_000);
}

function stateFor(startingCash) {
  return {
    cash: startingCash,
    positions: new Map(),
    lastExit: new Map(),
    totalFees: 0,
    turnover: 0,
    orders: 0,
    closedTrades: [],
    equitySeries: [],
    exposureSeries: [],
    turnoverSeries: [],
    feeSeries: []
  };
}

function snapshot(state, time, prices) {
  const { equity, positionValue } = currentEquity(state, prices);
  state.equitySeries.push({ time, value: equity });
  state.exposureSeries.push({ time, value: equity > 0 ? positionValue / equity : 0 });
  state.turnoverSeries.push({ time, value: state.turnover });
  state.feeSeries.push({ time, value: state.totalFees });
}

function buy(state, product, mid, notional, time, costs) {
  const fill = entryFill(mid, costs);
  const fee = notional * costs.feeBpsPerSide / 10_000;
  const total = notional + fee;
  if (notional <= 0 || state.cash + 1e-9 < total) return false;
  state.cash -= total;
  state.totalFees += fee;
  state.turnover += notional;
  state.orders += 1;
  state.positions.set(product, {
    units: notional / fill,
    averageCost: fill,
    highestPrice: mid,
    openedAt: new Date(time * 1000).toISOString(),
    entryCash: total,
    lastPrice: mid
  });
  return true;
}

function sell(state, product, mid, time, costs, reason) {
  const position = state.positions.get(product);
  if (!position) return false;
  const fill = exitFill(mid, costs);
  const gross = position.units * fill;
  const fee = gross * costs.feeBpsPerSide / 10_000;
  const net = gross - fee;
  const pnl = net - position.entryCash;
  state.cash += net;
  state.totalFees += fee;
  state.turnover += gross;
  state.orders += 1;
  state.closedTrades.push({ product, openedAt: position.openedAt, closedAt: time, pnl, entryCash: position.entryCash, reason });
  state.positions.delete(product);
  state.lastExit.set(product, time);
  return true;
}

export function frozenV2Config(manifest) {
  const roundTripCostPct = ((2 * manifest.costModel.feeBpsPerSide)
    + (2 * manifest.costModel.slippageBpsPerSide)
    + manifest.costModel.historicalSpreadBpsRoundTrip) / 10_000;
  const exitCostPct = (manifest.costModel.feeBpsPerSide
    + manifest.costModel.slippageBpsPerSide
    + manifest.costModel.historicalSpreadBpsRoundTrip / 2) / 10_000;
  return {
    fastPeriod: 12,
    slowPeriod: 36,
    regimePeriod: 72,
    regimeLookback: 8,
    momentumPeriod: 12,
    rsiPeriod: 14,
    minTrend: 0.0018,
    minMomentum: 0.004,
    minRsi: 53,
    maxRsi: 68,
    exitRsi: 46,
    minRegimeSlope: 0.0008,
    maxEntryVolatility: 0.03,
    stopLossPct: 0.035,
    takeProfitPct: 0.075,
    trailingStopPct: 0.028,
    minVolumeRatio: 0.9,
    requiredChecks: 7,
    minEdgeToCost: 2,
    minProjectedEdge: 0.01,
    minHoldMinutes: 180,
    roundTripCostPct,
    exitCostPct
  };
}

export function backtestFrozenV2(dataset, manifest, start, end) {
  const startSec = Math.floor(Date.parse(start) / 1000);
  const endSec = Math.floor(Date.parse(end) / 1000);
  const products = manifest.data.products;
  const state = stateFor(manifest.portfolio.startingCash);
  const indexes = Object.fromEntries(products.map((product) => [product, new Map((dataset.products[product] ?? []).map((c, i) => [c.time, i]))]));
  const ref = dataset.products[products[0]] ?? [];
  const signalConfig = frozenV2Config(manifest);
  const execution = {
    riskPct: 0.004,
    maxPositionPct: 0.15,
    maxExposurePct: 0.45,
    cashReservePct: 0.25,
    minTradeUsd: 25,
    maxTradeUsd: 2000,
    feeBps: manifest.costModel.feeBpsPerSide,
    cooldownMinutes: 360
  };
  const lastPrices = new Map();

  for (const refCandle of ref) {
    const time = refCandle.time;
    if (time < startSec || time >= endSec) continue;
    const prices = new Map(lastPrices);

    for (const product of products) {
      const candles = dataset.products[product] ?? [];
      const idx = indexes[product].get(time);
      if (idx === undefined) continue;
      const candle = candles[idx];
      prices.set(product, candle.close);
      lastPrices.set(product, candle.close);
      const position = state.positions.get(product);
      if (position) {
        position.highestPrice = Math.max(position.highestPrice, candle.high);
        position.lastPrice = candle.close;
      }
      if (idx < 320) continue;
      const history = candles.slice(Math.max(0, idx - 400), idx + 1);
      const signal = deriveCryptoSignal({ productId: product, candles: history, position: position ?? null, config: signalConfig });

      if (signal.action === 'BUY' && !position) {
        const lastExit = state.lastExit.get(product);
        if (lastExit && time - lastExit < execution.cooldownMinutes * 60) continue;
        const { equity, positionValue } = currentEquity(state, prices);
        const notional = riskSizedNotional({
          equity,
          cash: state.cash,
          openPositionValue: positionValue,
          stopLossPct: signal.metrics?.effectiveStopLossPct ?? signalConfig.stopLossPct,
          riskPct: execution.riskPct,
          maxPositionPct: execution.maxPositionPct,
          maxExposurePct: execution.maxExposurePct,
          cashReservePct: execution.cashReservePct,
          maxTradeUsd: execution.maxTradeUsd,
          feeBps: execution.feeBps
        });
        if (notional >= execution.minTradeUsd) buy(state, product, candle.close, notional, time, manifest.costModel);
      } else if (signal.action === 'SELL' && position) {
        sell(state, product, candle.close, time, manifest.costModel, signal.reasons?.join('|') ?? 'v2-sell');
      }
    }
    snapshot(state, time, prices);
  }

  const finalPrices = new Map(lastPrices);
  for (const product of [...state.positions.keys()]) {
    const price = finalPrices.get(product) ?? state.positions.get(product).lastPrice;
    sell(state, product, price, endSec, manifest.costModel, 'evaluation-end');
  }
  snapshot(state, endSec, finalPrices);
  return state;
}
