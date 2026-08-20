# TheOldTrader crypto serious-trial ledger

This ledger counts serious candidate specifications so failed ideas cannot disappear and multiple testing remains visible. A replication of an existing frozen specification does not create a new candidate trial. Alpha/portfolio trials and execution-policy experiments are counted separately because testing a fill model is not evidence of return predictability, but failed execution variants still must not disappear.

## Alpha / portfolio strategy trials

| Trial | Experiment | Strategy family | Status | Final evaluation status | Notes |
|---:|---|---|---|---|---|
| 1 | `crypto-oos-v1` | pooled 24h ridge expected-return forecast + cost gate | Frozen | **Primary Coinbase holdout still untouched / infrastructure-blocked** | No parameter rescue permitted. |
| 1R | `binance-btc-replication-v1` | exact single-asset robustness replication of trial 1 | **Failed robustness diagnostic** | Evaluated on 2024-05-01→2024-11-01 BTCUSDT Binance spot | Not a new candidate configuration; ridge made zero holdout trades and had negative prediction/return correlation. |
| 2 | `funding-carry-v1` | equal-BTC-unit spot/perpetual funding + basis carry | **Frozen; flagship historical carry candidate; official synchronized primary data acquisition pending** | **Not evaluated / no primary carry P&L observed** | Flagship is a research-priority label only, not promotion evidence. 15% spot allocation determines BTC units; short exactly those units. Standard contract opens are execution references, markPrice opens are valuation/funding/margin references. Raw funding `calc_time` is preserved and normalized to the nearest scheduled 8h boundary only within the frozen 60-second tolerance. Exact 5,295-row official grid, checksums, no interpolation. |
| 2R | `funding-carry-v1R-api` | exact official-REST delivery replication of Trial 2 | **Observed and locked; non-promotion replication** | Full frozen 5,295-row REST replication observed; canonical workflow reproduction still pending | Does not create a new alpha candidate and cannot replace Trial 2 primary. No economic/data-selection rescue permitted. |
| 3 | `cross-sectional-v1` | low-turnover cross-sectional spot expected-return selection | **Frozen before universe formation and before 2023+ Trial 3 data** | **No development or final performance observed** | Static 30-member universe formed from 2022-only Binance Vision liquidity; monthly pooled ridge on six frozen cross-sectional features; top three at 15% each; 45% total cap; frozen 140 bps round-trip friction. Universe formation, development-only acquisition, evaluator, comparators, promotion criteria, and one-shot final workflow are all authored before the first Trial 3 result. Final holdout begins 2026-01-01 and is physically excluded from the development acquisition workflow. |
| 4 | `ctrend-v1` | CTREND-inspired cross-sectional aggregate technical-trend ensemble | **Frozen before shared 2022-only universe formation and before any Trial 4 post-2022 data/performance** | **No development or final performance observed** | Uses exactly Trial 3's immutable 30-member historical universe; 28 frozen price/volume technical signals; weekly cross-sectional ranks; one causal 52-week rolling estimator; elastic net (`alpha=0.5`, AICc lambda) selects positive first-stage forecasts; equal-average ensemble; top three long-only at 15% each; 45% cap; same 140 bps hurdle. Authoritative data are official Binance market-data-only REST daily klines with raw-page hashes; development is hard-stopped before the untouched 2026 final holdout. |
| 5 | `tsmom-v1` | low-turnover Coinbase spot time-series momentum with downside-only volatility scaling | **FAILED development on 2026-08-18** | **Development gate failed; diagnostic/final not opened for promotion** | Frozen BTC/ETH/SOL monthly 30/90/180-day time-series momentum with downside-only 60-day volatility scaling and 140-bps round trip. User-executed frozen evaluator reported `Trial 5 development gate: FAIL`. No parameter rescue permitted. |
| 6 | `lowvol-v1` | monthly low-volatility selection across BTC/ETH/SOL spot | **FAILED development on 2026-08-18** | **Development gate failed; diagnostic/final not opened for promotion** | Frozen 90-day exact realized-vol formation, one-month holding, one lowest-vol asset at 15% post-friction exposure, at least 85% cash, no momentum/ML/leverage/shorting, same 140-bps full round trip. User-executed frozen evaluator reported `Trial 6 development gate: FAIL`. No parameter rescue permitted. |
| 7 | `cross-venue-funding-v1` | static BTC cross-venue perpetual funding spread: long Binance USD-M / short Hyperliquid | **OPERATIONAL NO-START** | **No Trial 7 candidate observation or P&L** | Fully frozen before its intended 2026-08-20T00:00Z start, but Binance USD-M public market-data requests returned HTTP 451 from both available collection environments. No scientific compact record was created. The specification remains preserved; this is not counted as a performance failure and may not be retroactively altered. |
| 8 | `bitnomial-carry-v1` | U.S.-accessible BTC cash-and-carry: long Coinbase BTC-USD spot / short Bitnomial PBTCUC perpetual | **FROZEN forward before first Trial 8 observation; start 2026-08-20T02:00Z** | **90-day screen and 180-day final unobserved** | Whole 0.01-BTC contracts, equal BTC units, 20% target notional/leg with 25% cap, no rebalancing/threshold/switching, first-party public sources only, conservative Coinbase retail costs + Bitnomial fees/slippage, 15% research maintenance gate, 5/10/20% basis shocks, exact raw-response semantic audit; strongest possible result is research-only promotion eligibility. |

