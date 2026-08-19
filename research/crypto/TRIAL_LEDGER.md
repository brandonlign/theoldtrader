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
| 5 | `tsmom-v1` | low-turnover Coinbase spot time-series momentum with downside-only volatility scaling | **FAILED development on 2026-08-18** | **Development gate failed; diagnostic/final not opened for promotion** | Frozen BTC/ETH/SOL monthly 30/90/180-day time-series momentum with downside-only 60-day volatility scaling and 140-bps round trip. User-executed frozen evaluator reported `Trial 5 development gate: FAIL`. Exact generated summary remains local/pending commit; no parameter rescue permitted. |
| 6 | `lowvol-v1` | monthly low-volatility selection across BTC/ETH/SOL spot | **FAILED development on 2026-08-18** | **Development gate failed; diagnostic/final not opened for promotion** | Frozen 90-day exact realized-vol formation, one-month holding, one lowest-vol asset at 15% post-friction exposure, at least 85% cash, no momentum/ML/leverage/shorting, same 140-bps full round trip. User-executed frozen evaluator reported `Trial 6 development gate: FAIL`. No parameter rescue permitted. |
| 7 | `cross-venue-funding-v1` | static BTC cross-venue perpetual funding spread: long Binance USD-M / short Hyperliquid | **FROZEN forward before first TheOldTrader cross-venue result; final implementation/provenance freeze 2026-08-19T23:19:57Z; scientific start 2026-08-20T00:00Z** | **90-day screen and 180-day final both unobserved** | Preserves the stale provisional-Trial-5 freeze (`ed726ad…`, `68dd166…`) without rewriting history; administratively renumbered after Trials 5/6 were consumed. BTC only, identical base units, one entry/exit, no switching/threshold/rebalancing/asset selection; 15 bps/order primary friction plus 25 bps/order promotion stress; first-party venue data only; strongest possible result is research-only promotion eligibility. Exact frozen manifest bytes, +10m context cutoff and +70m settlement-discovery cutoff are preregistered. |

### Why the flagship priority changed on 2026-08-19

Earlier on 2026-08-19, before the stale cross-venue branch was rediscovered and before the current literature/source audit was completed, the working conclusion was to finish Trial 2 before spending Trial 7. That conclusion was revised **before any Trial 7 candidate result** for two concrete reasons: (1) independent 2026 cross-venue funding evidence identifies a return source distinct from the failed spot-directional families; and (2) repository archaeology showed that this exact BTC-only long-Binance/short-Hyperliquid candidate had already been prospectively frozen on 2026-08-18 before the later Trial 5/6 evaluations. The revised priority therefore did not arise from seeing Trial 7 performance or inventing a rescue after failure.

Trial 2 remains the flagship **historical carry** candidate and must still be completed under its original checksum-archive protocol. Trial 7 is the flagship **forward cross-venue challenger**. They answer different questions: Trial 2 tests spot/perpetual carry on one venue family over a historical robustness window; Trial 7 tests whether a pre-frozen cross-venue funding differential survives a genuinely prospective 180-day window, basis risk, per-venue margin stress, and conservative four-order execution friction. Neither may borrow a favorable result, cost assumption, entry date, funding filter, or leverage choice from the other.

### Trial 2 provenance and anti-rescue

Trial 2's flagship label added on 2026-08-19 does **not** create a new candidate, change the frozen Trial 2 specification, or use a primary Trial 2 result; the primary result remains unobserved. `FLAGSHIP_CARRY.md` and the result-agnostic audit cannot promote Trial 2 and require untouched validation even after a positive historical result.

Trial 2 measurement/data revisions recorded before any P&L do **not** create new alpha trials: they remove implementation ambiguity or data leakage risk without changing the economic candidate. These include switching spot provenance to daily archives after the Binance monthly-archive discrepancy report, bounded funding-timestamp schedule normalization, separating perpetual execution from mark prices, and making the pre-existing equal-BTC-unit hedge authoritative over the contradictory earlier notional wording. All such changes are timestamped in the frozen manifest revision log.

### Trial 3–4 pre-result implementation history

Trial 3 pre-result engineering revisions do **not** create a new alpha trial because no Trial 3 universe, development return, or final return has been observed. They only make the already-frozen specification executable and strengthen the holdout firewall: a Python boolean-spelling defect is isolated behind a compatibility entrypoint; quantile/continuity/ridge/embargo implementation details are fixed before data; development acquisition is capped strictly before 2026-01-01; and the final workflow is separate, manual, one-shot, and overwrite-protected; revision 2 corrects position sizing so the frozen 15%/45% exposure caps hold after immediate modeled entry friction rather than only before costs. Any outcome-driven change after Trial 3 observation requires a new numbered trial.

Trial 4 is independent of Trial 3 performance even though it reuses the already-frozen 2022-only universe membership output. Trial 4 was frozen before that membership was available and before any Trial 4 post-2022 observations were accessed. It may not use Trial 3 coefficients, picks, P&L, or holdout results as inputs. Two implementation/provenance corrections were recorded **before any Trial 4 data or performance was observed**: (1) the unintended nested second 52-week warm-up was replaced by the intended single causal 52-week rolling estimator; (2) a draft monthly-archive data helper was superseded by official Binance market-data-only REST daily klines with raw-page URL/SHA-256 preservation. Neither correction changes Trial 4's economic candidate. Any outcome-driven change after the first Trial 4 development result requires a new numbered trial.

