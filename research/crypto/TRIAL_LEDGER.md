# TheOldTrader crypto serious-trial ledger

This ledger counts serious candidate specifications so failed ideas cannot disappear and multiple testing remains visible. A replication of an existing frozen specification does not create a new candidate trial. Alpha/portfolio trials and execution-policy experiments are counted separately because testing a fill model is not evidence of return predictability, but failed execution variants still must not disappear.

> Historical note: later strategy numbers 5–13 were developed on stacked research branches after this ledger originated. This branch-local ledger preserves Trials 1–4 and their authoritative state; the project-wide numbering must not reuse 5–13.

## Alpha / portfolio strategy trials

| Trial | Experiment | Strategy family | Status | Final evaluation status | Notes |
|---:|---|---|---|---|---|
| 1 | `crypto-oos-v1` | pooled 24h ridge expected-return forecast + cost gate | Frozen | **Primary Coinbase holdout still untouched / infrastructure-blocked** | No parameter rescue permitted. |
| 1R | `binance-btc-replication-v1` | exact single-asset robustness replication of trial 1 | **Failed robustness diagnostic** | Evaluated on 2024-05-01→2024-11-01 BTCUSDT Binance spot | Not a new candidate configuration; ridge made zero holdout trades and had negative prediction/return correlation. |
| 2 | `funding-carry-v1` | equal-BTC-unit spot/perpetual funding + basis carry | **Frozen; official synchronized data acquisition pending** | **Not evaluated / no primary carry P&L observed** | Separate market-neutral family. 15% spot allocation determines BTC units; short exactly those units. Standard contract opens are execution references, markPrice opens are valuation/funding/margin references. Raw funding `calc_time` is preserved and normalized to the nearest scheduled 8h boundary only within the frozen 60-second tolerance. Exact 5,295-row official grid, checksums, no interpolation. |
| 2R | `funding-carry-v1R-api` | exact official-REST delivery replication of Trial 2 | **Observed and locked; non-promotion replication** | Full frozen 5,295-row REST replication observed; canonical workflow reproduction still pending | Does not create a new alpha candidate and cannot replace Trial 2 primary. No economic/data-selection rescue permitted. |
| 3 | `cross-sectional-v1` | low-turnover cross-sectional spot expected-return selection | **Observed development; INTEGRITY NO-GO** | **2026 final holdout deliberately untouched and permanently blocked under this specification** | Frozen development was strong (+83.74%, Sharpe 1.23), and exact-data continuity audit passed, but the 2022 universe includes `LUNAUSDT` across old-LUNA/LUNC and new-LUNA underlying identities. The preregistered no-data-integrity-exception criterion therefore fails. Do not repair or open final under Trial 3. See `TRIAL3_POST_DEVELOPMENT_INTEGRITY_REVIEW.md`. |
| 4 | `ctrend-v1` | CTREND-inspired cross-sectional aggregate technical-trend ensemble | **Frozen development computation started; shared-universe integrity exception discovered** | **Final holdout blocked; no promotion under current shared universe** | Uses exactly Trial 3's immutable 30-member universe, so the `LUNAUSDT` underlying-identity defect propagates to Trial 4. Any already-running development output is preserved as diagnostic evidence only. Do not open final or repair in place. |

Trial 2 measurement/data revisions recorded before any P&L do **not** create new alpha trials: they remove implementation ambiguity or data leakage risk without changing the economic candidate. These include switching spot provenance to daily archives after the Binance monthly-archive discrepancy report, bounded funding-timestamp schedule normalization, separating perpetual execution from mark prices, and making the pre-existing equal-BTC-unit hedge authoritative over the contradictory earlier notional wording. All such changes are timestamped in the frozen manifest revision log.

Trial 3 pre-result engineering revisions did not create a new alpha trial because no Trial 3 universe, development return, or final return had been observed when those revisions were made. After Trial 3 development was observed, a separate read-only integrity audit exactly reproduced the development dataset SHA-256 and found zero gap-bridging target rows and zero selected holding intervals with daily-data gaps. It then identified the separate `LUNAUSDT` underlying-identity problem through source/asset-identity review. Because the frozen promotion criteria require no data-integrity exception, Trial 3 is locked as a non-promotable integrity no-go without accessing the 2026 final holdout. Any repaired universe is a new numbered alpha trial.

Trial 4 is independent of Trial 3 performance even though it reuses Trial 3's frozen universe. That dependency now makes the same underlying-identity exception scientifically material to Trial 4. No Trial 4 economic/statistical rule may be edited after its development execution began; its final holdout remains sealed and any repaired shared-universe successor requires a new trial identity.

## Execution experiments

| Execution trial | Experiment | Question | Status | Scientific evaluation status | Notes |
|---:|---|---|---|---|---|
| E1 | `coinbase-maker-execution-v1` | Can post-only best-bid/best-ask placement reduce effective implementation cost after conservative queue competition, non-fills, full-book taker depth, and adverse selection? | Frozen forward-data protocol | Data acquisition pending | Not an alpha strategy. Back-of-queue assumption; queue-ahead cancellations are not credited; one-hour recordings are engineering pilots only; first scientific window requires ≥168h and the frozen hash/coverage/sequence rules on all three products plus an independent full-book audit. |

## Multiple-testing rule

- Every future serious alpha/portfolio candidate increments the project-wide alpha trial number before its first evaluation. Numbers 5–13 already exist on later stacked research branches and must not be reused.
- Replications using the exact frozen candidate logic are labeled `R` and do not lower the effective alpha trial count.
- Every materially changed execution rule—queue model, placement price, TTL, cancellation logic, order size set, maker/taker switching rule, or fill assumption—receives a new `E` number before evaluation.
- Data acquisition, reporting, provenance, or simulator bug fixes made before any real result may be logged as revisions to the same experiment only when they do not change the economic candidate; outcome-driven changes may not.
- Deflated Sharpe Ratio / selection-bias adjustments will be reported once there are enough evaluated alpha candidate trials for the correction to be meaningful; raw Sharpe is never treated as selection-adjusted performance.
- An experiment whose holdout/result has been observed cannot be modified and rerun under the same trial number.
