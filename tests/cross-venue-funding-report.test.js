import test from "node:test";
import assert from "node:assert/strict";
import { buildCrossVenueFundingReport } from "../research/crypto/lib/cross-venue-funding-report.js";

function gate(pass = true) {
  return {
    pass,
    expectedHourlyContexts: 4320,
    acquisitionCoverage: {
      primaryLiveHourlyContexts: 4104,
      officialRecoveryHourlyContexts: 216,
      combinedHourlyContexts: 4320
    },
    hourlyFirstPartyContextCoverage: 1,
    primaryLiveCoverage: 0.95,
    rawHashCoverage: { pass },
    fundingCoverage: { hyperliquidPass: pass, binancePass: pass },
    hyperliquidFundingOraclePass: pass
  };
}

function goodResult() {
  const start = Date.parse("2026-08-20T00:00:00Z");
  return {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    mode: "final",
    paperOnly: true,
    livePromotionAllowed: false,
    classification: "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
    frozenWindow: {
      startInclusive: "2026-08-20T00:00:00.000Z",
      endExclusive: "2027-02-16T00:00:00.000Z"
    },
    dataGate: gate(true),
    economicsCalculated: true,
    primary: {
      frictionBpsPerOrder: 15,
      netPnl: 140,
      stats: {
        netReturn: 0.014,
        annualizedReturn: 0.0285,
        sharpe: 1.2,
        sortino: 1.6,
        maxDrawdown: -0.025
      },
      fundingPnl: { hyperliquid: 250, binance: -70, net: 180 },
      pricePnl: { combinedBasisAfterFriction: -40 },
      executionFriction: { totalUsd: 9 },
      margin: {
        observedBreach: null,
        allFrozenStressesPass: true,
        stress: {
          "0.05": { breached: false, minBinanceExcess: 1600, minHyperliquidExcess: 1500 },
          "0.1": { breached: false, minBinanceExcess: 1500, minHyperliquidExcess: 1400 },
          "0.25": { breached: false, minBinanceExcess: 1200, minHyperliquidExcess: 1000 }
        }
      },
      equitySeries: [
        { time: start, equity: 10000 },
        { time: start + 90 * 86400000, equity: 10080 },
        { time: start + 180 * 86400000, equity: 10140 }
      ],
      marginSeries: [
        { time: start, binanceExcess: 1700, hyperliquidExcess: 1650 },
        { time: start + 90 * 86400000, binanceExcess: 1600, hyperliquidExcess: 1500 },
        { time: start + 180 * 86400000, binanceExcess: 1550, hyperliquidExcess: 1450 }
      ]
    },
    costStress: {
      frictionBpsPerOrder: 25,
      netPnl: 80,
      stats: { netReturn: 0.008, annualizedReturn: 0.0162, maxDrawdown: -0.03 },
      fundingPnl: { hyperliquid: 250, binance: -70, net: 180 },
      pricePnl: { combinedBasisAfterFriction: -100 },
      executionFriction: { totalUsd: 15 }
    },
    directionalComparator: { pnl: 300, netReturn: 0.03 },
    windows60d: [
      { start: "a", end: "b", pnl: 40, positive: true },
      { start: "b", end: "c", pnl: 30, positive: true },
      { start: "c", end: "d", pnl: 70, positive: true }
    ],
    breakEvenAllInFrictionBpsPerOrder: 38.2,
    interpretationConstraint: "research-only"
  };
}

test("Trial 7 report is deterministic and always exposes recovery plus decomposition", () => {
  const result = goodResult();
  const first = buildCrossVenueFundingReport(result);
  const second = buildCrossVenueFundingReport(result);
  assert.deepEqual(first, second);
  assert.match(first["REPORT.md"], /Official-recovery hourly contexts: 216/);
  assert.match(first["REPORT.md"], /Net funding P&L: \$180\.00/);
  assert.match(first["REPORT.md"], /Cross-venue basis P&L after friction: -\$40\.00|Cross-venue basis P&L after friction: \$-40\.00/);
  assert.match(first["economics.csv"], /break_even_friction_bps_per_order/);
  assert.match(first["margin-stress.csv"], /0\.25/);
  assert.ok(first["equity-curve.svg"]?.startsWith("<svg"));
  assert.ok(first["margin-excess.svg"]?.startsWith("<svg"));
});

test("failed data gate report never invents economic tables or charts", () => {
  const result = {
    experimentId: "cross-venue-funding-v1",
    trialNumber: 7,
    mode: "final",
    paperOnly: true,
    livePromotionAllowed: false,
    classification: "FAILED_DATA_GATE",
    frozenWindow: { startInclusive: "x", endExclusive: "y" },
    dataGate: gate(false),
    economicsCalculated: false,
    interpretationConstraint: "no economics"
  };
  const files = buildCrossVenueFundingReport(result);
  assert.deepEqual(Object.keys(files).sort(), ["REPORT.md", "coverage.csv"]);
  assert.match(files["REPORT.md"], /Economics were \*\*not calculated\*\*/);
});

test("reporter rejects any result that could authorize live trading", () => {
  const result = goodResult();
  result.livePromotionAllowed = true;
  assert.throws(() => buildCrossVenueFundingReport(result), /paper-only and non-live/);
});
