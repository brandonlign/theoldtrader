# Trial 4 freeze marker — `ctrend-v1`

Frozen: 2026-08-18, **before Trial 4 universe membership was available and before any Trial 4 2023+ model-training, development, or final-holdout data/performance were inspected**.

Trial number: **4**  
Family: cross-sectional aggregate technical-trend expected-return selection  
Live promotion: **disabled**  
Authoritative specification: `research/crypto/manifests/ctrend-v1.json`

## Why this trial exists

Trial 4 is a prospectively specified, literature-backed alternative to simply adding model complexity to Trial 1 or tweaking Trial 3 momentum settings. Fieberg et al. (2025), *A Trend Factor for the Cross Section of Cryptocurrency Returns*, report that an aggregate price/volume technical signal predicts the cross-section of cryptocurrency returns and remains present in large/liquid subsets and after their transaction-cost analysis. Recent 2026 momentum evidence is substantially less supportive of plain cross-sectional momentum under realistic/survivorship-aware assumptions. MoneyMog therefore tests the aggregate-information idea directly under its own much harsher retail costs and historical-universe controls rather than assuming the published result transfers.

This is **not** a reproduction claim. `ctrend-v1` is CTREND-inspired and deliberately adapted to MoneyMog's constraints: a frozen historical top-30 liquid universe, long-only positions, 15% per asset, 45% total exposure, cash reserve, and a 140 bps modeled round-trip hurdle.

## Firewall

Trial 4 shares only the already-frozen **2022-only universe-formation output** of Trial 3. It may not use Trial 3 performance, coefficients, selected assets, development results, or final results as inputs.

The sequence is mandatory:

1. Form and commit `cross-sectional-v1-universe.json` using Trial 3's already-frozen 2022-only rule.
2. Trial 4 accepts exactly those 30 members without replacement or reranking.
3. Only then may Trial 4 acquire/inspect 2023+ data.
4. Development acquisition must stop before `2026-01-01`.
5. The `2026-01-01` through `2026-08-01` final holdout is a separate one-shot evaluation and may not be used to change the specification.

No current exchange symbol list may be used to repair membership. A missing/delisted member is handled by the frozen continuity rule, not survivor substitution.

## Frozen signal family

The candidate uses exactly **28** daily price/volume technical signals in four groups:

- five momentum oscillators;
- nine price-trend / moving-average signals;
- ten volume-trend / money-flow signals;
- four Bollinger/volatility signals.

Each raw signal is transformed into a contemporaneous cross-sectional rank mapped to `[-0.5, 0.5]`. There is no full-sample normalization.

The forecasting model is frozen as a two-stage rolling ensemble:

- independent first-stage cross-sectional return forecasts for each signal using only pre-embargo labels and a trailing 52-week history;
- second-stage elastic net with fixed mixing parameter `alpha=0.5`;
- lambda selected by training-sample AICc, **not** by development Sharpe/P&L;
- only positively weighted first-stage forecasts survive;
- the final forecast is the equal-weight mean of surviving forecasts;
- if no signal survives, the strategy does not trade.

Weekly trades are long-only and limited to the top three forecasts that individually exceed the frozen 140 bps gross-return hurdle. Exposure and costs match the MoneyMog research risk envelope.

## Anti-rescue rule

Trial 4 becomes outcome-locked as soon as any Trial 4 development performance is observed. After that point, changing any of the following requires Trial 5 or later:

- universe rule or membership;
- technical-signal definitions or count;
- cross-sectional rank transform;
- 52-week estimator window;
- elastic-net mixing parameter;
- AICc lambda-selection rule;
- positive-coefficient inclusion rule;
- weekly rebalance schedule;
- cost hurdle;
- selected-asset count or position sizing;
- development/final dates.

Implementation/data-provenance fixes before any Trial 4 performance is observed may remain Trial 4 only when they preserve the economic/statistical candidate and are recorded transparently.

## Current status

No Trial 4 performance has been observed. GitHub Actions remains blocked before checkout by the repository/account Actions billing/spending condition as of the 2026-08-18 retry. That is infrastructure state, not evidence for or against the candidate.
