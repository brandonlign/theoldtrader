import { loadConfig } from "./config.js";
import { PaperBroker } from "./paper/paper-broker.js";
import { StructuralArbitrageScanner } from "./scanner.js";

async function main() {
  const command = process.argv[2] ?? "scan";
  const config = loadConfig();
  const scanner = new StructuralArbitrageScanner(config);

  if (command === "scan") {
    console.log(JSON.stringify(await scanner.scan(), null, 2));
    return;
  }

  if (command === "paper-once") {
    if (!config.paperEnabled) {
      throw new Error(
        "Paper execution is disabled. Set MONEYMOG_PAPER_ENABLED=true only when you are ready to begin the simulation."
      );
    }
    const result = await scanner.scan();
    const broker = new PaperBroker(config.paperStartingCash);
    for (const opportunity of result.opportunities) {
      try { broker.execute(opportunity); } catch { /* bankroll or duplicate guard */ }
    }
    console.log(JSON.stringify({ scan: result, portfolio: broker.snapshot() }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}. Use "scan" or "paper-once".`);
}

main().catch((error) => {
  process.stderr.write(`MoneyMog error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
