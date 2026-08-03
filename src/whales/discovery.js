import { scoreWallet } from "./scoring.js";

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

export async function discoverWhales(dataApi, options = {}) {
  const categories = options.categories ?? ["OVERALL", "POLITICS", "CRYPTO", "FINANCE", "ECONOMICS", "TECH"];
  const leaderboardLimit = Math.min(50, Math.max(1, options.leaderboardLimit ?? 12));
  const maxCandidates = Math.max(1, options.maxCandidates ?? 24);
  const maxClosedPositions = Math.max(10, options.maxClosedPositions ?? 100);
  const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 3));

  const leaderboardPages = await Promise.all(categories.map((category) =>
    dataApi.leaderboard({ category, timePeriod: "ALL", orderBy: "PNL", limit: leaderboardLimit })
  ));

  const byWallet = new Map();
  for (const entry of leaderboardPages.flat()) {
    const existing = byWallet.get(entry.proxyWallet) ?? { wallet: entry.proxyWallet, leaderboardEntries: [] };
    existing.leaderboardEntries.push(entry);
    byWallet.set(entry.proxyWallet, existing);
  }

  const candidates = [...byWallet.values()]
    .sort((a, b) => {
      const aBest = Math.min(...a.leaderboardEntries.map((entry) => entry.rank));
      const bBest = Math.min(...b.leaderboardEntries.map((entry) => entry.rank));
      const aPnl = Math.max(...a.leaderboardEntries.map((entry) => entry.pnl));
      const bPnl = Math.max(...b.leaderboardEntries.map((entry) => entry.pnl));
      return aBest - bBest || bPnl - aPnl;
    })
    .slice(0, maxCandidates);

  const scored = await mapWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const [closedPositions, tradedCount] = await Promise.all([
        dataApi.closedPositions(candidate.wallet, { maxPositions: maxClosedPositions }),
        dataApi.tradedCount(candidate.wallet)
      ]);
      const score = scoreWallet({
        wallet: candidate.wallet,
        leaderboardEntries: candidate.leaderboardEntries,
        closedPositions,
        tradedCount
      });
      const profile = candidate.leaderboardEntries.find((entry) => entry.userName) ?? candidate.leaderboardEntries[0];
      return {
        ...score,
        userName: profile?.userName ?? "",
        profileImage: profile?.profileImage ?? "",
        xUsername: profile?.xUsername ?? "",
        verifiedBadge: Boolean(profile?.verifiedBadge)
      };
    } catch (error) {
      return {
        wallet: candidate.wallet,
        score: 0,
        eligible: false,
        rejectionReasons: ["data-fetch-failed"],
        error: error instanceof Error ? error.message : String(error),
        categories: candidate.leaderboardEntries.map((entry) => entry.category)
      };
    }
  });

  const eligible = scored.filter((wallet) => wallet.eligible).sort((a, b) => b.score - a.score);
  const rejected = scored.filter((wallet) => !wallet.eligible).sort((a, b) => b.score - a.score);
  return {
    generatedAt: new Date().toISOString(),
    categories,
    candidatesEvaluated: scored.length,
    eligible,
    rejected,
    recommended: eligible.slice(0, options.recommendedCount ?? 20)
  };
}
