# MoneyMog crypto serious-trial ledger

This ledger counts serious candidate specifications so failed ideas cannot disappear and multiple testing remains visible. A replication of an existing frozen specification does not create a new candidate trial; a changed model, feature set, horizon, threshold, execution rule, or strategy family does.

| Trial | Experiment | Strategy family | Status | Final evaluation status | Notes |
|---:|---|---|---|---|---|
| 1 | `crypto-oos-v1` | pooled 24h ridge expected-return forecast + cost gate | Frozen | **Primary Coinbase holdout still untouched / infrastructure-blocked** | No parameter rescue permitted. |
| 1R | `binance-btc-replication-v1` | exact single-asset robustness replication of trial 1 | **Failed robustness diagnostic** | Evaluated on 2024-05-01→2024-11-01 BTCUSDT Binance spot | Not a new candidate configuration; ridge made zero holdout trades and had negative prediction/return correlation. |
| 2 | `funding-carry-v1` | delta-neutral spot/perpetual funding + basis carry | Frozen design; synchronized data acquisition pending | Not evaluated | Separate market-neutral family. No directional-candle features and no threshold tuning. |

## Multiple-testing rule

- Every future serious candidate specification increments this ledger before its first evaluation.
- Replications using the exact frozen candidate logic are labeled `R` and do not lower the effective trial count.
- Deflated Sharpe Ratio / selection-bias adjustments will be reported once there are enough evaluated candidate trials for the correction to be meaningful; raw Sharpe is never treated as selection-adjusted performance.
- An experiment whose holdout has been observed cannot be modified and rerun under the same trial number.
