import { Dec } from "./decimal.js";
import { ClobClient } from "./clients/clob.js";
import { GammaEventsClient } from "./clients/gamma-events.js";
import { findMultiOutcomeOpportunity, validateMultiOutcomeEvent } from "./strategy/multi-outcome.js";

export class MultiOutcomeScanner {
  constructor(config) {
    this.config = config;
    this.gamma = new GammaEventsClient(config.gammaBaseUrl, config.requestTimeoutMs);
    this.clob = new ClobClient(config.clobBaseUrl, config.requestTimeoutMs);
  }

  async scan() {
    const nowMs = Date.now();
    const maxEvents = Math.max(1, Math.min(100, this.config.maxMultiOutcomeEvents ?? 50));
    const events = await this.gamma.listActiveNegRiskEvents(maxEvents, Math.min(50, maxEvents));
    const validEvents = [];
    const skipped = {};
    const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

    for (const event of events) {
      const validation = validateMultiOutcomeEvent(event);
      if (validation.valid) validEvents.push(event);
      else for (const reason of validation.reasons) skip(reason.split(":")[0]);
    }

    const tokenIds = validEvents.flatMap((event) => event.markets.map((market) => market.yesTokenId));
    const books = await this.clob.getOrderBooks(tokenIds, this.config.bookBatchSize);
    const opportunities = [];

    for (const event of validEvents) {
      const topCost = event.markets.reduce((sum, market) => {
        const ask = books.get(market.yesTokenId)?.asks?.[0]?.price;
        return ask ? sum.plus(ask) : sum.plus(2);
      }, new Dec(0));
      if (topCost.gte(1)) {
        skip("no-gross-edge");
        continue;
      }

      const feeSchedules = new Map();
      let feeError = false;
      for (const market of event.markets) {
        try {
          feeSchedules.set(market.conditionId, await this.resolveFeeSchedule(market));
        } catch {
          feeError = true;
          break;
        }
      }
      if (feeError) {
        skip("fee-schedule-error");
        continue;
      }

      const result = findMultiOutcomeOpportunity(event, books, feeSchedules, {
        nowMs,
        maxShares: this.config.maxShares,
        minNetProfitUsd: this.config.minNetProfitUsd,
        minRoiBps: this.config.minRoiBps,
        safetyBufferBps: this.config.safetyBufferBps,
        fixedCostUsd: this.config.fixedCostUsd,
        maxBookAgeMs: this.config.maxBookAgeMs
      });
      if (result.opportunity) opportunities.push(result.opportunity);
      else skip("fails-net-threshold");
    }

    opportunities.sort((a, b) => b.netProfit.comparedTo(a.netProfit));
    return {
      scannedAt: new Date(nowMs).toISOString(),
      eventsDiscovered: events.length,
      eventsValidated: validEvents.length,
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
