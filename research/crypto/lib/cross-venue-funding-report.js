function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(value) {
  const parsed = number(value);
  return parsed === null ? "n/a" : `${(parsed * 100).toFixed(3)}%`;
}

function usd(value) {
  const parsed = number(value);
  return parsed === null ? "n/a" : `$${parsed.toFixed(2)}`;
}

function svgSeries(series, { width = 900, height = 360, title = "", yKeys = [] } = {}) {
  const points = series.filter((row) => Number.isFinite(Number(row.time)));
  const margin = { left: 70, right: 24, top: 42, bottom: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xValues = points.map((row) => Number(row.time));
  const yValues = points.flatMap((row) => yKeys.map((key) => Number(row[key])).filter(Number.isFinite));
  if (!xValues.length || !yValues.length) return null;

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const x = (value) => margin.left + (value - xMin) / Math.max(1, xMax - xMin) * plotWidth;
  const y = (value) => margin.top + (yMax - value) / (yMax - yMin) * plotHeight;

  const linePaths = yKeys.map((key, index) => {
    const usable = points.filter((row) => Number.isFinite(Number(row[key])));
    const d = usable.map((row, pointIndex) => `${pointIndex ? "L" : "M"}${x(Number(row.time)).toFixed(2)},${y(Number(row[key])).toFixed(2)}`).join(" ");
    const dash = index === 0 ? "" : ' stroke-dasharray="7 5"';
    return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2"${dash}/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <g color="black" font-family="system-ui, sans-serif">
    <text x="${margin.left}" y="26" font-size="17" font-weight="600">${title}</text>
    <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="currentColor" stroke-width="1"/>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="currentColor" stroke-width="1"/>
    <text x="${margin.left - 8}" y="${margin.top + 4}" text-anchor="end" font-size="11">${yMax.toFixed(2)}</text>
    <text x="${margin.left - 8}" y="${margin.top + plotHeight}" text-anchor="end" font-size="11">${yMin.toFixed(2)}</text>
    <text x="${margin.left}" y="${height - 14}" font-size="11">${new Date(xMin).toISOString().slice(0, 10)}</text>
    <text x="${margin.left + plotWidth}" y="${height - 14}" text-anchor="end" font-size="11">${new Date(xMax).toISOString().slice(0, 10)}</text>
    ${linePaths}
  </g>
</svg>\n`;
}

function validate(result) {
  if (result?.experimentId !== "cross-venue-funding-v1" || result?.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 report input identity");
  }
  if (result.paperOnly !== true || result.livePromotionAllowed !== false) {
    throw new Error("Trial 7 report input must remain paper-only and non-live");
  }
  if (!result.classification || !result.dataGate) throw new Error("Trial 7 report input is incomplete");
}

function reportMarkdown(result) {
  const gate = result.dataGate;
  const coverage = gate.acquisitionCoverage ?? {};
  const lines = [
    "# TheOldTrader Trial 7 evidence report",
    "",
    `- Experiment: \`${result.experimentId}\``,
    `- Trial: ${result.trialNumber}`,
    `- Mode: **${result.mode}**`,
    `- Classification: **${result.classification}**`,
    `- Paper-only: **${result.paperOnly ? "yes" : "no"}**`,
    `- Live promotion authorized: **${result.livePromotionAllowed ? "yes" : "no"}**`,
    `- Frozen window: ${result.frozenWindow?.startInclusive ?? "n/a"} → ${result.frozenWindow?.endExclusive ?? "n/a"}`,
    "",
    "## Data and provenance gate",
    "",
    `- Overall gate: **${gate.pass ? "PASS" : "FAIL"}**`,
    `- Hourly first-party context coverage: ${pct(gate.hourlyFirstPartyContextCoverage)}`,
    `- Primary-live coverage: ${pct(gate.primaryLiveCoverage)}`,
    `- Primary-live hourly contexts: ${coverage.primaryLiveHourlyContexts ?? 0}`,
    `- Official-recovery hourly contexts: ${coverage.officialRecoveryHourlyContexts ?? 0}`,
    `- Expected hourly contexts: ${gate.expectedHourlyContexts ?? 0}`,
    `- Raw-response hash coverage: **${gate.rawHashCoverage?.pass ? "PASS" : "FAIL"}**`,
    `- Hyperliquid funding coverage: **${gate.fundingCoverage?.hyperliquidPass ? "PASS" : "FAIL"}**`,
    `- Binance funding coverage: **${gate.fundingCoverage?.binancePass ? "PASS" : "FAIL"}**`,
    `- Hyperliquid funding/oracle matching: **${gate.hyperliquidFundingOraclePass ? "PASS" : "FAIL"}**`,
    ""
  ];

  if (!result.economicsCalculated) {
    lines.push(
      "## Economics",
      "",
      "Economics were **not calculated** because the frozen data/provenance gate failed. This is intentional; a corrupt or incomplete sample cannot generate descriptive strategy P&L.",
      "",
      `Interpretation constraint: ${result.interpretationConstraint ?? "n/a"}`,
      ""
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "## Primary economics",
    "",
    `- Net paired P&L: ${usd(result.primary?.netPnl)}`,
    `- Net return on starting equity: ${pct(result.primary?.stats?.netReturn)}`,
    `- Annualized return: ${pct(result.primary?.stats?.annualizedReturn)}`,
    `- Sharpe: ${number(result.primary?.stats?.sharpe)?.toFixed(3) ?? "n/a"}`,
    `- Sortino: ${number(result.primary?.stats?.sortino)?.toFixed(3) ?? "n/a"}`,
    `- Max drawdown: ${pct(result.primary?.stats?.maxDrawdown)}`,
    `- Hyperliquid funding P&L: ${usd(result.primary?.fundingPnl?.hyperliquid)}`,
    `- Binance funding P&L: ${usd(result.primary?.fundingPnl?.binance)}`,
    `- Net funding P&L: ${usd(result.primary?.fundingPnl?.net)}`,
    `- Cross-venue basis P&L after friction: ${usd(result.primary?.pricePnl?.combinedBasisAfterFriction)}`,
    `- Total modeled execution friction: ${usd(result.primary?.executionFriction?.totalUsd)}`,
    `- Break-even all-in friction per order: ${number(result.breakEvenAllInFrictionBpsPerOrder)?.toFixed(2) ?? "n/a"} bps`,
    "",
    "## Frozen cost and margin stresses",
    "",
    `- 25 bps/order stress P&L: ${usd(result.costStress?.netPnl)}`,
    `- Observed margin breach: **${result.primary?.margin?.observedBreach ? "YES" : "NO"}**`,
    `- All frozen basis/margin shocks pass: **${result.primary?.margin?.allFrozenStressesPass ? "YES" : "NO"}**`,
    "",
    "## 60-day consistency windows",
    ""
  );
  for (const window of result.windows60d ?? []) {
    lines.push(`- ${window.start} → ${window.end}: ${usd(window.pnl)} (${window.positive ? "positive" : "non-positive"})`);
  }
  lines.push(
    "",
    "## Comparator",
    "",
    `- Binance index-reference BTC comparator P&L: ${usd(result.directionalComparator?.pnl)}`,
    `- Comparator net return: ${pct(result.directionalComparator?.netReturn)}`,
    "",
    `Interpretation constraint: ${result.interpretationConstraint ?? "n/a"}`,
    ""
  );
  return `${lines.join("\n")}\n`;
}

export function buildCrossVenueFundingReport(result) {
  validate(result);
  const gate = result.dataGate;
  const coverage = gate.acquisitionCoverage ?? {};
  const files = {
    "REPORT.md": reportMarkdown(result),
    "coverage.csv": csv([
      ["metric", "value"],
      ["classification", result.classification],
      ["data_gate_pass", gate.pass],
      ["expected_hourly_contexts", gate.expectedHourlyContexts],
      ["primary_live_hourly_contexts", coverage.primaryLiveHourlyContexts],
      ["official_recovery_hourly_contexts", coverage.officialRecoveryHourlyContexts],
      ["combined_hourly_contexts", coverage.combinedHourlyContexts],
      ["hourly_first_party_context_coverage", gate.hourlyFirstPartyContextCoverage],
      ["primary_live_coverage", gate.primaryLiveCoverage],
      ["raw_hash_pass", gate.rawHashCoverage?.pass],
      ["hyperliquid_funding_coverage_pass", gate.fundingCoverage?.hyperliquidPass],
      ["binance_funding_coverage_pass", gate.fundingCoverage?.binancePass],
      ["hyperliquid_oracle_match_pass", gate.hyperliquidFundingOraclePass]
    ])
  };

  if (!result.economicsCalculated) return files;

  files["economics.csv"] = csv([
    ["metric", "primary", "cost_stress"],
    ["friction_bps_per_order", result.primary?.frictionBpsPerOrder, result.costStress?.frictionBpsPerOrder],
    ["net_pnl_usd", result.primary?.netPnl, result.costStress?.netPnl],
    ["net_return", result.primary?.stats?.netReturn, result.costStress?.stats?.netReturn],
    ["annualized_return", result.primary?.stats?.annualizedReturn, result.costStress?.stats?.annualizedReturn],
    ["max_drawdown", result.primary?.stats?.maxDrawdown, result.costStress?.stats?.maxDrawdown],
    ["hyperliquid_funding_pnl_usd", result.primary?.fundingPnl?.hyperliquid, result.costStress?.fundingPnl?.hyperliquid],
    ["binance_funding_pnl_usd", result.primary?.fundingPnl?.binance, result.costStress?.fundingPnl?.binance],
    ["net_funding_pnl_usd", result.primary?.fundingPnl?.net, result.costStress?.fundingPnl?.net],
    ["basis_pnl_after_friction_usd", result.primary?.pricePnl?.combinedBasisAfterFriction, result.costStress?.pricePnl?.combinedBasisAfterFriction],
    ["execution_friction_usd", result.primary?.executionFriction?.totalUsd, result.costStress?.executionFriction?.totalUsd],
    ["break_even_friction_bps_per_order", result.breakEvenAllInFrictionBpsPerOrder, ""]
  ]);

  files["windows-60d.csv"] = csv([
    ["start", "end", "pnl_usd", "positive"],
    ...(result.windows60d ?? []).map((window) => [window.start, window.end, window.pnl, window.positive])
  ]);

  files["margin-stress.csv"] = csv([
    ["shock_fraction", "breached", "minimum_binance_excess_usd", "minimum_hyperliquid_excess_usd"],
    ...Object.entries(result.primary?.margin?.stress ?? {}).map(([shock, state]) => [
      shock,
      state.breached,
      state.minBinanceExcess,
      state.minHyperliquidExcess
    ])
  ]);

  const equitySvg = svgSeries(result.primary?.equitySeries ?? [], {
    title: "Trial 7 total-equity path",
    yKeys: ["equity"]
  });
  if (equitySvg) files["equity-curve.svg"] = equitySvg;

  const marginSvg = svgSeries(result.primary?.marginSeries ?? [], {
    title: "Trial 7 venue margin excess",
    yKeys: ["binanceExcess", "hyperliquidExcess"]
  });
  if (marginSvg) files["margin-excess.svg"] = marginSvg;

  return files;
}
