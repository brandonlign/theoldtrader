# MoneyMog crypto research status — 2026-08-12

Authoritative research branch: `research/crypto-oos-v1`  
Draft PR: `#8`  
Live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Frozen live baseline

MoneyMog crypto v2 remains the frozen paper baseline. Research code may import its signal/risk functions read-only for historical comparison, but this branch does not modify the execution path.

## Trial 1 — `crypto-oos-v1`

**Family:** pooled 24-hour ridge expected-return forecast with an explicit cost gate.  
**Primary data:** Coinbase BTC-USD / ETH-USD / SOL-USD 15-minute candles.  
**Final holdout:** 2026-03-01 through 2026-08-01.  
**Status:** FROZEN; PRIMARY HOLDOUT UNTOUCHED.

The primary evaluator is ready and includes walk-forward training, 24-hour embargo, realistic fees/slippage/spread, exact frozen-v2 comparison, trend/buy-hold/cash controls, regime analysis, stability diagnostics, and reproducible reports/plots. A first-entry performance-accounting bug discovered in the auxiliary replication was corrected in the primary pipeline **before any primary result was observed**.

### Infrastructure blocker

GitHub Actions repeatedly refuses to start any job before checkout with:

> The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings

This is not a model result. `results/crypto-oos-v1/BLOCKED.md` records the original attempts. New pushes continue to receive the same zero-step failure.

## Trial 1R — `binance-btc-replication-v1`

**Purpose:** exact-family BTC-only cross-venue robustness diagnostic; not promotion eligible and not a substitute for the Coinbase holdout.  
**Data:** BTCUSDT 15-minute Binance spot history, exact source SHA-256 preserved.  
**Holdout:** 2024-05-01 through 2024-11-01.  
**Status:** EVALUATED; FAILED ROBUSTNESS DIAGNOSTIC.

Corrected holdout summary:

| Strategy | Net return | Sharpe | Closed trades | Modeled fees |
|---|---:|---:|---:|---:|
| ridge24 cost gate | 0.00% | 0.00 | 0 | $0.00 |
| frozen MoneyMog v2 | -2.09% | -4.14 | 14 | $190.46 |
| 30-day trend | -3.30% | -1.45 | 9 | $156.29 |
| BTC buy-and-hold at 15% exposure | +2.84% | +0.82 | 1 | $19.83 |
| cash | 0.00% | 0.00 | 0 | $0.00 |

Ridge24 had 0 positive-return development folds out of 11. In the holdout, forecast/realized-return correlation was -0.119 and the maximum 24-hour forecast was 1.258%, below the frozen ~1.40% round-trip hurdle. **Do not lower the hurdle, alter lambda/features/horizon, or otherwise rescue trial 1 after observing this.**

The auxiliary evaluator initially anchored returns to the first post-entry snapshot and therefore omitted first-entry friction for strategies that entered immediately. That reporting calculation was corrected to anchor to the fixed $10,000 starting capital; no signals, fills or trades changed. Git history and the result report preserve the correction.

## Trial 2 — `funding-carry-v1`

**Family:** market-neutral BTC spot / BTCUSDT perpetual funding-and-basis carry.  
**Status:** FROZEN DATA ACQUISITION PENDING; NO CARRY P&L OBSERVED.

Frozen design:

- long BTC spot / short equal BTC units of USD-M perpetual;
- 15% spot notional, 20% account reserve as futures collateral;
- no funding threshold, sign filter, leverage tuning, rebalancing, or entry-date selection;
- same conservative MoneyMog friction on both legs;
- actual basis P&L, funding cash flows, margin accounting, and +25%/+50%/+100% gap stress;
- historical robustness window fixed to 2021-05-01 through 2026-03-01;
- the funding payment coincident with entry is not earned;
- historical result is robustness/development evidence only because whole-sample funding summary statistics were visible before the manifest was fully frozen;
- any promotion would require a later untouched forward or independently sealed evaluation.

Data provenance is deliberately strict. Because open Binance public-data issue #475 reports cases where monthly SPOT archives differ from daily/API history, MoneyMog freezes checksum-verified **daily** BTCUSDT 8-hour spot archives, monthly USD-M 8-hour mark-price archives, and monthly funding-rate archives. `prepare-carry-data.py` verifies every official `.CHECKSUM`, uses only exact kline opens at funding timestamps, forbids interpolation, and rejects incomplete/non-8-hour funding grids. `carry-evaluate.js` independently marks both legs and never credits the first funding payment.

## Research conclusion so far

The evidence does **not** support promoting a more complex directional ML model. The only completed OOS robustness test found weak/negative 24-hour forecast information and severe cost sensitivity in v2/trend trading. That makes a different, low-turnover economic return source such as carry a better next scientific test than a post-hoc Transformer/XGBoost rescue on the same candle features.

This is a research conclusion, not a claim that carry will work. Trial 2 must still survive both-leg costs, basis movements, funding, and margin stress.
