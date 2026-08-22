function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function analyzeCarryFlagship(summary) {
  if (!summary || summary.experimentId !== 'funding-carry-v1') {
    throw new Error('Expected funding-carry-v1 summary');
  }
  if (summary.paperOnly !== true || summary.livePromotionAllowed !== false) {
    throw new Error('Flagship audit accepts paper-only, non-promotion Trial 2 summaries only');
  }

  const carry = summary.strategies?.fundingCarry;
  const cash = summary.strategies?.cash;
  const decomposition = summary.pnlDecomposition;
  const margin = summary.margin;
  if (!carry || !cash || !decomposition || !margin) {
    throw new Error('Carry summary is missing required metrics/decomposition/margin sections');
  }

  const exactGrid = summary.input?.exactEightHourGridVerified === true;
  const historicalMarginSafe = margin.breached === false
    && margin.strategyValidWithoutHistoricalMarginBreach === true;
  const gapEntries = Object.entries(margin.gapStress ?? {});
  const gapStressComplete = gapEntries.length > 0;
  const allFrozenGapStressesSurvive = gapStressComplete
    && gapEntries.every(([, row]) => row?.breached === false && Number.isFinite(Number(row?.minimumExcessMargin)));

  const netReturn = finite(carry.netReturn);
  const annualizedReturn = finite(carry.annualizedReturn);
  const cashNetReturn = finite(cash.netReturn) ?? 0;
  const startValue = finite(carry.startValue);
  const endValue = finite(carry.endValue);
  const totalFees = finite(decomposition.totalFees);
  const fundingPnl = finite(decomposition.fundingPnl);
  const priceHedgePnlAfterFees = finite(decomposition.priceHedgePnlAfterFees);

  const completeEconomics = [
    netReturn,
    annualizedReturn,
    startValue,
    endValue,
    totalFees,
    fundingPnl,
    priceHedgePnlAfterFees
  ].every((value) => value !== null);

  const positiveVsCash = netReturn !== null && netReturn > cashNetReturn;
  const historicalEvidenceUsable = exactGrid && historicalMarginSafe
    && allFrozenGapStressesSurvive && completeEconomics;

  let status = 'REJECT_HISTORICAL';
  const reasons = [];
  if (!exactGrid) reasons.push('exact synchronized 8-hour grid was not verified');
  if (!historicalMarginSafe) reasons.push('historical maintenance-margin requirement failed');
  if (!gapStressComplete) reasons.push('frozen gap-stress results are missing');
  else if (!allFrozenGapStressesSurvive) reasons.push('one or more frozen gap-stress scenarios breached');
  if (!completeEconomics) reasons.push('required net-return/P&L/fee decomposition is incomplete');
  if (completeEconomics && !positiveVsCash) reasons.push('net-of-cost return did not beat cash');

  if (historicalEvidenceUsable && positiveVsCash) {
    status = 'PROMISING_HISTORICAL_ONLY';
    reasons.push('frozen historical evidence is positive and margin-safe, but untouched validation is still mandatory');
  }

  const netProfitUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
  const fundingCoverageOfFees = totalFees !== null && totalFees > 0 && fundingPnl !== null
    ? fundingPnl / totalFees
    : null;
  const feeDragPctOfStartingEquity = totalFees !== null && startValue !== null && startValue > 0
    ? totalFees / startValue
    : null;

  return {
    experimentId: summary.experimentId,
    trialNumber: summary.trialNumber,
    status,
    promotionAllowed: false,
    forwardValidationRequired: true,
    historicalEvidenceUsable,
    checks: {
      exactGrid,
      historicalMarginSafe,
      gapStressComplete,
      allFrozenGapStressesSurvive,
      completeEconomics,
      positiveVsCash
    },
    economics: {
      netReturn,
      annualizedReturn,
      cashNetReturn,
      netProfitUsd,
      fundingPnl,
      priceHedgePnlAfterFees,
      totalFees,
      fundingCoverageOfFees,
      feeDragPctOfStartingEquity
    },
    risk: {
      sharpe: finite(carry.sharpe),
      sortino: finite(carry.sortino),
      maxDrawdown: finite(carry.maxDrawdown),
      calmar: finite(carry.calmar),
      gapStress: margin.gapStress
    },
    reasons,
    interpretation: status === 'PROMISING_HISTORICAL_ONLY'
      ? 'Historical robustness is promising only. This audit cannot promote Trial 2 or authorize parameter/cost changes; a later untouched forward or independently sealed evaluation remains required.'
      : 'The frozen historical candidate does not clear the result-agnostic flagship evidence checks. Do not rescue it by changing Trial 2 after observing the result.'
  };
}