## Trial 7 → Trial 8 transition

Trial 8 is **not** a renamed or rescued Trial 7. Trial 7 was never economically observed: its required Binance USD-M first-party endpoint rejected both available acquisition environments before a scientific start record could be produced. That operational fact is preserved.

Trial 8 receives a new trial number because it changes the economic instruments from Binance-perpetual/Hyperliquid-perpetual to Coinbase-spot/Bitnomial-perpetual. The mechanism—delta-hedged funding/carry—is related, but venue basis, execution, collateral and funding mechanics differ. Trial 8 was frozen independently before its 2026-08-20T02:00Z start. Trial 7 has no result that can be used to select Trial 8's direction, costs, notional, timing or gates.

## Trial 8 frozen design

Trial 8 buys exactly the BTC quantity represented by the whole Bitnomial `PBTCUC` contracts it shorts. The target is 20% of $10,000 starting equity per leg, subject to a 25% actual-notional cap caused by discrete 0.01-BTC contract sizing. Unused capital remains cash.

The primary execution model freezes Coinbase spot at 60 bps fee + 10 bps adverse slippage per order, and Bitnomial at the published $0.10/contract/side exchange+clearing fee plus 10 bps adverse price slippage. A separate high-cost stress raises Coinbase to 100 bps all-in/order and Bitnomial slippage to 25 bps/order.

Bitnomial funding is evaluated only on its native eight-hour intervals. Positive funding is credited to the short using the official event `mark_price`. Every expected settlement inside the held interval must exist. Entry/exit require first-party observations at or after the boundary, hourly context coverage must be at least 98%, stale Bitnomial last trades fail closed, raw source bytes are SHA-256 preserved and independently reparsed, and the observed/frozen stress path must remain above the 15% research maintenance threshold.

After the first Trial 8 observation, any economically material change requires Trial 9.

## Earlier-trial provenance and anti-rescue

Trial 2's flagship label does not create a new candidate, change the frozen Trial 2 specification, or use a primary result; its primary result remains unobserved. Trial 2 measurement/data corrections recorded before P&L remove implementation ambiguity without changing the candidate.

Trial 3 and Trial 4 remain frozen behind their already-declared universe/data workflows. Trial 5 and Trial 6 remain failed on their first frozen development evaluations; their parameters may not be rescued under the same numbers.

The preserved Trial 7 branch records its full pre-start provenance hardening, including first-party funding mechanisms, boundary timing, context/settlement cutoffs, exact manifest-byte identity, raw semantic auditing, risk-stat definitions and stress gates. Those engineering lessons may inform provenance hygiene, but Trial 7 outcomes cannot inform Trial 8 because no Trial 7 outcome exists.

## Execution experiments

| Execution trial | Experiment | Question | Status | Scientific evaluation status | Notes |
|---:|---|---|---|---|---|
| E1 | `coinbase-maker-execution-v1` | Can post-only best-bid/best-ask placement reduce effective implementation cost after conservative queue competition, non-fills, full-book taker depth, and adverse selection? | Frozen forward-data protocol | Data acquisition pending | Not an alpha strategy. Back-of-queue assumption; queue-ahead cancellations are not credited; one-hour recordings are engineering pilots only; first scientific window requires ≥168h and the frozen hash/coverage/sequence rules on all three products plus an independent full-book audit. |

## Multiple-testing rule

- Every future serious alpha/portfolio candidate increments the alpha trial ledger before its first evaluation.
- Replications using exact frozen candidate logic are labeled `R` and do not lower the effective alpha trial count.
- Every materially changed execution rule receives a new `E` number before evaluation.
- Data-acquisition/reporting/provenance fixes made before any real result may remain the same experiment only if they do not change the economic candidate; outcome-driven changes may not.
- Deflated Sharpe Ratio / selection-bias adjustments will be reported once enough alpha candidates have been evaluated for the correction to be meaningful; raw Sharpe is never treated as selection-adjusted performance.
- An experiment whose result has been observed cannot be modified and rerun under the same trial number.
