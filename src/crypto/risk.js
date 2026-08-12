function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function estimateRoundTripCostPct({ feeBps = 0, slippageBps = 0, spreadBps = 0 } = {}) {
  const fee = Math.max(0, finite(feeBps));
  const slippage = Math.max(0, finite(slippageBps));
  const spread = Math.max(0, finite(spreadBps));
  return ((fee * 2) + (slippage * 2) + spread) / 10_000;
}

export function estimateExitCostPct({ feeBps = 0, slippageBps = 0, spreadBps = 0 } = {}) {
  const fee = Math.max(0, finite(feeBps));
  const slippage = Math.max(0, finite(slippageBps));
  const spread = Math.max(0, finite(spreadBps));
  return (fee + slippage + spread / 2) / 10_000;
}

export function riskSizedNotional({
  equity,
  cash,
  openPositionValue = 0,
  stopLossPct,
  riskPct = 0.004,
  maxPositionPct = 0.15,
  maxExposurePct = 0.45,
  cashReservePct = 0.25,
  maxTradeUsd = 2_000,
  feeBps = 0
} = {}) {
  const safeEquity = Math.max(0, finite(equity));
  const safeCash = Math.max(0, finite(cash));
  if (safeEquity <= 0 || safeCash <= 0) return 0;

  const stop = Math.max(0.005, finite(stopLossPct, 0.035));
  const riskBudget = safeEquity * Math.max(0.001, Math.min(0.02, finite(riskPct, 0.004)));
  const riskSized = riskBudget / stop;
  const positionCap = safeEquity * Math.max(0.02, Math.min(0.4, finite(maxPositionPct, 0.15)));
  const exposureCap = safeEquity * Math.max(0.1, Math.min(0.9, finite(maxExposurePct, 0.45)));
  const exposureRoom = Math.max(0, exposureCap - Math.max(0, finite(openPositionValue)));
  const reserve = safeEquity * Math.max(0.05, Math.min(0.6, finite(cashReservePct, 0.25)));
  const spendableCash = Math.max(0, safeCash - reserve);
  const feeRate = Math.max(0, finite(feeBps)) / 10_000;
  const feeAdjustedCash = spendableCash / (1 + feeRate);

  return Math.max(0, Math.min(
    riskSized,
    positionCap,
    exposureRoom,
    Math.max(0, finite(maxTradeUsd, 2_000)),
    feeAdjustedCash
  ));
}
