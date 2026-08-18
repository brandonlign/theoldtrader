import { sampleStd, summarizeBacktest } from './tsmom.js';

const DAY_SECONDS = 86_400;

function finite(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoDay(time) {
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function mapsFor(dataset, products) {
  return Object.fromEntries(products.map((product) => [
    product,
    new Map((dataset.products[product] ?? []).map((row) => [Number(row.time), row]))
  ]));
}

function evaluationTimes(dataset, anchor, startSec, endSec) {
  return (dataset.products[anchor] ?? [])
    .map((row) => Number(row.time))
    .filter((time) => time >= startSec && time < endSec)
    .sort((a, b) => a - b);
}

function isMonthStart(time) {
  return new Date(time * 1000).getUTCDate() === 1;
}

function exactClose(map, time) {
  const row = map.get(time);
  return row && finite(row.close) > 0 ? finite(row.close) : null;
}

function exactOpen(map, time) {
  const row = map.get(time);
  return row && finite(row.open) > 0 ? finite(row.open) : null;
}

export function trailingAnnualizedVolatility(candlesByTime, decisionTime, lookbackDays = 90, annualizationDays = 365) {
  const endTime = decisionTime - DAY_SECONDS;
  const closes = [];
  for (let offset = lookbackDays; offset >= 0; offset -= 1) {
    const close = exactClose(candlesByTime, endTime - offset * DAY_SECONDS);
    if (!(close > 0)) return null;
    closes.push(close);
  }
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) returns.push(Math.log(closes[i] / closes[i - 1]));
  const std = sampleStd(returns);
  return std == null ? null : std * Math.sqrt(annualizationDays);
}

export function selectLowestVolatility(maps, products, decisionTime, manifest) {
  const rows = [];
  for (const product of products) {
    const volatility = trailingAnnualizedVolatility(
      maps[product],
      decisionTime,
      manifest.signal.realizedVolLookbackDays,
      manifest.signal.annualizationDays
    );
    if (volatility != null && volatility >= 0) rows.push({ product, volatility });
  }
  rows.sort((a, b) => a.volatility - b.volatility || a.product.localeCompare(b.product));
  return { selected: rows[0] ?? null, eligible: rows };
}

function entryMarkLossPct(manifest) {
  const fillMultiple = 1 + (manifest.costModel.slippageBpsPerTrade + manifest.costModel.historicalSpreadProxyBpsPerTrade) / 10_000;
  return fillMultiple * (1 + manifest.costModel.feeBpsPerTrade / 10_000) - 1;
}

function safePreCostWeight(postCostCap, manifest) {
  const c = Math.max(0, entryMarkLossPct(manifest));
  return postCostCap / (1 + postCostCap * c);
}

function tradeCostRate(manifest) {
  return manifest.costModel.totalBpsPerDollarTurnover / 10_000;
}

function requireClose(maps, product, time) {
  const value = exactClose(maps[product], time);
  if (!(value > 0)) throw new Error(`Missing exact close for ${product} on ${isoDay(time)}`);
  return value;
}

function requireOpen(maps, product, time) {
  const value = exactOpen(maps[product], time);
  if (!(value > 0)) throw new Error(`Missing exact open for ${product} on ${isoDay(time)}`);
  return value;
}

function dailyReturnMetrics(state, manifest) {
  return summarizeBacktest(state, manifest.portfolio.startingCash, manifest.signal.annualizationDays);
}

export function backtestLowVol(dataset, manifest, { start, end } = {}) {
  const products = manifest.data.products;
  const startSec = Date.parse(start) / 1000;
  const endSec = Date.parse(end) / 1000;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) throw new Error('Invalid Trial 6 range');
  const maps = mapsFor(dataset, products);
  const times = evaluationTimes(dataset, products[0], startSec, endSec);
  if (times.length < 2) throw new Error('Insufficient Trial 6 daily data');

  let cash = manifest.portfolio.startingCash;
  let holding = null;
  let units = 0;
  let turnoverUsd = 0;
  let transactionCostsUsd = 0;
  const trades = [];
  const rebalances = [];
  const equityPath = [];
  const costRate = tradeCostRate(manifest);
  const postCap = Math.min(manifest.portfolio.targetSelectedAssetWeight, manifest.portfolio.maxSinglePositionPct, manifest.portfolio.maxTotalCryptoExposurePct);
  const preCostWeight = safePreCostWeight(postCap, manifest);

  for (const time of times) {
    if (holding) requireClose(maps, holding, time);

    if (isMonthStart(time)) {
      const ranking = selectLowestVolatility(maps, products, time, manifest);
      const next = ranking.selected?.product ?? null;
      const openPrices = Object.fromEntries(products.map((product) => [product, requireOpen(maps, product, time)]));
      const pretradeEquity = cash + (holding ? units * openPrices[holding] : 0);
      const targetUnits = next ? (pretradeEquity * preCostWeight) / openPrices[next] : 0;

      if (holding && holding !== next) {
        const notional = units * openPrices[holding];
        const cost = notional * costRate;
        cash += notional - cost;
        turnoverUsd += notional;
        transactionCostsUsd += cost;
        trades.push({ time: new Date(time * 1000).toISOString(), product: holding, side: 'SELL', notional, price: openPrices[holding], cost, reason: 'monthly_reselection' });
        holding = null;
        units = 0;
      }

      if (next) {
        const currentUnits = holding === next ? units : 0;
        const delta = targetUnits - currentUnits;
        if (delta < -1e-12) {
          const quantity = -delta;
          const notional = quantity * openPrices[next];
          const cost = notional * costRate;
          cash += notional - cost;
          turnoverUsd += notional;
          transactionCostsUsd += cost;
          units -= quantity;
          trades.push({ time: new Date(time * 1000).toISOString(), product: next, side: 'SELL', notional, price: openPrices[next], cost, reason: 'monthly_resize' });
        } else if (delta > 1e-12) {
          const notional = delta * openPrices[next];
          const cost = notional * costRate;
          cash -= notional + cost;
          turnoverUsd += notional;
          transactionCostsUsd += cost;
          units += delta;
          holding = next;
          trades.push({ time: new Date(time * 1000).toISOString(), product: next, side: 'BUY', notional, price: openPrices[next], cost, reason: 'monthly_selection' });
        }
      }

      if (cash < -1e-6) throw new Error(`Trial 6 created negative cash: ${cash}`);
      rebalances.push({
        time: new Date(time * 1000).toISOString(),
        selected: next,
        eligible: ranking.eligible,
        pretradeEquity,
        targetPostCostWeight: postCap,
        targetPreCostWeight: preCostWeight
      });
    }

    const positionValue = holding ? units * requireClose(maps, holding, time) : 0;
    const equity = cash + positionValue;
    equityPath.push({ time: new Date(time * 1000).toISOString(), equity, cash, grossExposure: equity > 0 ? positionValue / equity : 0 });
  }

  const lastTime = times.at(-1);
  if (holding && units > 0) {
    const close = requireClose(maps, holding, lastTime);
    const notional = units * close;
    const cost = notional * costRate;
    cash += notional - cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({ time: new Date(lastTime * 1000).toISOString(), product: holding, side: 'SELL', notional, price: close, cost, reason: 'evaluation_end_liquidation' });
    holding = null;
    units = 0;
    equityPath[equityPath.length - 1] = { time: new Date(lastTime * 1000).toISOString(), equity: cash, cash, grossExposure: 0 };
  }

  return { finalEquity: cash, cash, holding, units, trades, rebalances, equityPath, turnoverUsd, transactionCostsUsd };
}

