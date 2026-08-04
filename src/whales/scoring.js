import { walkForwardByCategory } from "./walk-forward.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function maxDrawdown(pnls) {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const pnl of pnls) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return drawdown;
}

export function scoreWallet({ wallet, leaderboardEntries = [], closedPositions = [], tradedCount = 0 }) {
  const positions = [...closedPositions].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const pnls = positions.map((position) => Number(position.realizedPnl) || 0);
  const positivePnls = pnls.filter((pnl) => pnl > 0);
  const negativePnls = pnls.filter((pnl) => pnl < 0);
  const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
  const grossProfit = positivePnls.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(negativePnls.reduce((sum, pnl) => sum + pnl, 0));
  const largestWin = positivePnls.length ? Math.max(...positivePnls) : 0;
  const capitalDeployed = positions.reduce((sum, position) => {
    const totalBought = Math.max(0, Number(position.totalBought) || 0);
    const avgPrice = clamp(Number(position.avgPrice) || 0, 0, 1);
    return sum + totalBought * avgPrice;
  }, 0);
  const sampleSize = positions.length;
  const winRate = safeDivide(positivePnls.length, sampleSize);
  const roi = safeDivide(totalPnl, capitalDeployed);
  const robustPnl = totalPnl - largestWin;
  const topWinShare = safeDivide(largestWin, grossProfit);
  const drawdown = maxDrawdown(pnls);
  const drawdownRatio = safeDivide(drawdown, grossProfit + grossLoss);
  const profitFactor = safeDivide(grossProfit, grossLoss || 1);

  const bestRanks = new Map();
  for (const entry of leaderboardEntries) {
    const current = bestRanks.get(entry.category);
    if (!current || entry.rank < current.rank) bestRanks.set(entry.category, entry);
  }
  const categoryRanks = Object.fromEntries([...bestRanks.entries()].map(([category, entry]) => [category, entry.rank]));
  const categoryStrength = bestRanks.size
    ? [...bestRanks.values()].reduce((sum, entry) => sum + clamp(1 - (entry.rank - 1) / 50), 0) / bestRanks.size
    : 0;

  const walkForward = walkForwardByCategory(positions, { minTrain: 6, testSize: 3, maxFolds: 8 });
  const forward = walkForward.OVERALL;
  const sampleScore = clamp(Math.log1p(sampleSize) / Math.log1p(60));
  const roiScore = clamp((roi + 0.03) / 0.28);
  const winScore = clamp((winRate - 0.38) / 0.32);
  const robustScore = robustPnl > 0 ? clamp(Math.log1p(robustPnl) / Math.log1p(10_000)) : 0;
  const profitFactorScore = clamp((profitFactor - 0.8) / 2.2);
  const drawdownScore = 1 - clamp(drawdownRatio / 0.65);
  const concentrationPenalty = clamp((topWinShare - 0.35) / 0.45);

  let score = 100 * (
    0.16 * sampleScore +
    0.18 * roiScore +
    0.10 * winScore +
    0.14 * robustScore +
    0.08 * profitFactorScore +
    0.08 * drawdownScore +
    0.06 * categoryStrength +
    0.20 * clamp(forward.score / 100)
  );
  score -= 22 * concentrationPenalty;
  score = clamp(score, 0, 100);

  const rejectionReasons = [];
  if (sampleSize < 10) rejectionReasons.push("too-few-resolved-markets");
  if (totalPnl <= 0) rejectionReasons.push("non-positive-total-pnl");
  if (robustPnl <= 0) rejectionReasons.push("profit-depends-on-best-win");
  if (roi <= 0) rejectionReasons.push("non-positive-roi");
  if (topWinShare > 0.75) rejectionReasons.push("one-hit-concentration");
  if (!forward.eligible) {
    rejectionReasons.push(...forward.rejectionReasons.map((reason) => `walk-forward:${reason}`));
  }

  return {
    wallet: String(wallet).toLowerCase(),
    score: Number(score.toFixed(2)),
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    sampleSize,
    tradedCount,
    totalPnl,
    robustPnl,
    capitalDeployed,
    roi,
    winRate,
    grossProfit,
    grossLoss,
    profitFactor,
    largestWin,
    topWinShare,
    maxDrawdown: drawdown,
    drawdownRatio,
    categoryRanks,
    categories: [...bestRanks.keys()],
    walkForward
  };
}
