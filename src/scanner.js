import { Dec } from "./decimal.js";
import { ClobClient } from "./clients/clob.js";
import { GammaClient } from "./clients/gamma.js";
import { findCompleteSetOpportunities } from "./strategy/complete-set.js";

export class StructuralArbitrageScanner {
  constructor(config) {
    this.config = config;
    this.gamma = new GammaClient(config.gammaBaseUrl, config.requestTimeoutMs);
    this.clob = new ClobClient(config.clobBaseUrl, config.requestTimeoutMs);
  }

  async scan() {
    const nowMs = Date.now();
    const markets = await this.gamma.listActiveBinaryMarkets(this.config.maxMarkets, this.config.marketPageSize);
    const tokenIds = markets.flatMap((market) => [market.yesTokenId, market.noTokenId]);
    const books = await this.clob.getOrderBooks(tokenIds, this.config.bookBatchSize);

    const skipped = {};
    const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
    const opportunities = [];
    let marketsWithBooks = 0;

    for (const market of markets) {
      const yesBook = books.get(market.yesTokenId);
      const noBook = books.get(market.noTokenId);
      if (!yesBook || !noBook) {
        skip("missing-book");
        continue;
      }
      marketsWithBooks += 1;

      const buyGrossEdge = yesBook.asks[0] && noBook.asks[0]
        ? new Dec(1).minus(yesBook.asks[0].price.plus(noBook.asks[0].price))
        : new Dec(-1);
      const sellGrossEdge = yesBook.bids[0] && noBook.bids[0]
        ? yesBook.bids[0].price.plus(noBook.bids[0].price).minus(1)
        : new Dec(-1);
      if (buyGrossEdge.lte(0) && sellGrossEdge.lte(0)) {
        skip("no-gross-edge");
        continue;
      }

      let feeSchedule;
      try {
        feeSchedule = await this.resolveFeeSchedule(market);
      } catch {
        skip("fee-schedule-error");
        continue;
      }

      const found = findCompleteSetOpportunities(market, yesBook, noBook, feeSchedule, {
        nowMs,
        maxShares: this.config.maxShares,
        minNetProfitUsd: this.config.minNetProfitUsd,
        minRoiBps: this.config.minRoiBps,
        safetyBufferBps: this.config.safetyBufferBps,
        fixedCostUsd: this.config.fixedCostUsd,
        maxBookAgeMs: this.config.maxBookAgeMs
      });
      if (found.length === 0) skip("fails-net-threshold");
      opportunities.push(...found);
    }

    opportunities.sort((a, b) => b.netProfit.comparedTo(a.netProfit));
    return {
      scannedAt: new Date(nowMs).toISOString(),
      marketsDiscovered: markets.length,
      marketsWithBooks,
      opportunities,
      skipped
    };
  }

  async resolveFeeSchedule(market) {
    try {
      return await this.clob.getFeeSchedule(market.conditionId);
    } catch (error) {
      if (market.feeSchedule) return market.feeSchedule;
      if (!market.feesEnabled) return { rate: new Dec(0), exponent: 2, takerOnly: true };
      throw error;
    }
  }
}