export function backtestStaticAllocation(dataset, manifest, { start, end, weights }) {
  const products = manifest.data.products;
  const startSec = Date.parse(start) / 1000;
  const endSec = Date.parse(end) / 1000;
  const maps = mapsFor(dataset, products);
  const times = evaluationTimes(dataset, products[0], startSec, endSec);
  if (times.length < 2) throw new Error('Insufficient static-comparator data');
  const first = times[0];
  const last = times.at(-1);
  const startingCash = manifest.portfolio.startingCash;
  const totalWeight = products.reduce((sum, product) => sum + Number(weights[product] ?? 0), 0);
  if (totalWeight > 0.45 + 1e-12) throw new Error('Static comparator exceeds 45% research cap');
  const matchedPreCostTotalWeight = totalWeight > 0 ? safePreCostWeight(totalWeight, manifest) : 0;
  const weightScale = totalWeight > 0 ? matchedPreCostTotalWeight / totalWeight : 0;
  const costRate = tradeCostRate(manifest);
  let cash = startingCash;
  let turnoverUsd = 0;
  let transactionCostsUsd = 0;
  const units = Object.fromEntries(products.map((product) => [product, 0]));
  const trades = [];

  for (const product of products) {
    const weight = Number(weights[product] ?? 0);
    if (!(weight > 0)) continue;
    const open = requireOpen(maps, product, first);
    const notional = startingCash * weight * weightScale;
    const cost = notional * costRate;
    units[product] = notional / open;
    cash -= notional + cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({ time: new Date(first * 1000).toISOString(), product, side: 'BUY', notional, price: open, cost, reason: 'static_entry' });
  }

  const equityPath = [];
  for (const time of times) {
    const positionValue = products.reduce((sum, product) => sum + units[product] * requireClose(maps, product, time), 0);
    const equity = cash + positionValue;
    equityPath.push({ time: new Date(time * 1000).toISOString(), equity, cash, grossExposure: equity > 0 ? positionValue / equity : 0 });
  }

  for (const product of products) {
    if (!(units[product] > 0)) continue;
    const close = requireClose(maps, product, last);
    const notional = units[product] * close;
    const cost = notional * costRate;
    cash += notional - cost;
    turnoverUsd += notional;
    transactionCostsUsd += cost;
    trades.push({ time: new Date(last * 1000).toISOString(), product, side: 'SELL', notional, price: close, cost, reason: 'static_exit' });
  }
  equityPath[equityPath.length - 1] = { time: new Date(last * 1000).toISOString(), equity: cash, cash, grossExposure: 0 };
  return { finalEquity: cash, cash, trades, rebalances: [], equityPath, turnoverUsd, transactionCostsUsd };
}

export function summarizeLowVol(state, manifest) {
  return dailyReturnMetrics(state, manifest);
}