### Failed Trials 5–6

Trial 5 was deliberately independent of the blocked cross-sectional universe and of Trial 1's failed ridge replication. It tested a low-turnover time-series family motivated before performance observation by stronger time-series momentum evidence in realistic-assumption crypto studies. The frozen development gate failed on first evaluation. Therefore its lookbacks, monthly cadence, volatility target, asset set, weights, cost model, and entry rule are locked as a failed trial; changing any of them requires a new number and should not be presented as a rescue of Trial 5.

Trial 6 was a distinct cross-sectional low-volatility hypothesis motivated prospectively by a 2026 peer-reviewed crypto low-volatility study. It fixed one 90-day formation window and monthly holding period before evaluation, restricted the universe to the same three Coinbase spot assets to avoid introducing a survivorship-selected altcoin universe, and used a matched 15%-total-exposure equal-weight comparator so lower raw risk alone could not satisfy the development gate. The first frozen development evaluation failed. Its parameters are now locked as failed. Those two failures remain evidence against continuing to generate nearby retail-cost candle variants.

### Trial 7 provenance and final pre-start corrections

The stale branch `research/cross-venue-funding-v1` is preserved rather than force-reset. Its 2026-08-18 commits froze the same economic candidate as provisional Trial 5 before any TheOldTrader cross-venue result. Because that branch diverged before the later `tsmom-v1` and `lowvol-v1` experiments consumed Trials 5 and 6, the current candidate is administratively registered as Trial 7 without rewriting the original commits.

Before the 2026-08-20T00:00Z scientific start and before any Trial 7 candidate result, the current branch recorded and regression-locked all mechanism/provenance clarifications in the canonical manifest. These include:

- prospective start moved to 2026-08-20 because continuous acquisition was not established before the old Aug-19 boundary;
- Hyperliquid funding notional uses the first-party-documented oracle price;
- primary context sampling fixed at `HH:00:05Z`;
- critical-boundary restart catch-up permitted only inside the already-frozen +10-minute context tolerance;
- Hyperliquid settled-funding timestamps normalize to the nearest UTC hour only within ±60 seconds;
- Binance funding completeness follows first-party `nextFundingTime` announcements rather than a hidden fixed-eight-hour assumption;
- entry/exit use the first valid official context at or after their boundary within ten minutes;
- start-boundary funding is excluded while end-boundary funding is included because exit occurs after that settlement;
- market/context evidence is capped at boundary +10 minutes, while first-party funding-history responses through boundary +70 minutes may only prove already-in-window settlements; post-window market fields are prohibited from economics;
- exact canonical-manifest bytes and PRIMARY_LIVE compact/raw timestamps are bound before economics;
- max drawdown, fixed daily returns, zero-target Sortino, three 60-day contribution windows, decomposition and analytical break-even semantics are frozen;
- 25 bps/order cost stress plus explicit basis/margin stresses make promotion harder.

Published historical paper/replication data remain motivation only and may not score Trial 7 or select its subperiods.

After the scientific start, direction, venues, BTC-only asset choice, allocation, costs, collateral, boundaries, sampling/catch-up rule, context/discovery cutoffs, funding accounting/normalization, schedule audit, data substitution, holding rule, risk statistics, consistency windows and stress rules are locked. Any economically changed successor requires a new trial number.

## Execution experiments

| Execution trial | Experiment | Question | Status | Scientific evaluation status | Notes |
|---:|---|---|---|---|---|
| E1 | `coinbase-maker-execution-v1` | Can post-only best-bid/best-ask placement reduce effective implementation cost after conservative queue competition, non-fills, full-book taker depth, and adverse selection? | Frozen forward-data protocol | Data acquisition pending | Not an alpha strategy. Back-of-queue assumption; queue-ahead cancellations are not credited; one-hour recordings are engineering pilots only; first scientific window requires ≥168h and the frozen hash/coverage/sequence rules on all three products plus an independent full-book audit. |

## Multiple-testing rule

- Every future serious alpha/portfolio candidate increments the alpha trial ledger before its first evaluation.
- Replications using the exact frozen candidate logic are labeled `R` and do not lower the effective alpha trial count.
- Every materially changed execution rule—queue model, placement price, TTL, cancellation logic, order size set, maker/taker switching rule, or fill assumption—receives a new `E` number before evaluation.
- Data acquisition, reporting, provenance, or simulator bug fixes made before any real result may be logged as revisions to the same experiment only when they do not change the economic candidate; outcome-driven changes may not.
- Deflated Sharpe Ratio / selection-bias adjustments will be reported once there are enough evaluated alpha candidate trials for the correction to be meaningful; raw Sharpe is never treated as selection-adjusted performance.
- An experiment whose holdout/result has been observed cannot be modified and rerun under the same trial number.
