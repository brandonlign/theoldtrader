#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() { throw new Error("Usage: node research/crypto/report-bitnomial-carry.mjs <evaluation.json> <new-output-dir>"); }
function csvCell(value) { const s = String(value ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
function csv(rows) { return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`; }
function money(value) { return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "n/a"; }
function pct(value) { return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(3)}%` : "n/a"; }

const [input, outputDir] = process.argv.slice(2);
if (!input || !outputDir || process.argv.slice(2).length !== 2) usage();
if (fs.existsSync(outputDir)) throw new Error(`Refusing to overwrite Trial 8 report directory: ${outputDir}`);
const result = JSON.parse(fs.readFileSync(input, "utf8"));
if (result.experimentId !== "bitnomial-carry-v1" || result.trialNumber !== 8 || result.paperOnly !== true || result.livePromotionAllowed !== false) {
  throw new Error("Unexpected or unsafe Trial 8 evaluation artifact");
}
if (result.provenance?.rawSemanticAudit?.pass !== true || result.provenance?.firstPartyOnly !== true) {
  throw new Error("Trial 8 report requires a passing first-party raw semantic audit");
}

const lines = [
  "# TheOldTrader Trial 8 evidence report",
  "",
  `- Mode: **${result.mode}**`,
  `- Classification: **${result.classification}**`,
  `- Paper only: **yes**`,
  `- Live trading authorized: **no**`,
  `- Raw semantic audit: **PASS** (${result.provenance.rawSemanticAudit.compactRowsAudited} compact rows)`,
  `- Data gate: **${result.dataGate?.pass ? "PASS" : "FAIL"}**`,
  "",
  "## Data quality",
  "",
  `- Hourly first-party context coverage: ${pct(result.dataGate?.hourlyContextCoverage)}`,
  `- Bitnomial stale-price gate: **${result.dataGate?.stalePricePass ? "PASS" : "FAIL"}**`,
  `- Bitnomial product identity: **${result.dataGate?.productIdentityPass ? "PASS" : "FAIL"}**`,
  `- Funding interval completeness: **${result.dataGate?.fundingCoverage?.pass ? "PASS" : "FAIL"}**`,
  `- Raw response hashes: **${result.dataGate?.rawHashCoverage?.pass ? "PASS" : "FAIL"}**`,
  ""
];

const files = {};
if (!result.economicsCalculated) {
  lines.push("## Economics", "", "Economics were **not calculated** because the frozen data/provenance gate failed.", "");
} else {
  const p = result.primary;
  lines.push(
    "## Frozen position",
    "",
    `- Bitnomial contracts: ${p.size.contracts}`,
    `- BTC on each leg: ${p.size.btcQuantity}`,
    `- Entry actual notional per leg: ${money(p.size.actualNotional)}`,
    "",
    "## Primary economics",
    "",
    `- Funding P&L: ${money(p.pnl.funding)}`,
    `- Coinbase spot price P&L: ${money(p.pnl.spotPrice)}`,
    `- Bitnomial short-perpetual price P&L: ${money(p.pnl.perpetualPrice)}`,
    `- Combined raw basis P&L: ${money(p.pnl.rawBasis)}`,
    `- Explicit fees: ${money(p.pnl.explicitFees)}`,
    `- **Net P&L: ${money(p.pnl.net)}**`,
    `- Net return on starting equity: ${pct(p.stats.netReturn)}`,
    `- Annualized return: ${pct(p.stats.annualizedReturn)}`,
    `- Sharpe: ${Number(p.stats.sharpe).toFixed(3)}`,
    `- Sortino: ${Number(p.stats.sortino).toFixed(3)}`,
    `- Maximum drawdown: ${pct(p.stats.maxDrawdown)}`,
    "",
    "## Frozen stress",
    "",
    `- High-cost stress P&L: ${money(result.costStress?.pnl?.net)}`,
    `- Observed margin breach: **${p.margin?.observedBreach ? "YES" : "NO"}**`,
    `- All 5%/10%/20% adverse basis-margin shocks pass: **${p.margin?.allFrozenStressesPass ? "YES" : "NO"}**`,
    "",
    "## Comparator",
    "",
    `- Same-size Coinbase BTC buy-and-hold P&L: ${money(result.comparator?.coinbaseSpotBuyHoldPnl)}`,
    `- Cash P&L: ${money(result.comparator?.cashPnl)}`,
    "",
    "## 60-day consistency windows",
    ""
  );
  for (const window of p.windows60d ?? []) lines.push(`- ${window.start} → ${window.end}: ${money(window.pnl)} (${window.positive ? "positive" : "non-positive"})`);
  lines.push("");
  files["economics.csv"] = csv([
    ["metric", "primary", "high_cost_stress"],
    ["funding_pnl_usd", p.pnl.funding, result.costStress?.pnl?.funding],
    ["spot_price_pnl_usd", p.pnl.spotPrice, result.costStress?.pnl?.spotPrice],
    ["perpetual_price_pnl_usd", p.pnl.perpetualPrice, result.costStress?.pnl?.perpetualPrice],
    ["raw_basis_pnl_usd", p.pnl.rawBasis, result.costStress?.pnl?.rawBasis],
    ["explicit_fees_usd", p.pnl.explicitFees, result.costStress?.pnl?.explicitFees],
    ["net_pnl_usd", p.pnl.net, result.costStress?.pnl?.net],
    ["net_return", p.stats.netReturn, result.costStress?.stats?.netReturn],
    ["annualized_return", p.stats.annualizedReturn, result.costStress?.stats?.annualizedReturn],
    ["max_drawdown", p.stats.maxDrawdown, result.costStress?.stats?.maxDrawdown]
  ]);
  files["windows-60d.csv"] = csv([["start", "end", "pnl_usd", "positive"], ...(p.windows60d ?? []).map((w) => [w.start, w.end, w.pnl, w.positive])]);
  files["margin-stress.csv"] = csv([["basis_shock", "breached", "minimum_excess_usd"], ...Object.entries(p.margin?.stress ?? {}).map(([shock, state]) => [shock, state.breached, state.minExcess])]);
}
files["coverage.csv"] = csv([
  ["metric", "value"],
  ["classification", result.classification],
  ["data_gate_pass", result.dataGate?.pass],
  ["hourly_context_coverage", result.dataGate?.hourlyContextCoverage],
  ["stale_price_pass", result.dataGate?.stalePricePass],
  ["product_identity_pass", result.dataGate?.productIdentityPass],
  ["funding_coverage_pass", result.dataGate?.fundingCoverage?.pass],
  ["raw_hash_coverage_pass", result.dataGate?.rawHashCoverage?.pass],
  ["raw_semantic_audit_pass", result.provenance.rawSemanticAudit.pass]
]);
files["REPORT.md"] = `${lines.join("\n")}\n`;
fs.mkdirSync(outputDir, { recursive: false });
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(outputDir, name), content, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ input, outputDir, classification: result.classification, files: Object.keys(files).sort() }, null, 2)}\n`);
