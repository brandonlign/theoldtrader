# MoneyMog crypto serious-trial ledger

This ledger counts serious candidate specifications so failed ideas cannot disappear and multiple testing remains visible. A replication of an existing frozen specification does not create a new candidate trial. Alpha/portfolio trials and execution-policy experiments are counted separately because testing a fill model is not evidence of return predictability, but failed execution variants still must not disappear.

## Alpha / portfolio strategy trials

| Trial | Experiment | Strategy family | Status | Final evaluation status | Notes |
|---:|---|---|---|---|---|
| 1 | `crypto-oos-v1` | pooled 24h ridge expected-return forecast + cost gate | Frozen | **Primary Coinbase holdout still untouched / infrastructure-blocked** | No parameter rescue permitted. |
| 1R | `binance-btc-replication-v1` | exact single-asset robustness replication of trial 1 | **Failed robustness diagnostic** | Evaluated on 2024-05-01→2024-11-01 BTCUSDT Binance spot | Not a new candidate configuration; ridge made zero holdout trades and had negative prediction/return correlation. |
| 2 | `funding-carry-v1` | delta-neutral spot/perpetual funding + basis carry | Frozen design; synchronized data acquisition pending | Not evaluated | Separate market-neutral family. No directional-candle features and no threshold tuning. |

## Execution experiments

| Execution trial | Experiment | Question | Status | Scientific evaluation status | Notes |
|---:|---|---|---|---|---|
| E1 | `coinbase-maker-execution-v1` | Can post-only best-bid/best-ask placement reduce effective implementation cost after conservative queue competition, non-fills, and adverse selection? | Frozen forward-data protocol | Data acquisition pending | Not an alpha strategy. Back-of-queue assumption; queue-ahead cancellations are not credited; one-hour recordings are engineering pilots only; first scientific window requires ≥168h and the frozen data-quality rules. |

## Multiple-testing rule

- Every future serious alpha/portfolio candidate increments the alpha trial ledger before its first evaluation.
- Replications using the exact frozen candidate logic are labeled `R` and do not lower the effective alpha trial count.
- Every materially changed execution rule—queue model, placement price, TTL, cancellation logic, order size set, maker/taker switching rule, or fill assumption—receives a new `E` number before evaluation.
- Data acquisition and simulator bug fixes made before any real result may be logged as revisions to the same experiment; outcome-driven changes may not.
- Deflated Sharpe Ratio / selection-bias adjustments will be reported once there are enough evaluated alpha candidate trials for the correction to be meaningful; raw Sharpe is never treated as selection-adjusted performance.
- An experiment whose holdout/result has been observed cannot be modified and rerun under the same trial number.
