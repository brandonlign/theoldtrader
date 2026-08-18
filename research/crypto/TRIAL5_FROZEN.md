# Trial 5 frozen specification — `tsmom-v1`

Frozen: 2026-08-18, before any `tsmom-v1` development or diagnostic result was observed.

## Why this trial exists

Trial 1 showed that adding a pooled ridge model to the same candle information set did not create robust BTC out-of-sample signal. Trials 3 and 4 are cross-sectional and remain blocked on a historically formed universe. Trial 5 therefore tests a simpler and economically different question: can **low-turnover time-series momentum** survive TheOldTrader's unusually high retail cost model on the same directly deployable Coinbase spot products?

The design was selected from literature before seeing Trial 5 performance. Han, Kang and Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions* (SSRN 4675565, revised 2026-03-26), report much stronger evidence for time-series than cross-sectional cryptocurrency momentum after imposing more realistic assumptions. Liu and Tsyvinski, *Risks and Returns of Cryptocurrency* (RFS 2021), also document a strong crypto time-series momentum effect. Barroso and Santa-Clara (JFE 2015) motivate realized-volatility risk management; Trial 5 uses that idea conservatively by allowing volatility to reduce exposure only, never to lever the strategy above its fixed caps.

These papers motivate a hypothesis. They are **not** evidence that Trial 5 is profitable under TheOldTrader's data, costs, assets or implementation.

## Frozen candidate

- Products: BTC-USD, ETH-USD, SOL-USD only.
- Data: public Coinbase Exchange **daily** candles.
- Decisions: monthly, on a calendar month's first UTC daily candle.
- Information cutoff: only closes strictly before the decision candle.
- Momentum horizons: exactly 30, 90 and 180 days.
- Long only when at least two of the three exact-lookback returns are positive.
- Two positive horizons target 10% of equity in that asset; three positive horizons target 15%.
- No shorting, leverage, cross-sectional ranking, ML, intramonth rebalance or regime switch.
- Realized volatility: exact 60-day daily log-return window, annualized by sqrt(365).
- Volatility target: 50% annualized.
- Volatility multiplier: `min(1, 0.50 / trailingAnnualizedVol)`. It can only reduce the momentum weight.
- Per-asset cap: 15%.
- Total crypto exposure cap: 45%.
- Minimum cash reserve implied by the cap: 55%.

## Frozen costs

Every dollar of turnover pays:

- 60 bps fee;
- 5 bps slippage;
- 5 bps historical spread proxy.

Total: **70 bps per traded dollar, 140 bps for a complete entry/exit round trip**. Rebalance turnover is charged in full and evaluation-end liquidation is also charged. No maker discount, VIP tier, fee rebate or optimistic spread assumption is allowed under Trial 5.

## Data firewall

The development acquisition begins 2021-01-01 only to provide causal warm-up history. The development result is exactly 2022-01-01 through 2026-01-01, with 2022/2023/2024/2025 calendar-year folds.

No missing 30/90/180-day signal observation or 60-day volatility observation may be interpolated. A missing exact signal input produces zero target weight for that asset at that decision. Dataset gap diagnostics are reported.

The already-past 2026-01-01 through 2026-08-01 period is a **retrospective diagnostic only** and is sealed unless development first passes. It can never authorize promotion or parameter changes.

A genuine prospective final window begins no earlier than 2026-08-19 and must contain at least 180 calendar days. No Trial 5 promotion proposal can exist before that prospective window and a same-date frozen-v2 comparison are available.

## Development gate

All checks were fixed before the first result:

1. full 2022-2025 net return after costs > 0;
2. positive net return in at least three of the four calendar-year folds;
3. volatility-scaled maximum drawdown is no worse than the exact unscaled momentum comparator;
4. all turnover is charged at the frozen cost and data gaps are disclosed.

A development failure permanently records `tsmom-v1` as failed. Changing horizons, decision frequency, volatility target, weights, costs, assets, filters or risk caps after seeing the result requires Trial 6 or later.

## Prospective promotion requirements

Even a development pass is **not** a promotion. After at least 180 post-freeze days, Trial 5 still requires positive net return after frozen costs, positive excess return versus cash, maximum drawdown below 15% of starting equity, intact provenance/timestamp gates, and a side-by-side frozen-v2 result over the identical prospective dates. Promotion remains a separate explicit decision; it is never automatic.

## Implementation

- manifest: `research/crypto/manifests/tsmom-v1.json`
- signal/backtest core: `research/crypto/lib/tsmom.js`
- evaluator: `research/crypto/tsmom-evaluate.js`
- deterministic tests: `tests/tsmom-research.test.js`

The research implementation does not edit `src/crypto/strategy.js`, `src/crypto/risk.js`, or `cloudflare/crypto-engine.js`.
