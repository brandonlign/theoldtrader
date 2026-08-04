function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function summarize(positions) {
  const pnls = positions.map((item) => number(item.realizedPnl));
  const pnl = pnls.reduce((sum, value) => sum + value, 0);
  const deployed = positions.reduce((sum, item) =>
    sum + Math.max(0, number(item.totalBought)) * Math.max(0, Math.min(1, number(item.avgPrice))), 0);
  const wins = pnls.filter((value) => value > 0);
  const largestWin = wins.length ? Math.max(...wins) : 0;
  return {
    count: positions.length,
    pnl,
    roi: divide(pnl, deployed),
    winRate: divide(wins.length, positions.length),
    deployed,
    robustPnl: pnl - largestWin,
    largestWin
  };
}

function categoryOf(position) {
  const text = `${position.title ?? ""} ${position.slug ?? ""} ${position.eventSlug ?? ""}`.toLowerCase();
  const rules = [
    ["POLITICS", /election|president|senate|congress|governor|primary|minister|parliament|trump|democrat|republican/],
    ["CRYPTO", /bitcoin|btc|ethereum|eth|crypto|solana|token|coinbase/],
    ["SPORTS", /\b(?:nba|nfl|nhl|mlb|ufc)\b|soccer|football|basketball|baseball|tennis|championship|world cup/],
    ["ECONOMICS", /inflation|cpi|gdp|recession|unemployment|fed|interest rate|payroll/],
    ["FINANCE", /stock|nasdaq|s&p|dow|earnings|ipo|market cap|oil price|gold price/],
    ["TECH", /openai|apple|google|microsoft|tesla|ai model|spacex|launch/],
    ["WEATHER", /temperature|hurricane|storm|rain|snow|weather/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "OVERALL";
}

export function walkForwardEvaluate(closedPositions, options = {}) {
  const sorted = [...closedPositions].sort((a, b) => number(a.timestamp) - number(b.timestamp));
  const minTrain = Math.max(5, Math.trunc(options.minTrain ?? 10));
  const testSize = Math.max(1, Math.trunc(options.testSize ?? 5));
  const maxFolds = Math.max(1, Math.trunc(options.maxFolds ?? 8));
  const folds = [];

  for (let split = minTrain; split < sorted.length && folds.length < maxFolds; split += testSize) {
    const train = summarize(sorted.slice(0, split));
    const testRows = sorted.slice(split, split + testSize);
    if (!testRows.length) break;
    const test = summarize(testRows);
    const selected = train.pnl > 0 && train.robustPnl > 0 && train.roi > 0;
    folds.push({
      trainEndTimestamp: number(sorted[split - 1]?.timestamp),
      testEndTimestamp: number(testRows.at(-1)?.timestamp),
      selected,
      train,
      test
    });
  }

  const selectedFolds = folds.filter((fold) => fold.selected);
  const forwardPnl = selectedFolds.reduce((sum, fold) => sum + fold.test.pnl, 0);
  const forwardDeployed = selectedFolds.reduce((sum, fold) => sum + fold.test.deployed, 0);
  const profitableFolds = selectedFolds.filter((fold) => fold.test.pnl > 0).length;
  const positivePnl = selectedFolds.filter((fold) => fold.test.pnl > 0)
    .reduce((sum, fold) => sum + fold.test.pnl, 0);
  const largestPositiveFold = Math.max(0, ...selectedFolds.map((fold) => Math.max(0, fold.test.pnl)));
  const profitableFoldRate = divide(profitableFolds, selectedFolds.length);
  const forwardRoi = divide(forwardPnl, forwardDeployed);
  const concentration = divide(largestPositiveFold, positivePnl);

  const sampleComponent = Math.min(1, selectedFolds.length / 4);
  const profitabilityComponent = Math.min(1, Math.max(0, (forwardRoi + 0.02) / 0.2));
  const stabilityComponent = profitableFoldRate;
  const concentrationComponent = 1 - Math.min(1, Math.max(0, (concentration - 0.4) / 0.5));
  const score = 100 * (
    0.20 * sampleComponent +
    0.35 * profitabilityComponent +
    0.30 * stabilityComponent +
    0.15 * concentrationComponent
  );

  const rejectionReasons = [];
  if (selectedFolds.length < 2) rejectionReasons.push("insufficient-forward-folds");
  if (forwardPnl <= 0) rejectionReasons.push("non-positive-forward-pnl");
  if (forwardRoi <= 0) rejectionReasons.push("non-positive-forward-roi");
  if (profitableFoldRate < 0.6) rejectionReasons.push("unstable-forward-performance");
  if (concentration > 0.75) rejectionReasons.push("forward-profit-concentrated");

  return {
    score: Number(score.toFixed(2)),
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    foldCount: folds.length,
    selectedFoldCount: selectedFolds.length,
    profitableFolds,
    profitableFoldRate,
    forwardPnl,
    forwardDeployed,
    forwardRoi,
    largestPositiveFold,
    positiveFoldConcentration: concentration,
    folds
  };
}

export function walkForwardByCategory(closedPositions, options = {}) {
  const groups = new Map();
  for (const row of closedPositions) {
    const category = categoryOf(row);
    const group = groups.get(category) ?? [];
    group.push(row);
    groups.set(category, group);
  }
  const output = { OVERALL: walkForwardEvaluate(closedPositions, options) };
  for (const [category, rows] of groups) {
    if (rows.length >= (options.minTrain ?? 10) + 2) {
      output[category] = walkForwardEvaluate(rows, options);
    }
  }
  return output;
}
