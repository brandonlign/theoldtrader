function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function strategyType(candidate) {
  const strategy = String(candidate.strategy ?? "").toUpperCase();
  if (strategy.includes("WHALE")) return "WHALE_COPY";
  if (strategy.includes("MULTI")) return "MULTI_OUTCOME_COMPLETE_SET";
  return "BINARY_COMPLETE_SET";
}

function marketKey(candidate) {
  return String(
    candidate.marketKey ?? candidate.conditionId ?? candidate.eventId ?? candidate.slug ??
    candidate.asset ?? candidate.question ?? candidate.id ?? "unknown"
  );
}

function categoryKey(candidate) {
  return String(candidate.category ?? candidate.strategyCategory ?? "uncategorized").toLowerCase();
}

function candidateCapital(candidate) {
  return Math.max(0, finite(
    candidate.capitalRequired ?? candidate.estimatedCost ?? candidate.requestedCapital ?? candidate.notional,
    0
  ));
}

function candidateId(candidate) {
  return String(candidate.id ?? `${strategyType(candidate)}:${marketKey(candidate)}:${candidate.direction ?? candidate.side ?? ""}`);
}

function duplicateKey(candidate) {
  return [
    strategyType(candidate),
    marketKey(candidate),
    String(candidate.direction ?? candidate.side ?? ""),
    String(candidate.outcome ?? candidate.tokenId ?? "")
  ].join(":").toLowerCase();
}

function whaleQualificationReasons(candidate, config) {
  const reasons = [];
  const walletScore = finite(candidate.walletScore ?? candidate.effectiveWalletScore, 0);
  const forward = candidate.walkForward ?? candidate.forwardEvidence ?? {};
  const eligible = bool(forward.eligible ?? candidate.walkForwardEligible);
  const forwardRoi = finite(forward.forwardRoi ?? candidate.forwardRoi, -1);
  const profitableFoldRate = finite(forward.profitableFoldRate ?? candidate.profitableFoldRate, 0);
  const delay = finite(candidate.detectionDelaySeconds, Infinity);
  const slippage = Math.abs(finite(candidate.slippageBps, Infinity));
  const liquidity = finite(candidate.availableLiquidityUsd ?? candidate.bookLiquidityUsd ?? candidate.estimatedCost, 0);
  const cost = candidateCapital(candidate);
  const decision = String(candidate.decision ?? "").toUpperCase();

  if (decision && decision !== "COPY_CANDIDATE") reasons.push("signal-not-copy-candidate");
  if (walletScore < config.minWhaleScore) reasons.push("wallet-score-below-threshold");
  if (!eligible) reasons.push("walk-forward-not-eligible");
  if (forwardRoi <= config.minForwardRoi) reasons.push("forward-roi-not-positive-enough");
  if (profitableFoldRate < config.minProfitableFoldRate) reasons.push("forward-fold-consistency-too-low");
  if (delay > config.maxWhaleDelaySeconds) reasons.push("signal-delay-too-high");
  if (slippage > config.maxWhaleSlippageBps) reasons.push("slippage-too-high");
  if (liquidity < Math.max(config.minWhaleLiquidityUsd, cost * config.minLiquidityCoverage)) reasons.push("insufficient-current-liquidity");
  if (finite(candidate.price, finite(candidate.copyAveragePrice, 0)) > config.maxWhaleEntryPrice) reasons.push("entry-price-too-high");
  if (Array.isArray(candidate.reasons) && candidate.reasons.length) reasons.push("upstream-signal-rejected");
  return reasons;
}

export function defaultHeroConfig(overrides = {}) {
  return {
    maxRunAllocationPct: 0.12,
    maxSelectedPerRun: 2,
    structuralBudgetShare: 0.9,
    whaleBudgetShare: 0.1,
    maxOpportunityPct: 0.04,
    maxMarketExposurePct: 0.08,
    maxCategoryExposurePct: 0.12,
    maxWhaleTradePct: 0.0075,
    maxWhaleTotalExposurePct: 0.025,
    minStructuralRoiBps: 8,
    minStructuralNetProfitUsd: 0.05,
    minWhaleScore: 70,
    minForwardRoi: 0,
    minProfitableFoldRate: 0.6,
    maxWhaleDelaySeconds: 180,
    maxWhaleSlippageBps: 125,
    minWhaleLiquidityUsd: 50,
    minLiquidityCoverage: 2,
    maxWhaleEntryPrice: 0.85,
    ...overrides
  };
}

