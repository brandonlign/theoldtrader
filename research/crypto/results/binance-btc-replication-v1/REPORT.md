# MoneyMog auxiliary BTC robustness result — `binance-btc-replication-v1`

**Scientific status:** frozen OOS robustness diagnostic only. **Not promotion eligible.** It uses BTCUSDT Binance spot history rather than the predefined three-asset Coinbase universe, so it cannot substitute for or tune `crypto-oos-v1`.

## Holdout result

Holdout: **2024-05-01 through 2024-11-01**. Starting capital: **$10,000**. Modeled friction: **60 bps fee per side + 5 bps slippage per side + 10 bps round-trip spread**, for a **1.40% round-trip hurdle**.

| Strategy | Net return | Sharpe | Sortino | Max DD | Trades | Fees | Turnover / avg equity |
|---|---:|---:|---:|---:|---:|---:|---:|
| Frozen ridge24 cost gate | **0.00%** | 0.00 | 0.00 | 0.00% | 0 | $0.00 | 0.00x |
| Frozen MoneyMog v2 | **-2.09%** | -4.14 | -2.62 | -2.25% | 14 | $190.46 | 3.20x |
| Simple 30-day trend | **-3.30%** | -1.45 | -1.73 | -6.54% | 9 | $156.29 | 2.67x |
| BTC buy-and-hold, 15% exposure | **+2.84%** | 0.82 | 1.35 | -4.34% | 1 | $19.83 | 0.33x |
| Cash | 0.00% | 0.00 | 0.00 | 0.00% | 0 | $0.00 | 0.00x |

Frozen v2 won only **1 of 14** closed trades. Its $190.46 of modeled fees were equal to about **91% of the $208.97 net loss magnitude**; that ratio is descriptive, not a causal decomposition of the loss because price P&L, spread/slippage and fees interact.

## Ridge24 failure diagnosis

The ridge candidate did not merely miss the threshold by chance. In the untouched holdout its largest predicted 24-hour return was **1.2584%**, below the frozen **1.40%** cost hurdle, so it generated zero trades. More importantly, the forecast itself showed no validated directional edge: prediction/realized-return correlation was **-0.1194** over 183 holdout observations, with MAE **1.795%**.

Development was also weak. Across **11** walk-forward folds, ridge24 had **0 positive-return folds** and median fold Sharpe **0**. Only five development predictions cleared the cost hurdle; the candidate traded in four folds and each trading fold lost money. Development prediction/realized-return correlation was **-0.0819**.

This means the defensible conclusion is **not** “lower the cost hurdle until it trades.” The candidate is frozen as a failure. A lower threshold, different ridge penalty, altered feature set, or different horizon after observing this result would be a new experiment and must increment the trial ledger.

## What this says about v2

The result is consistent with the concern raised by v1: at MoneyMog's conservative retail cost assumptions, frequent directional trading is economically difficult. Frozen v2 turned over roughly **3.20× average equity** in six months while maintaining only **0.62% average BTC exposure**, yet still paid **1.90% of starting capital in fees** and lost 2.09% net. The low-turnover 15%-exposure buy-and-hold comparator was positive over the same interval.

This is not enough to conclude that buy-and-hold is universally superior or that v2 must fail on Coinbase. It is one BTC-only, cross-venue robustness sample. The primary Coinbase holdout remains untouched because GitHub Actions is blocked before checkout by the account billing/spending-limit issue recorded in `crypto-oos-v1/BLOCKED.md`.

## Reporting correction

The first raw auxiliary report used the first post-entry equity snapshot as its return base. That omitted day-one entry friction for strategies that entered immediately. The reporting calculation was corrected to anchor all strategies to the fixed **$10,000 starting capital**. **No signals, trades, fills, parameters, or holdout observations changed.** The git history preserves the original evaluator and the correction.

## Decision

- `ridge24_cost_gate`: **failed auxiliary OOS robustness test; preserve unchanged.**
- frozen v2: remains the live **paper** baseline; this result does not authorize changing or promoting it.
- no live-money trading enabled.
- primary `crypto-oos-v1`: still sealed / not evaluated.
- next candidate must be independently motivated rather than a rescue of ridge24. Given the observed cost sensitivity and the literature, a separately evaluated low-turnover or market-neutral source of return is more defensible than increasing model complexity on the same candle features.
