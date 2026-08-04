import { Dec } from "../decimal.js";
function D(value = 0) { return Dec.from(value); }

export function defaultPaperPortfolio(startingCash = 10_000) {
  return {
    version: 2,
    startingCash: D(startingCash),
    cash: D(startingCash),
    realizedPnl: D(0),
    positions: {},
    executions: {},
    lastUpdatedAt: null
  };
}

function currentPosition(state, tokenId) {
  return state.positions[tokenId] ?? { tokenId, shares: D(0), costBasis: D(0) };
}

export function applyPaperExecution(inputState, execution) {
  const state = JSON.parse(JSON.stringify(inputState?.version ? inputState : defaultPaperPortfolio()));
  if (state.executions?.[execution.id]) throw new Error(`Execution ${execution.id} already applied`);
  state.executions ??= {};
  state.positions ??= {};

  const capitalRequired = D(execution.capitalRequired ?? 0);
  if (capitalRequired.gt(D(state.cash))) throw new Error("Insufficient paper cash");
  state.cash = D(state.cash).plus(execution.cashDelta ?? 0);

  if (execution.status !== "REJECTED" && execution.status !== "FAILED") {
    for (const item of execution.openInventory ?? []) {
      const position = currentPosition(state, item.tokenId);
      const reducing = item.side === "REDUCE";
      const signedShares = reducing ? D(item.shares).mul(-1) : D(item.shares);
      const signedCost = reducing ? D(item.costBasis).mul(-1) : D(item.costBasis);
      position.shares = D(position.shares).plus(signedShares);
      position.costBasis = D(position.costBasis).plus(signedCost);
      state.positions[item.tokenId] = position;
    }
    state.realizedPnl = D(state.realizedPnl).plus(execution.guaranteedProfit ?? 0);
  }

  state.executions[execution.id] = {
    id: execution.id,
    strategy: execution.strategy,
    status: execution.status,
    detectedAt: execution.detectedAt,
    executedAt: execution.executedAt,
    cashDelta: D(execution.cashDelta ?? 0),
    guaranteedProfit: D(execution.guaranteedProfit ?? 0),
    reasons: execution.reasons ?? []
  };
  state.lastUpdatedAt = execution.executedAt ?? new Date().toISOString();
  return state;
}
