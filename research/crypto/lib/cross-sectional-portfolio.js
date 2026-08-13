import { selectCrossSection } from './cross-sectional.js';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function entryFill(mid, manifest) {
  const slip = finite(manifest.costModel.slippageBpsPerSide, 5);
  const halfSpread = finite(manifest.costModel.spreadBpsRoundTrip, 10) / 2;
  return mid * (1 + (slip + halfSpread) / 10_000);
}

function exitFill(mid, manifest) {
  const slip = finite(manifest.costModel.slippageBpsPerSide, 5);
  const halfSpread = finite(manifest.costModel.spreadBpsRoundTrip, 10) / 2;
  return mid * (1 - (slip + halfSpread) / 10_000);
}

function feePct(manifest) {
  return finite(manifest.costModel.feeBpsPerSide, 60) / 10_000;
}

function makeState(startingCash) {
  return {
    cash: startingCash,
    positions: new Map(),
    closedTrades: [],
    totalFees: 0,
    turnover: 0,
    orders: 0,
    equitySeries: [],
    exposureSeries: [],
    feeSeries: [],
    turnoverSeries: [],
    forcedExits: 0,
    realizedByAsset: {}
  };
}

function recordRealized(state, symbol, pnl) {
  state.realizedByAsset[symbol] = finite(state.realizedByAsset[symbol]) + finite(pnl);
}

function buyUnits(state, symbol, mid, requestedUnits, time, manifest, reason = 'rebalance') {
  if (!(requestedUnits > 0) || !(mid > 0) || !(state.cash > 0)) return 0;
  const fill = entryFill(mid, manifest);
  const feeRate = feePct(manifest);
  const unitCash = fill * (1 + feeRate);
  const units = Math.min(requestedUnits, state.cash / unitCash);
  if (!(units > 1e-12)) return 0;
  const gross = units * fill;
  const fee = gross * feeRate;
  const total = gross + fee;
  state.cash -= total;
  state.totalFees += fee;
  state.turnover += gross;
  state.orders += 1;

  const existing = state.positions.get(symbol);
  if (existing) {
    existing.units += units;
    existing.costBasis += total;
    existing.lastPrice = mid;
  } else {
    state.positions.set(symbol, {
      symbol,
      units,
      costBasis: total,
      openedAt: time,
      lastPrice: mid,
      lifecycleRealizedPnl: 0,
      reasonOpened: reason
    });
  }
  return units;
}

function sellUnits(state, symbol, mid, requestedUnits, time, manifest, reason = 'rebalance') {
  const position = state.positions.get(symbol);
  if (!position || !(requestedUnits > 0) || !(mid > 0)) return 0;
  const units = Math.min(position.units, requestedUnits);
  if (!(units > 1e-12)) return 0;
  const originalUnits = position.units;
  const basisShare = position.costBasis * (units / originalUnits);
  const fill = exitFill(mid, manifest);
  const gross = units * fill;
  const fee = gross * feePct(manifest);
  const net = gross - fee;
  const realized = net - basisShare;

  state.cash += net;
  state.totalFees += fee;
  state.turnover += gross;
  state.orders += 1;
  position.units -= units;
  position.costBasis -= basisShare;
  position.lifecycleRealizedPnl += realized;
  position.lastPrice = mid;
  recordRealized(state, symbol, realized);

  if (position.units <= 1e-10 || requestedUnits >= originalUnits - 1e-10) {
    const lifecyclePnl = position.lifecycleRealizedPnl;
    state.closedTrades.push({
      product: symbol,
      symbol,
      openedAt: position.openedAt,
      closedAt: time,
      pnl: lifecyclePnl,
      reason
    });
    state.positions.delete(symbol);
    if (reason === 'DATA_GAP') state.forcedExits += 1;
  }
  return units;
}

function indexProducts(dataset) {
  const out = {};
  for (const [symbol, rows] of Object.entries(dataset?.products ?? {})) {
    const sorted = [...rows].sort((a, b) => finite(a.time) - finite(b.time));
    out[symbol] = {
      rows: sorted,
      byTime: new Map(sorted.map((row) => [finite(row.time), row])),
      lastBefore(time) {
        let left = 0;
        let right = sorted.length - 1;
        let best = null;
        while (left <= right) {
          const middle = Math.floor((left + right) / 2);
          const row = sorted[middle];
          if (finite(row.time) < time) {
            best = row;
            left = middle + 1;
          } else {
            right = middle - 1;
          }
        }
        return best;
      }
    };
  }
  return out;
}