export function allocateHero(input = {}) {
  const config = defaultHeroConfig(input.config);
  const portfolio = input.portfolio ?? {};
  const startingCash = Math.max(1, finite(portfolio.startingCash, finite(portfolio.cash, 10_000)));
  const cash = Math.max(0, finite(portfolio.cash, startingCash));
  const equityBase = Math.max(startingCash, cash + finite(portfolio.openPositionValue, 0));
  const runBudget = Math.min(cash, equityBase * config.maxRunAllocationPct);
  const budgets = {
    BINARY_COMPLETE_SET: runBudget * config.structuralBudgetShare,
    MULTI_OUTCOME_COMPLETE_SET: runBudget * config.structuralBudgetShare,
    WHALE_COPY: runBudget * config.whaleBudgetShare
  };
  const sharedStructuralBudget = runBudget * config.structuralBudgetShare;
  let structuralUsed = 0;
  let whaleUsed = 0;
  const existing = Array.isArray(input.exposures) ? input.exposures : [];
  const marketExposure = new Map();
  const categoryExposure = new Map();
  let whaleExposure = 0;
  for (const exposure of existing) {
    const amount = Math.max(0, finite(exposure.value ?? exposure.costBasis, 0));
    const market = String(exposure.marketKey ?? exposure.conditionId ?? exposure.tokenId ?? "unknown");
    const category = String(exposure.category ?? "uncategorized").toLowerCase();
    marketExposure.set(market, (marketExposure.get(market) ?? 0) + amount);
    categoryExposure.set(category, (categoryExposure.get(category) ?? 0) + amount);
    if (String(exposure.strategy ?? "").toUpperCase().includes("WHALE")) whaleExposure += amount;
  }

  const seen = new Set((input.executedKeys ?? []).map((value) => String(value).toLowerCase()));
  const candidates = [...(input.candidates ?? [])].sort((a, b) => {
    const aType = strategyType(a);
    const bType = strategyType(b);
    const aDirectional = aType === "WHALE_COPY" ? 1 : 0;
    const bDirectional = bType === "WHALE_COPY" ? 1 : 0;
    if (aDirectional !== bDirectional) return aDirectional - bDirectional;
    const aScore = finite(a.roiBps, 0) + finite(a.netProfit, 0) * 10;
    const bScore = finite(b.roiBps, 0) + finite(b.netProfit, 0) * 10;
    return bScore - aScore;
  });

  const decisions = [];
  let selectedCount = 0;
  for (const candidate of candidates) {
    const type = strategyType(candidate);
    const id = candidateId(candidate);
    const key = duplicateKey(candidate);
    const market = marketKey(candidate);
    const category = categoryKey(candidate);
    const requested = candidateCapital(candidate);
    const reasons = [];

    if (seen.has(key)) reasons.push("duplicate-opportunity");
    if (selectedCount >= config.maxSelectedPerRun) reasons.push("run-selection-limit");
    if (requested <= 0) reasons.push("capital-required-missing");
    if (type !== "WHALE_COPY") {
      if (finite(candidate.netProfit, 0) < config.minStructuralNetProfitUsd) reasons.push("net-profit-below-threshold");
      if (finite(candidate.roiBps, 0) < config.minStructuralRoiBps) reasons.push("roi-below-threshold");
      if (candidate.stable === false) reasons.push("outcome-set-not-stable");
      if (Array.isArray(candidate.reasons) && candidate.reasons.length) reasons.push("upstream-opportunity-rejected");
    } else {
      reasons.push(...whaleQualificationReasons(candidate, config));
    }

    const perOpportunityCap = equityBase * (type === "WHALE_COPY" ? config.maxWhaleTradePct : config.maxOpportunityPct);
    const marketRemaining = Math.max(0, equityBase * config.maxMarketExposurePct - (marketExposure.get(market) ?? 0));
    const categoryRemaining = Math.max(0, equityBase * config.maxCategoryExposurePct - (categoryExposure.get(category) ?? 0));
    const strategyRemaining = type === "WHALE_COPY"
      ? Math.max(0, budgets.WHALE_COPY - whaleUsed)
      : Math.max(0, sharedStructuralBudget - structuralUsed);
    const whaleRemaining = type === "WHALE_COPY"
      ? Math.max(0, equityBase * config.maxWhaleTotalExposurePct - whaleExposure)
      : Infinity;
    const allocatedCapital = Math.max(0, Math.min(requested, perOpportunityCap, marketRemaining, categoryRemaining, strategyRemaining, whaleRemaining, cash - structuralUsed - whaleUsed));

    if (marketRemaining <= 0) reasons.push("market-concentration-limit");
    if (categoryRemaining <= 0) reasons.push("category-concentration-limit");
    if (strategyRemaining <= 0) reasons.push(type === "WHALE_COPY" ? "whale-budget-exhausted" : "structural-budget-exhausted");
    if (whaleRemaining <= 0) reasons.push("directional-whale-cap-reached");
    if (allocatedCapital <= 0) reasons.push("no-risk-budget-available");

    const selected = reasons.length === 0;
    if (selected) {
      seen.add(key);
      marketExposure.set(market, (marketExposure.get(market) ?? 0) + allocatedCapital);
      categoryExposure.set(category, (categoryExposure.get(category) ?? 0) + allocatedCapital);
      selectedCount += 1;
      if (type === "WHALE_COPY") {
        whaleUsed += allocatedCapital;
        whaleExposure += allocatedCapital;
      } else {
        structuralUsed += allocatedCapital;
      }
    }

    decisions.push({
      id,
      duplicateKey: key,
      strategy: type,
      marketKey: market,
      category,
      selected,
      requestedCapital: requested,
      allocatedCapital: selected ? allocatedCapital : 0,
      reasons: selected ? ["selected-by-risk-first-allocator"] : [...new Set(reasons)],
      score: type === "WHALE_COPY"
        ? finite(candidate.effectiveWalletScore ?? candidate.walletScore, 0)
        : finite(candidate.roiBps, 0),
      candidate
    });
  }

  return {
    runBudget,
    structuralBudget: sharedStructuralBudget,
    whaleBudget: budgets.WHALE_COPY,
    structuralAllocated: structuralUsed,
    whaleAllocated: whaleUsed,
    decisions
  };
}
