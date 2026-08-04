import { ClobClient } from "./clients/clob.js";
import { DataApiClient } from "./clients/data-api.js";
import { loadConfig } from "./config.js";
import { MultiOutcomeScanner } from "./multi-outcome-scanner.js";
import { attachHealth } from "./monitoring/health.js";
import { PaperSimulationRunner } from "./paper/runner.js";
import { StructuralArbitrageScanner } from "./scanner.js";
import { loadWhaleConfig } from "./whales/config.js";
import { discoverWhales } from "./whales/discovery.js";
import { loadWhaleState, saveWhaleState } from "./whales/local-store.js";
import { WhaleMonitor } from "./whales/monitor.js";

async function rankWhales() {
  const config = loadWhaleConfig();
  const dataApi = new DataApiClient(config.dataApiBaseUrl, config.requestTimeoutMs);
  const result = await discoverWhales(dataApi, {
    categories: ["OVERALL", "POLITICS", "CRYPTO", "FINANCE", "ECONOMICS", "TECH"],
    leaderboardLimit: 12,
    maxCandidates: 24,
    maxClosedPositions: 100,
    recommendedCount: 20,
    concurrency: 3
  });
  console.log(JSON.stringify(result, null, 2));
}

async function observeWhales() {
  const config = loadWhaleConfig();
  if (!config.enabled) {
    throw new Error("Whale monitoring is disabled. Set MONEYMOG_WHALE_MONITOR_ENABLED=true only when you are ready to begin observation.");
  }
  if (config.wallets.length === 0) {
    throw new Error("No whale wallets configured. Set MONEYMOG_WHALE_WALLETS to a JSON array of ranked wallets.");
  }
  const state = await loadWhaleState(config.statePath);
  const monitor = new WhaleMonitor({
    dataApi: new DataApiClient(config.dataApiBaseUrl, config.requestTimeoutMs),
    clob: new ClobClient(config.clobBaseUrl, config.requestTimeoutMs),
    config
  });
  const startedAt = new Date().toISOString();
  const rawResult = await monitor.observeOnce(config.wallets, state);
  const result = attachHealth(rawResult, startedAt, { persistenceSucceeded: true });
  await saveWhaleState(config.statePath, result.state);
  const output = { ...result };
  delete output.state;
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const command = process.argv[2] ?? "scan";

  if (command === "whales-rank") {
    await rankWhales();
    return;
  }
  if (command === "whales-observe") {
    await observeWhales();
    return;
  }

  const config = loadConfig();
  if (command === "multi-scan") {
    console.log(JSON.stringify(await new MultiOutcomeScanner(config).scan(), null, 2));
    return;
  }
  if (command === "scan-all") {
    const [binary, multiOutcome] = await Promise.all([
      new StructuralArbitrageScanner(config).scan(),
      new MultiOutcomeScanner(config).scan()
    ]);
    console.log(JSON.stringify({ binary, multiOutcome }, null, 2));
    return;
  }
  if (command === "paper-once") {
    console.log(JSON.stringify(await new PaperSimulationRunner(config).runOnce(), null, 2));
    return;
  }

  if (command === "scan") {
    console.log(JSON.stringify(await new StructuralArbitrageScanner(config).scan(), null, 2));
    return;
  }

  throw new Error("Unknown command. Use scan, multi-scan, scan-all, paper-once, whales-rank, or whales-observe.");
}

main().catch((error) => {
  process.stderr.write(`MoneyMog error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
