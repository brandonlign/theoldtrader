import { Dec } from "../decimal.js";

/** Local accounting only. No wallet, signing, or order-submission code exists. */
export class PaperBroker {
  constructor(startingCash) {
    this.cash = Dec.from(startingCash);
    if (this.cash.lte(0)) throw new Error("Paper starting cash must be positive");
    this.realizedPnl = new Dec(0);
    this.fills = [];
    this.processed = new Set();
  }

  execute(opportunity, now = new Date()) {
    if (this.processed.has(opportunity.id)) {
      throw new Error(`Opportunity ${opportunity.id} was already paper-filled`);
    }
    if (opportunity.netProfit.lte(0)) throw new Error("Cannot paper-fill a non-profitable opportunity");

    const capitalRequired = opportunity.grossCost
      .plus(opportunity.fees)
      .plus(opportunity.safetyBuffer)
      .plus(opportunity.fixedCosts);
    if (this.cash.lt(capitalRequired)) {
      throw new Error(`Insufficient paper cash: need ${capitalRequired}, have ${this.cash}`);
    }

    const cashBefore = this.cash;
    this.cash = this.cash.plus(opportunity.netProfit);
    this.realizedPnl = this.realizedPnl.plus(opportunity.netProfit);
    this.processed.add(opportunity.id);
    const fill = {
      opportunityId: opportunity.id,
      filledAt: now.toISOString(),
      direction: opportunity.direction,
      shares: opportunity.shares,
      cashBefore,
      cashAfter: this.cash,
      realizedProfit: opportunity.netProfit
    };
    this.fills.push(fill);
    return fill;
  }

  snapshot() {
    return { cash: this.cash, realizedPnl: this.realizedPnl, fills: [...this.fills] };
  }
}
