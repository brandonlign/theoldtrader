import { ClobClient } from "../clients/clob.js";
import { MultiOutcomeScanner } from "../multi-outcome-scanner.js";
import { StructuralArbitrageScanner } from "../scanner.js";
import { applyPaperExecution } from "./portfolio.js";
import { simulateMultiOutcomeExecution } from "./multi-outcome-simulator.js";
import { simulateCompleteSetExecution } from "./realistic-simulator.js";
import { JsonPaperStore } from "./state-store.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

export class PaperSimulationRunner {
  constructor(config) {
    this.config = config;
    this.binaryScanner = new StructuralArbitrageScanner(config);
    this.multiScanner = new MultiOutcomeScanner(config);
    this.clob = new ClobClient(config.clobBaseUrl, config.requestTimeoutMs);
    this.store = new JsonPaperStore(config.paperStatePath, config.paperStartingCash);
  }

  async runOnce() {
    if (!this.config.paperEnabled) {
      throw new Error("Paper simulation is disabled. Set MONEYMOG_PAPER_ENABLED=true only when you are ready to begin.");
    }

    const scanResults = await Promise.allSettled([
      this.binaryScanner.scan(),
      this.multiScanner.scan()
    ]);
    const binary = scanResults[0].status === "fulfilled" ? scanResults[0].value : { opportunities: [] };
    const multi = scanResults[1].status === "fulfilled" ? scanResults[1].value : { opportunities: [] };
    const opportunities = [
      ...(binary.opportunities ?? []),
      ...(multi.opportunities ?? [])
    ].sort((a, b) => Number(b.netProfit) - Number(a.netProfit)).slice(0, 20);

    let portfolio = await this.store.load();
    if (!opportunities.length) {
      return {
        scannedAt: new Date().toISOString(),
        detected: 0,
        executions: [],
        portfolio,
        strategyErrors: scanResults.map((result) => result.status === "rejected" ? String(result.reason?.message ?? result.reason) : null)
      };
    }

    await sleep(this.config.paperExecutionDelayMs);
    const tokenIds = [...new Set(opportunities.flatMap((opportunity) =>
      opportunity.strategy === "MULTI_OUTCOME_COMPLETE_SET"
        ? opportunity.legs.map((leg) => leg.tokenId)
        : [opportunity.yesLeg.tokenId, opportunity.noLeg.tokenId]))];
    const books = await this.clob.getOrderBooks(tokenIds, this.config.bookBatchSize);
    const feeCache = new Map();
    const executions = [];

    for (const opportunity of opportunities) {
      if (portfolio.executions?.[opportunity.id]) {
        executions.push({ id: opportunity.id, status: "DUPLICATE_SKIPPED" });
        continue;
      }

      try {
        let execution;
        const commonOptions = {
          executionDelayMs: this.config.paperExecutionDelayMs,
          liquidityHaircut: this.config.paperLiquidityHaircut,
          minPairedFillRatio: this.config.paperMinPairedFillRatio,
          maxBookAgeMs: this.config.maxBookAgeMs,
          fixedCostUsd: this.config.fixedCostUsd
        };

        if (opportunity.strategy === "MULTI_OUTCOME_COMPLETE_SET") {
          const legs = [];
          for (const leg of opportunity.legs) {
            if (!feeCache.has(leg.conditionId)) {
              feeCache.set(leg.conditionId, await this.clob.getFeeSchedule(leg.conditionId));
            }
            legs.push({
              tokenId: leg.tokenId,
              label: leg.label,
              book: books.get(leg.tokenId),
              feeSchedule: feeCache.get(leg.conditionId)
            });
          }
          execution = simulateMultiOutcomeExecution({
            id: opportunity.id,
            detectedAt: opportunity.detectedAt,
            executedAt: Date.now(),
            shares: opportunity.shares,
            legs
          }, commonOptions);
        } else {
          execution = simulateCompleteSetExecution({
            id: opportunity.id,
            strategy: "BINARY_COMPLETE_SET",
            direction: opportunity.direction,
            detectedAt: opportunity.detectedAt,
            executedAt: Date.now(),
            shares: opportunity.shares,
            yesTokenId: opportunity.yesLeg.tokenId,
            noTokenId: opportunity.noLeg.tokenId,
            yesBook: books.get(opportunity.yesLeg.tokenId),
            noBook: books.get(opportunity.noLeg.tokenId),
            feeSchedule: opportunity.feeSchedule
          }, commonOptions);
        }

        portfolio = applyPaperExecution(portfolio, execution);
        executions.push(execution);
      } catch (error) {
        executions.push({
          id: opportunity.id,
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await this.store.save(portfolio);
    return {
      scannedAt: new Date().toISOString(),
      detected: opportunities.length,
      executionDelayMs: this.config.paperExecutionDelayMs,
      executions,
      portfolio,
      strategyErrors: scanResults.map((result) => result.status === "rejected" ? String(result.reason?.message ?? result.reason) : null)
    };
  }
}
