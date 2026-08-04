import { ClobClient } from "../src/clients/clob.js";
import { DataApiClient } from "../src/clients/data-api.js";
import { allocateHero } from "../src/hero-allocator.js";
import { MultiOutcomeScanner } from "../src/multi-outcome-scanner.js";
import { simulateMultiOutcomeExecution } from "../src/paper/multi-outcome-simulator.js";
import { simulateCompleteSetExecution, simulateDirectionalExecution } from "../src/paper/realistic-simulator.js";
import { StructuralArbitrageScanner } from "../src/scanner.js";
import { WhaleMonitor } from "../src/whales/monitor.js";
import { D1WhaleStore } from "./d1-store.js";
import { HostedPaperStore } from "./hosted-store.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function authorized(request, env) {
  if (!env.API_TOKEN) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${env.API_TOKEN}`;
}

function parseWallets(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { parsed = raw.split(",").map((wallet) => ({ wallet: wallet.trim(), score: 70 })); }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => typeof item === "string" ? { wallet: item, score: 70 } : item)
    .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(String(item.wallet ?? "")))
    .map((item) => ({ ...item, wallet: String(item.wallet).toLowerCase(), score: finite(item.score, 70) }));
}

function rotatingWalletBatch(wallets, rotationRun, batchSize) {
  if (!wallets.length) return [];
  const size = Math.max(1, Math.min(wallets.length, Math.trunc(finite(batchSize, 2))));
  const start = (Math.trunc(finite(rotationRun, 0)) * size) % wallets.length;
  return Array.from({ length: Math.min(size, wallets.length) }, (_, index) => wallets[(start + index) % wallets.length]);
}

function scanConfig(env, rotation) {
  const marketBatch = Math.max(5, Math.min(60, Math.trunc(finite(env.MARKET_BATCH_SIZE, 30))));
  const eventBatch = Math.max(1, Math.min(10, Math.trunc(finite(env.EVENT_BATCH_SIZE, 5))));
  return {
    gammaBaseUrl: env.GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
    dataApiBaseUrl: env.DATA_API_BASE_URL ?? "https://data-api.polymarket.com",
    clobBaseUrl: env.CLOB_BASE_URL ?? "https://clob.polymarket.com",
    requestTimeoutMs: finite(env.REQUEST_TIMEOUT_MS, 10_000),
    maxMarkets: marketBatch,
    marketStartOffset: Math.max(0, Math.trunc(finite(rotation.marketOffset, 0))),
    marketPageSize: Math.min(30, marketBatch),
    maxMultiOutcomeEvents: eventBatch,
    eventStartOffset: Math.max(0, Math.trunc(finite(rotation.eventOffset, 0))),
    bookBatchSize: Math.max(20, Math.min(100, Math.trunc(finite(env.BOOK_BATCH_SIZE, 80)))),
    maxShares: finite(env.MAX_SHARES, 500),
    minNetProfitUsd: finite(env.MIN_NET_PROFIT_USD, 0.05),
    minRoiBps: finite(env.MIN_ROI_BPS, 8),
    safetyBufferBps: finite(env.SAFETY_BUFFER_BPS, 15),
    fixedCostUsd: finite(env.FIXED_COST_USD, 0),
    maxBookAgeMs: finite(env.MAX_BOOK_AGE_MS, 15_000)
  };
}

function monitorConfig(env) {
  return {
    tradeLookback: Math.max(20, Math.min(150, Math.trunc(finite(env.WHALE_TRADE_LOOKBACK, 80)))),
    maxNewTradesPerWallet: Math.max(1, Math.min(5, Math.trunc(finite(env.WHALE_MAX_NEW_TRADES, 3)))),
    seenKeyLimit: 500,
    recentSignalLimit: 500,
    bookBatchSize: Math.max(20, Math.min(100, Math.trunc(finite(env.BOOK_BATCH_SIZE, 80)))),
    minWhaleTradeUsd: finite(env.WHALE_MIN_TRADE_USD, 100),
    minRelativeConviction: finite(env.WHALE_MIN_RELATIVE_SIZE, 0.5),
    minWalletScore: finite(env.WHALE_MIN_SCORE, 70),
    maxDetectionDelaySeconds: finite(env.WHALE_MAX_DELAY_SECONDS, 180),
    maxOppositeTurnoverRatio: finite(env.WHALE_MAX_CHURN, 0.45),
    copyFraction: finite(env.WHALE_COPY_FRACTION, 0.01),
    minCopyUsd: finite(env.WHALE_MIN_COPY_USD, 10),
    maxCopyUsd: finite(env.WHALE_MAX_COPY_USD, 75),
    maxPriceDeterioration: finite(env.WHALE_MAX_PRICE_MOVE, 0.015),
    maxEntryPrice: finite(env.WHALE_MAX_ENTRY_PRICE, 0.85),
    maxBookAgeMs: finite(env.MAX_BOOK_AGE_MS, 15_000),
    requiredConsensus: Math.max(1, Math.trunc(finite(env.WHALE_REQUIRED_CONSENSUS, 1)))
  };
}

function heroConfig(env) {
  return {
    maxRunAllocationPct: finite(env.HERO_MAX_RUN_ALLOCATION_PCT, 0.12),
    structuralBudgetShare: finite(env.HERO_STRUCTURAL_BUDGET_SHARE, 0.9),
    whaleBudgetShare: finite(env.HERO_WHALE_BUDGET_SHARE, 0.1),
    maxOpportunityPct: finite(env.HERO_MAX_OPPORTUNITY_PCT, 0.04),
    maxMarketExposurePct: finite(env.HERO_MAX_MARKET_EXPOSURE_PCT, 0.08),
    maxCategoryExposurePct: finite(env.HERO_MAX_CATEGORY_EXPOSURE_PCT, 0.12),
    maxWhaleTradePct: finite(env.HERO_MAX_WHALE_TRADE_PCT, 0.0075),
    maxWhaleTotalExposurePct: finite(env.HERO_MAX_WHALE_TOTAL_EXPOSURE_PCT, 0.025),
    minStructuralRoiBps: finite(env.MIN_ROI_BPS, 8),
    minStructuralNetProfitUsd: finite(env.MIN_NET_PROFIT_USD, 0.05),
    minWhaleScore: finite(env.WHALE_MIN_SCORE, 70),
    minForwardRoi: finite(env.WHALE_MIN_FORWARD_ROI, 0),
    minProfitableFoldRate: finite(env.WHALE_MIN_PROFITABLE_FOLD_RATE, 0.6),
    maxWhaleDelaySeconds: finite(env.WHALE_MAX_DELAY_SECONDS, 180),
    maxWhaleSlippageBps: finite(env.WHALE_MAX_SLIPPAGE_BPS, 125),
    minWhaleLiquidityUsd: finite(env.WHALE_MIN_LIQUIDITY_USD, 50),
    minLiquidityCoverage: finite(env.WHALE_MIN_LIQUIDITY_COVERAGE, 2),
    maxWhaleEntryPrice: finite(env.WHALE_MAX_ENTRY_PRICE, 0.85)
  };
}

function normalizeStructural(opportunity, strategy) {
  const item = plain(opportunity);
  const capitalRequired = finite(item.grossCost, strategy === "MULTI_OUTCOME_COMPLETE_SET" ? 0 : finite(item.shares, 0));
  return {
    ...item,
    strategy,
    marketKey: String(item.conditionId ?? item.eventId ?? item.slug ?? item.id),
    category: "structural",
    capitalRequired,
    stable: true
  };
}

function walletEvidence(wallet, category) {
  const walkForward = wallet.walkForward ?? wallet.forwardEvidence ?? {};
  return walkForward[category] ?? walkForward.OVERALL ?? walkForward;
}

function normalizeWhaleSignal(signal, wallet) {
  return {
    ...plain(signal),
    id: `whale:${signal.id}`,
    strategy: "WHALE_COPY",
    marketKey: String(signal.conditionId ?? signal.asset ?? signal.id),
    tokenId: signal.asset,
    price: signal.copyAveragePrice,
    availableLiquidityUsd: finite(signal.availableLiquidityUsd, 0),
    walkForward: walletEvidence(wallet ?? {}, signal.category),
    walkForwardEligible: Boolean(walletEvidence(wallet ?? {}, signal.category)?.eligible),
    walletScore: signal.effectiveWalletScore,
    capitalRequired: finite(signal.estimatedCost, 0)
  };
}

async function observeWhales(env, rotation) {
  if (!bool(env.WHALE_MONITOR_ENABLED)) return { signals: [], summary: { skipped: true, reason: "whale-monitor-disabled" } };
  const allWallets = parseWallets(env.WHALE_WALLETS);
  const wallets = rotatingWalletBatch(allWallets, rotation.run, env.WHALE_BATCH_SIZE);
  if (!wallets.length) return { signals: [], summary: { skipped: true, reason: "no-wallets-configured" } };

  const store = new D1WhaleStore(env.DB);
  const state = await store.load(wallets);
  const monitor = new WhaleMonitor({
    dataApi: new DataApiClient(env.DATA_API_BASE_URL ?? "https://data-api.polymarket.com", finite(env.REQUEST_TIMEOUT_MS, 10_000)),
    clob: new ClobClient(env.CLOB_BASE_URL ?? "https://clob.polymarket.com", finite(env.REQUEST_TIMEOUT_MS, 10_000)),
    config: monitorConfig(env)
  });
  const raw = await monitor.observeOnce(wallets, state);
  await store.save(raw, new Date().toISOString());
  const walletByAddress = new Map(wallets.map((wallet) => [wallet.wallet, wallet]));
  const signals = raw.signals
    .filter((signal) => signal.decision === "COPY_CANDIDATE")
    .map((signal) => normalizeWhaleSignal(signal, walletByAddress.get(signal.wallet)));
  return {
    signals,
    summary: {
      walletsConfigured: allWallets.length,
      walletsChecked: wallets.length,
      baselined: raw.baselined.length,
      newTrades: raw.newTrades,
      candidates: signals.length,
      rejected: raw.signals.length - signals.length,
      errors: raw.errors
    }
  };
}

async function enrichWhaleLiquidity(env, signals) {
  if (!signals.length) return signals;
  const clob = new ClobClient(env.CLOB_BASE_URL ?? "https://clob.polymarket.com", finite(env.REQUEST_TIMEOUT_MS, 10_000));
  const tokenIds = [...new Set(signals.map((signal) => signal.tokenId).filter(Boolean))];
  const books = await clob.getOrderBooks(tokenIds, Math.max(20, Math.min(100, Math.trunc(finite(env.BOOK_BATCH_SIZE, 80)))));
  const now = Date.now();
  return signals.map((signal) => {
    const book = books.get(signal.tokenId);
    const availableLiquidityUsd = (book?.asks ?? []).reduce((sum, level) => sum + finite(level.price, 0) * finite(level.size, 0), 0);
    const ageMs = Math.max(0, now - finite(book?.timestampMs, now));
    const reasons = [...(signal.reasons ?? [])];
    if (!book?.asks?.length) reasons.push("missing-live-ask-before-allocation");
    if (ageMs > finite(env.MAX_BOOK_AGE_MS, 15_000)) reasons.push("stale-book-before-allocation");
    return { ...signal, availableLiquidityUsd, liveBookAgeMs: ageMs, reasons };
  });
}

async function scanStrategies(env, rotation) {
  const config = scanConfig(env, rotation);
  const [binaryResult, multiResult] = await Promise.allSettled([
    new StructuralArbitrageScanner(config).scan(),
    new MultiOutcomeScanner(config).scan()
  ]);
  const errors = [];
  if (binaryResult.status === "rejected") errors.push(`binary: ${String(binaryResult.reason?.message ?? binaryResult.reason)}`);
  if (multiResult.status === "rejected") errors.push(`multi: ${String(multiResult.reason?.message ?? multiResult.reason)}`);
  const binary = binaryResult.status === "fulfilled" ? binaryResult.value : { opportunities: [] };
  const multi = multiResult.status === "fulfilled" ? multiResult.value : { opportunities: [] };
  return {
    candidates: [
      ...(binary.opportunities ?? []).map((item) => normalizeStructural(item, "BINARY_COMPLETE_SET")),
      ...(multi.opportunities ?? []).map((item) => normalizeStructural(item, "MULTI_OUTCOME_COMPLETE_SET"))
    ],
    summary: {
      binaryMarkets: binary.marketsDiscovered ?? 0,
      binaryBooks: binary.marketsWithBooks ?? 0,
      multiEvents: multi.eventsDiscovered ?? 0,
      multiValidated: multi.eventsValidated ?? 0,
      binarySkipped: binary.skipped ?? {},
      multiSkipped: multi.skipped ?? {},
      errors
    }
  };
}

function scaledShares(candidate, allocatedCapital) {
  const originalShares = Math.max(0, finite(candidate.shares ?? candidate.copyShares, 0));
  const originalCapital = Math.max(0, finite(candidate.capitalRequired ?? candidate.estimatedCost ?? candidate.grossCost, 0));
  if (originalCapital <= 0) return 0;
  return originalShares * Math.min(1, allocatedCapital / originalCapital);
}

async function executeSelected(env, decisions) {
  const selected = decisions.filter((item) => item.selected);
  if (!selected.length) return [];
  const delayMs = Math.max(500, Math.min(10_000, finite(env.PAPER_EXECUTION_DELAY_MS, 2_000)));
  await sleep(delayMs);

  const clob = new ClobClient(env.CLOB_BASE_URL ?? "https://clob.polymarket.com", finite(env.REQUEST_TIMEOUT_MS, 10_000));
  const tokenIds = [...new Set(selected.flatMap((decision) => {
    const item = decision.candidate;
    if (decision.strategy === "MULTI_OUTCOME_COMPLETE_SET") return (item.legs ?? []).map((leg) => leg.tokenId);
    if (decision.strategy === "WHALE_COPY") return [item.tokenId ?? item.asset];
    return [item.yesLeg?.tokenId, item.noLeg?.tokenId];
  }).filter(Boolean))];
  const books = await clob.getOrderBooks(tokenIds, Math.max(20, Math.min(100, Math.trunc(finite(env.BOOK_BATCH_SIZE, 80)))));
  const feeCache = new Map();
  const executions = [];
  const options = {
    executionDelayMs: delayMs,
    liquidityHaircut: finite(env.PAPER_LIQUIDITY_HAIRCUT, 0.75),
    minPairedFillRatio: finite(env.PAPER_MIN_PAIRED_FILL_RATIO, 0.92),
    maxBookAgeMs: finite(env.MAX_BOOK_AGE_MS, 15_000),
    fixedCostUsd: finite(env.FIXED_COST_USD, 0)
  };

  for (const decision of selected) {
    const item = decision.candidate;
    try {
      const shares = scaledShares(item, decision.allocatedCapital);
      let execution;
      if (decision.strategy === "MULTI_OUTCOME_COMPLETE_SET") {
        const legs = [];
        for (const leg of item.legs ?? []) {
          if (!feeCache.has(leg.conditionId)) feeCache.set(leg.conditionId, await clob.getFeeSchedule(leg.conditionId));
          legs.push({ tokenId: leg.tokenId, label: leg.label, book: books.get(leg.tokenId), feeSchedule: feeCache.get(leg.conditionId) });
        }
        execution = simulateMultiOutcomeExecution({
          id: item.id,
          detectedAt: item.detectedAt,
          executedAt: Date.now(),
          shares,
          legs
        }, options);
      } else if (decision.strategy === "WHALE_COPY") {
        if (!feeCache.has(item.conditionId)) feeCache.set(item.conditionId, await clob.getFeeSchedule(item.conditionId));
        execution = simulateDirectionalExecution({
          id: item.id,
          strategy: "WHALE_COPY",
          detectedAt: item.detectedAt,
          executedAt: Date.now(),
          tokenId: item.tokenId ?? item.asset,
          side: "BUY",
          shares,
          book: books.get(item.tokenId ?? item.asset),
          feeSchedule: feeCache.get(item.conditionId),
          limitPrice: item.copyWorstPrice ?? item.copyAveragePrice
        }, options);
      } else {
        execution = simulateCompleteSetExecution({
          id: item.id,
          strategy: "BINARY_COMPLETE_SET",
          direction: item.direction,
          detectedAt: item.detectedAt,
          executedAt: Date.now(),
          shares,
          yesTokenId: item.yesLeg.tokenId,
          noTokenId: item.noLeg.tokenId,
          yesBook: books.get(item.yesLeg.tokenId),
          noBook: books.get(item.noLeg.tokenId),
          feeSchedule: item.feeSchedule
        }, options);
      }
      executions.push({ decision, execution: plain(execution) });
    } catch (error) {
      executions.push({
        decision,
        execution: {
          id: String(item.id), strategy: decision.strategy, status: "ERROR",
          detectedAt: item.detectedAt, executedAt: new Date().toISOString(),
          reasons: [error instanceof Error ? error.message : String(error)],
          capitalRequired: decision.allocatedCapital, cashDelta: 0
        }
      });
    }
  }
  return executions;
}

export async function runHostedCycle(env) {
  const store = new HostedPaperStore(env.DB);
  const startingCash = finite(env.PAPER_STARTING_CASH, 10_000);
  await store.ensurePortfolio(startingCash);
  const enabled = bool(env.PAPER_SIMULATION_ENABLED);
  const rotation = await store.rotation();
  const runId = crypto.randomUUID();
  await store.startRun({ id: runId, status: enabled ? "RUNNING" : "PAUSED", enabled, rotation });

  if (!enabled) {
    const summary = { status: "PAUSED", health: "PAUSED", reason: "paper-simulation-disabled", opportunities: 0, selected: 0, executions: 0, errors: [] };
    await store.finishRun(runId, summary);
    return { runId, ...summary };
  }

  const errors = [];
  try {
    const [strategyResult, whaleResult] = await Promise.all([
      scanStrategies(env, rotation),
      observeWhales(env, rotation)
    ]);
    errors.push(...(strategyResult.summary.errors ?? []), ...(whaleResult.summary.errors ?? []).map((item) => item.error ?? String(item)));
    const whaleCandidates = await enrichWhaleLiquidity(env, whaleResult.signals);
    const candidates = [...strategyResult.candidates, ...whaleCandidates].slice(0, 40);
    await store.saveOpportunities(runId, candidates);

    const portfolio = await store.loadPortfolio(startingCash);
    const allocation = allocateHero({
      portfolio,
      exposures: portfolio.positions,
      executedKeys: await store.executedKeys(),
      candidates,
      config: heroConfig(env)
    });
    await store.saveDecisions(runId, allocation.decisions);

    const executionPairs = await executeSelected(env, allocation.decisions);
    for (const pair of executionPairs) {
      if (await store.hasExecution(pair.execution.id)) continue;
      await store.recordExecution(runId, pair.decision, pair.execution);
      if (pair.execution.status === "ERROR") errors.push(...(pair.execution.reasons ?? ["execution-error"]));
    }

    await store.advanceRotation(rotation, {
      marketBatch: scanConfig(env, rotation).maxMarkets,
      eventBatch: scanConfig(env, rotation).maxMultiOutcomeEvents,
      marketWindow: finite(env.MARKET_ROTATION_WINDOW, 600),
      eventWindow: finite(env.EVENT_ROTATION_WINDOW, 100)
    });
    const status = errors.length ? "DEGRADED" : "HEALTHY";
    const summary = {
      status,
      health: status,
      opportunities: candidates.length,
      selected: allocation.decisions.filter((item) => item.selected).length,
      executions: executionPairs.length,
      errors,
      rotation,
      allocation: {
        runBudget: allocation.runBudget,
        structuralAllocated: allocation.structuralAllocated,
        whaleAllocated: allocation.whaleAllocated
      },
      scans: strategyResult.summary,
      whales: whaleResult.summary
    };
    await store.finishRun(runId, summary);
    return { runId, ...summary };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    const summary = { status: "UNHEALTHY", health: "UNHEALTHY", opportunities: 0, selected: 0, executions: 0, errors };
    await store.finishRun(runId, summary);
    return { runId, ...summary };
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runHostedCycle(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "moneymog-paper-worker", authenticationRequired: true });
    }
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
    const store = new HostedPaperStore(env.DB);
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      return json(await store.snapshot({ limit: url.searchParams.get("limit"), startingCash: finite(env.PAPER_STARTING_CASH, 10_000) }));
    }
    if (url.pathname === "/api/portfolio" && request.method === "GET") {
      return json(await store.loadPortfolio(finite(env.PAPER_STARTING_CASH, 10_000)));
    }
    if (url.pathname === "/api/executions" && request.method === "GET") {
      return json({ executions: (await store.snapshot({ limit: url.searchParams.get("limit") })).executions });
    }
    if (url.pathname === "/api/opportunities" && request.method === "GET") {
      const snapshot = await store.snapshot({ limit: url.searchParams.get("limit") });
      return json({ opportunities: snapshot.opportunities, decisions: snapshot.decisions });
    }
    if (url.pathname === "/api/signals" && request.method === "GET") {
      return json({ signals: (await store.snapshot({ limit: url.searchParams.get("limit") })).signals });
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      const snapshot = await store.snapshot({ limit: 1 });
      return json({ health: snapshot.health });
    }
    if (url.pathname === "/api/run" && request.method === "POST") {
      return json(await runHostedCycle(env));
    }
    return json({ error: "not-found" }, 404);
  }
};
