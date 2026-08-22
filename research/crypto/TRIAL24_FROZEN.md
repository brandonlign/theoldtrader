# Trial 24 freeze

Trial 24 is a new paper-only experiment frozen before any Trial 24 economic evaluation. Real-money execution is forbidden.

## Why this is a new trial

Trial 23 passed every frozen development criterion but its one-shot 2026 final was completely inactive under the 15% annualized funding entry hurdle. That result is preserved as a final no-go; its threshold is not changed in place. Trial 24 explicitly counts the Trial 23 inactivity as prior information and tests a new threshold under a new trial identity and on a different derivative/carry information set.

## Frozen assets

Use exactly ETHUSDT and BNBUSDT. These were independently source-qualified in earlier pre-economic carry attempts: exact development source acquisition completed for ETH in Trial 17 before SOL blocked that trial, and for BNB in Trial 18 before XRP blocked that trial. Neither earlier trial reached an ETH or BNB carry economic output, and neither acquired the 2026 Trial 24 final window. Asset selection uses prior source-availability evidence, not ETH/BNB carry returns.

## Frozen economics and risk design

Two equal $5,000 sleeves. When active, each sleeve uses 15% of sleeve equity in spot and 80% as isolated perpetual collateral, with equal coin units long spot / short perpetual. No leverage beyond the matched hedge.

Signal at boundary t uses only the prior 90 realized 8-hour funding observations (30 days), excluding the current boundary. Enter when trailing annualized funding is at least 10%; exit when it is at most 3%; minimum state duration is 90 boundaries. The 10% entry hurdle is frozen from the already-frozen venue-native transaction-cost model: with 10 bp fee, 5 bp slippage, and 10 bp round-trip spread per leg, approximate two-leg round-trip friction on a 15%-notional hedge is about 0.12% of sleeve equity, while 10% annualized funding on 15% notional earns about 0.123% of sleeve equity over the 30-day minimum state. No ETH/BNB Trial 24 funding values were consulted to set the threshold.

Retain Trial 23's deterministic risk re-anchoring: close and immediately reopen at full modeled costs after 180 active boundaries (60 days) or whenever perpetual mark notional reaches 25% of current sleeve equity, unless the funding exit triggers first. Observed isolated margin is checked before any boundary re-anchor. Retained positions must also pass +25%, +50%, and +100% adverse perpetual-mark gap stresses under a 5% maintenance-margin research assumption.

Costs per leg: 10 bp fee per side, 5 bp adverse slippage per side, 10 bp round-trip spread. These are inherited from the already-frozen Trial 20 assumptions and were not selected from Trial 24 outcomes.

Development window: 2022-01-01 through 2026-01-01. Final holdout: 2026-01-01 through 2026-08-01, one shot and inaccessible unless development passes.

Development gate: positive net return; Sharpe >= 0.80; max drawdown >= -2%; at least two completed round trips; at least one active sleeve; no realized margin breach; all frozen gap stresses pass; exact source union for both sleeves.

Final promotion gate: positive net return; Sharpe >= 0.75; max drawdown >= -2%; at least one completed round trip; at least one active sleeve; no realized margin breach; all frozen gap stresses pass; exact source union for both sleeves. Passing authorizes only a paper-baseline promotion proposal, never real-money trading.

After the first Trial 24 development economic output, no asset, threshold, lookback, hysteresis, state duration, sizing, collateral, re-anchor rule, dates, costs, source rule, stress, or gate may change under Trial 24.
