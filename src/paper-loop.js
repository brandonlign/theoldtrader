import { loadConfig } from "./config.js";
import { PaperSimulationRunner } from "./paper/runner.js";

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function summarize(result) {
  const executions = result.executions ?? [];
  const counts = executions.reduce((accumulator, execution) => {
    const status = execution.status ?? "UNKNOWN";
    accumulator[status] = (accumulator[status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    scannedAt: result.scannedAt,
    detected: result.detected ?? 0,
    executionCounts: counts,
    cash: result.portfolio?.cash ?? null,
    realizedPnl: result.portfolio?.realizedPnl ?? null,
    openPositions: Object.values(result.portfolio?.positions ?? {}).filter((position) => Number(position.shares) !== 0).length,
    strategyErrors: (result.strategyErrors ?? []).filter(Boolean)
  };
}

async function main() {
  const config = loadConfig();
  if (!config.paperEnabled) {
    throw new Error("Paper simulation is disabled. Start with THEOLDTRADER_PAPER_ENABLED=true npm run paper:run");
  }

  const intervalMs = Math.max(15_000, numberEnv("THEOLDTRADER_PAPER_INTERVAL_MS", 60_000));
  const runner = new PaperSimulationRunner(config);
  let stopping = false;

  const stop = () => {
    stopping = true;
    process.stderr.write("\nTheOldTrader will stop after the current paper pass.\n");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stderr.write(`TheOldTrader paper simulation started. Interval: ${intervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const result = await runner.runOnce();
      process.stdout.write(`${JSON.stringify(summarize(result))}\n`);
    } catch (error) {
      process.stderr.write(`Paper pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    if (stopping) break;
    const remaining = Math.max(0, intervalMs - (Date.now() - startedAt));
    await sleep(remaining);
  }
}

main().catch((error) => {
  process.stderr.write(`TheOldTrader error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