function markEquity(state, productData, time, field = 'close') {
  let positionValue = 0;
  for (const [symbol, position] of state.positions) {
    const row = productData[symbol]?.byTime.get(time);
    const price = finite(row?.[field], position.lastPrice);
    position.lastPrice = price > 0 ? price : position.lastPrice;
    positionValue += position.units * position.lastPrice;
  }
  return { equity: state.cash + positionValue, positionValue };
}

function snapshot(state, productData, time) {
  const { equity, positionValue } = markEquity(state, productData, time, 'close');
  state.equitySeries.push({ time, value: equity });
  state.exposureSeries.push({ time, value: equity > 0 ? positionValue / equity : 0 });
  state.feeSeries.push({ time, value: state.totalFees });
  state.turnoverSeries.push({ time, value: state.turnover });
}

function forceExitMissingHeldAssets(state, productData, time, manifest) {
  for (const symbol of [...state.positions.keys()]) {
    const current = productData[symbol]?.byTime.get(time);
    if (current) continue;
    const prior = productData[symbol]?.lastBefore(time);
    if (!prior || finite(prior.close) <= 0) {
      throw new Error(`Held asset ${symbol} has no valid final close before data gap at ${time}`);
    }
    const position = state.positions.get(symbol);
    sellUnits(state, symbol, finite(prior.close), position.units, time, manifest, 'DATA_GAP');
  }
}

function pretradeEquityAtOpen(state, productData, time) {
  let positionValue = 0;
  for (const [symbol, position] of state.positions) {
    const row = productData[symbol]?.byTime.get(time);
    if (!row || finite(row.open) <= 0) throw new Error(`Missing rebalance open for held asset ${symbol}`);
    positionValue += position.units * finite(row.open);
  }
  return state.cash + positionValue;
}

function rebalance(state, productData, time, predictionRows, manifest) {
  const selected = selectCrossSection(predictionRows, manifest);
  const selectedSymbols = new Set(selected.map((row) => row.symbol));
  const equity = pretradeEquityAtOpen(state, productData, time);
  const targetWeight = finite(manifest.portfolio.targetWeightPerSelectedAsset, 0.15);
  const maxSingle = finite(manifest.portfolio.maxSinglePositionPct, 0.15);
  const maxTotal = finite(manifest.portfolio.maxTotalCryptoExposurePct, 0.45);
  const targetPerAsset = Math.min(targetWeight, maxSingle, selected.length ? maxTotal / selected.length : 0);

  const targets = new Map();
  for (const row of selected) {
    const market = productData[row.symbol]?.byTime.get(time);
    if (!market || finite(market.open) <= 0) continue;
    targets.set(row.symbol, {
      units: (equity * targetPerAsset) / finite(market.open),
      mid: finite(market.open),
      prediction: row.prediction
    });
  }

  // Sell first so cash released by deselection/downsizing is available for buys.
  for (const [symbol, position] of [...state.positions.entries()]) {
    const market = productData[symbol]?.byTime.get(time);
    if (!market || finite(market.open) <= 0) throw new Error(`Missing rebalance market for held ${symbol}`);
    const target = targets.get(symbol);
    const targetUnits = target?.units ?? 0;
    if (!selectedSymbols.has(symbol) || position.units > targetUnits + 1e-10) {
      sellUnits(state, symbol, finite(market.open), position.units - targetUnits, time, manifest, 'rebalance');
    }
  }

  for (const [symbol, target] of targets) {
    const currentUnits = state.positions.get(symbol)?.units ?? 0;
    if (target.units > currentUnits + 1e-10) {
      buyUnits(state, symbol, target.mid, target.units - currentUnits, time, manifest, 'rebalance');
    }
  }

  return selected;
}

export function simulateCrossSectionalPortfolio(dataset, predictions, manifest, startIso, endExclusiveIso) {
  const start = Math.floor(Date.parse(startIso) / 1000);
  const end = Math.floor(Date.parse(endExclusiveIso) / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid simulation range');
  const state = makeState(finite(manifest.portfolio.startingCash, 10_000));
  const productData = indexProducts(dataset);
  const decisions = [];

  for (let time = start; time < end; time += 86400) {
    forceExitMissingHeldAssets(state, productData, time, manifest);
    const prediction = predictions.get(time);
    if (prediction) {
      const selected = rebalance(state, productData, time, prediction.rows, manifest);
      decisions.push({
        time,
        trainingRows: prediction.trainingRows,
        trainingMonths: prediction.trainingMonths,
        selected: selected.map((row) => ({ symbol: row.symbol, prediction: row.prediction }))
      });
    }
    snapshot(state, productData, time);
  }

  return { state, decisions };
}
