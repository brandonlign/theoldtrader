# Trial 4 implementation freeze — `ctrend-v1`

Frozen: 2026-08-18, **before Trial 4 universe membership, post-2022 data, development performance, or final-holdout performance were observed**.

This note makes implementation choices explicit where `manifests/ctrend-v1.json` described the statistical rule but did not fully specify numerical mechanics. These are pre-result clarifications only; they do not use any Trial 4 outcome.

## Decision and data continuity

- Weekly decision timestamp is **Monday 00:00 UTC exactly**. A member without a valid Monday daily open is ineligible for that decision; the decision is not shifted to a later weekday for that asset.
- Indicators use only bars with timestamps strictly before the decision open.
- Indicator construction requires the final **201 consecutive UTC daily bars** before the decision. Any gap in that window makes that member ineligible for that decision; no interpolation or forward-fill is allowed.
- Price indicators use close; volume indicators use quote-asset volume. Chaikin money flow uses daily high/low/close and quote-asset volume.

## Indicator mechanics

- RSI is 14-day Wilder RSI. The initial average gain/loss is the arithmetic mean over the first 14 changes in the 201-day window, followed by Wilder recursive smoothing.
- Stochastic `%K` is `(close - 14d low)/(14d high - 14d low)`; a zero high-low range maps to `0.5`. `%D` is the simple mean of the latest three `%K` values.
- Stochastic RSI positions current RSI within the latest 14 finite RSI observations; a zero RSI range maps to `0.5`.
- CCI uses 20-day typical price and mean absolute deviation with the conventional `0.015` constant; a zero deviation maps to `0`.
- EMA initialization is the simple mean of the first full EMA window available inside the 201-day input, followed by the standard `2/(n+1)` recursion.
- Price and volume MACD are `(EMA12-EMA26)/EMA12`; the signal feature is MACD minus its 9-observation EMA.
- Bollinger bands use the 20-day close mean plus/minus two **population** standard deviations.
- The 28 raw indicators are transformed independently at each decision by average cross-sectional ranks for ties, mapped monotonically to `[-0.5, 0.5]`.

## First-stage cross-sectional forecasts

- Each of the 28 ranked indicators receives an independent ordinary least-squares cross-sectional regression with an intercept and **equal weight per eligible frozen-universe asset**. Point-in-time market-cap weights are deliberately not introduced because they are not part of the frozen Binance archive input; this is a TheOldTrader adaptation, not a reproduction claim.
- A weekly regression requires at least 10 eligible assets.
- At prediction time, each indicator's intercept and slope are the arithmetic means of the latest **52 eligible weekly regressions whose labels have fully ended before the one-week embargo cutoff**.
- If 52 eligible weekly first-stage regressions are not available, no Trial 4 prediction is produced for that week.

## Second-stage elastic net

- The second stage uses exactly the latest **52 prior weeks with available first-stage forecasts**, after applying the same one-week embargo. This is a nested rolling implementation: the second stage never trains on the prediction week or the immediately embargoed week.
- Each training row is one asset-week observation with 28 first-stage expected-return forecasts as features and realized next-week gross log return as target.
- Features are standardized using **training-sample-only** mean and population standard deviation. The intercept is unpenalized.
- Elastic-net mixing parameter is fixed at `alpha = 0.5`.
- Lambda candidates are exactly **50 log-spaced values** from the training-sample `lambda_max` to `lambda_max × 1e-4`.
- Coordinate descent uses a maximum of **10,000 iterations** and a maximum-coordinate-change convergence tolerance of **1e-9**.
- AICc uses `k = number of nonzero penalized coefficients + 1 intercept`. If AICc ties numerically, prefer the **larger lambda**.
- A coefficient is treated as selected only when it is strictly greater than `1e-10`.
- The final Trial 4 forecast is **not** the elastic-net weighted prediction. Elastic net is a selector only: retain first-stage forecasts with positive selected coefficients and take their equal-weight arithmetic mean. If none survive, the asset receives no eligible candidate forecast.

## Portfolio and anti-rescue boundary

- A forecast must exceed `log(1 + 140/10000)` to clear the frozen 140-bps round-trip gate.
- Rank surviving eligible assets by forecast, hold at most three, target 15% equity each, never exceed 15% single-asset or 45% total crypto exposure, and leave unallocated capital as cash.
- Existing positions are resized only on weekly decisions; all traded notional pays the frozen one-side fee/slippage/half-spread implementation cost.
- Development acquisition must contain **zero rows at or after 2026-01-01**. The 2026-01-01 through 2026-08-01 holdout remains a separate explicit one-shot path.

Any post-result change to these mechanics requires a new numbered alpha trial. Reporting-only fixes are allowed only if they cannot alter selected observations, forecasts, fills, costs, sizing, or returns.
