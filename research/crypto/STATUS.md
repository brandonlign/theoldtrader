# MoneyMog crypto research status — 2026-08-18

Authoritative research branch: `research/crypto-oos-v1`  
Draft PR: `#8`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No new strategy has yet earned promotion over frozen MoneyMog crypto v2.** Trial 1's completed robustness replication was weak/negative. Trial 2 carry remains economically interesting but its primary checksum-archive evaluation is still unobserved. Trial 3 cross-sectional selection and Trial 4 CTREND-inspired selection are both frozen before their development results and remain blocked on the immutable 2022-only universe formation. E1 maker execution remains a separate unobserved execution experiment.

The correct next scientific action is to execute the already-frozen experiments, not tune them or invent outcome-driven rescue variants.

## Frozen live baseline

MoneyMog crypto v2 remains the paper-only live baseline. This research branch does not modify `src/crypto/strategy.js`, `src/crypto/risk.js`, or `cloudflare/crypto-engine.js`. Research candidates must pass their own frozen development/final gates before any separate promotion proposal can exist.

## Trial 1 — `crypto-oos-v1`

**Family:** pooled 24-hour ridge expected-return forecast + explicit cost gate.  
**Primary Coinbase final holdout:** untouched / infrastructure-blocked.  
**Robustness replication 1R:** evaluated and failed.

The frozen BTCUSDT Binance replication produced zero ridge holdout trades, negative forecast/realized-return correlation, and did not support rescuing the same candle information set with a more complex model. Frozen v2 and a simple trend comparator lost money in that replication while low-exposure BTC buy-and-hold was positive. Trial 1 may not be retuned after that observed robustness result.

## Trial 2 — `funding-carry-v1`

**Family:** market-neutral BTC spot / BTCUSDT perpetual funding-and-basis carry.  
**Primary:** frozen, unobserved, checksum-archive acquisition pending.  
**Replication 2R:** official Binance REST exact-family replication observed and locked; non-promotion only.

The frozen economics remain: 15% starting-equity BTC spot purchase, short exactly the same BTC units in the perpetual, 20% starting-equity futures collateral reserve, no rebalancing or funding-sign/timing optimization, both-leg MoneyMog friction, standard contract prices for execution, mark price for funding/valuation/margin, exact 8-hour schedule, no interpolation, and frozen gap/margin stress.

2R passed its 5,295-row official REST data gate before its first economic result was observed. The exact originating result bundle still requires canonical repository reproduction. 2R cannot replace the primary Trial 2 and cannot authorize a live change.

## Trial 3 — `cross-sectional-v1`

**Family:** low-turnover monthly cross-sectional spot expected-return selection.  
**Status:** frozen before universe formation and before any 2023+ Trial 3 result.  
**Development/final performance observed:** no.

Trial 3 first forms an immutable 30-symbol Binance USDT universe using **2022 information only**: historically enumerated symbols, deterministic stable/fiat/leveraged-token exclusions, minimum data continuity, and ranking by median 2022 daily quote volume. Current survivors may not be substituted.

After membership is committed, the frozen candidate uses six cross-sectional characteristics, pooled ridge (`lambda=10`), a one-month embargo, monthly top-three long-only selection, 15% per asset, 45% total exposure, and the same 140-bps round-trip friction. Development acquisition is physically capped before `2026-01-01`; the `2026-01-01` to `2026-08-01` holdout is separate and one-shot.

## Trial 4 — `ctrend-v1`

**Family:** CTREND-inspired cross-sectional aggregate technical-trend expected-return selection.  
**Status:** frozen before the shared 2022-only universe was formed and before any Trial 4 post-2022 performance was observed.  
**Development/final performance observed:** no.

Trial 4 was added prospectively after literature review rather than as a Trial 1/3 parameter tweak. It reuses exactly Trial 3's immutable 30-member 2022-only universe but does **not** use Trial 3 P&L, coefficients, picks, or holdout results.

Frozen candidate mechanics:

- 28 daily price/volume technical indicators: momentum oscillators, price moving-average/MACD signals, volume moving-average/MACD/money-flow signals, and Bollinger/volatility signals;
- exact 201-day trailing continuity, strict pre-decision feature cutoff, no interpolation;
- contemporaneous cross-sectional average-rank transform mapped to `[-0.5, 0.5]`;
- weekly Monday 00:00 UTC decisions;
- one causal fixed 52-week training window with a one-week embargo;
- 28 univariate cross-sectional first-stage forecasts with 52-week coefficient smoothing;
- second-stage elastic net with `alpha=0.5`, training-only feature standardization, deterministic 50-point log lambda path, and AICc selection;
- retain only strictly positive forecast-selection coefficients, then equally average the surviving first-stage forecasts;
- top three long-only forecasts only when expected gross log return clears the frozen 140-bps hurdle;
- 15% target per asset, 45% maximum total exposure, unallocated capital in cash.

### Pre-result implementation correction

The first authored helper accidentally nested a second independent 52-week out-of-sample forecast history on top of the 52-week first-stage window. Before any Trial 4 universe/data/performance was observed, this was identified as an implementation interpretation error and corrected to a **single 52-week rolling parameter-estimation window**, consistent with the frozen statistical intent. The correction is recorded explicitly in `TRIAL4_IMPLEMENTATION_REVISION_1.md`; scientific evaluation must call `walkForwardCtrendWindowedPredictions` from `lib/ctrend-windowed.js`.

### Pre-result data-source correction

The first Trial 4 data-builder draft reused Trial 3's monthly Binance Vision archive helper. Before any Trial 4 data or performance was observed, that was rejected because the research record already documents historical monthly-SPOT archive discrepancies and the Trial 4 specification intended an official daily/market-data source. `TRIAL4_DATA_REVISION_1.md` records the correction.

The authoritative Trial 4 builder is now `prepare-ctrend-rest-data.py`, using only the immutable 2022-formed membership and Binance's market-data-only REST daily klines. Every raw REST response page is preserved with its URL and SHA-256, the normalized dataset is separately hashed, no current `exchangeInfo` survivor list is consulted, and no interpolation is permitted. Development mode physically stops before `2026-01-01`; final acquisition is separate and requires explicit confirmation.

Scientific evaluation is additionally wrapped by `ctrend-evaluate-rest.js`, which refuses any Trial 4 dataset unless it identifies the frozen official REST source. The superseded monthly-helper builder remains only as transparent Git history and must not be used for scientific evaluation.

Trial 4 now has:

- frozen manifest and anti-rescue marker;
- explicit numerical implementation freeze plus the pre-result rolling-window correction log;
- explicit pre-result data-provenance correction log;
- tested 28-signal/embargo/elastic-net core;
- REST-only holdout-safe data builder with raw-page hashes;
- REST-source-enforcing scientific evaluator with 21-day weekly momentum, cash, major-coin buy/hold, and static-liquidity comparators;
- 13-week fold diagnostics, signal-selection frequency, first-stage stability, fee/turnover/exposure and per-asset contribution diagnostics;
- frozen promotion checker;
- manual development and one-shot final workflows that preserve page-level provenance and raw response artifacts.

No Trial 4 result exists yet.

## Execution experiment E1 — `coinbase-maker-execution-v1`

**Question:** can post-only maker execution reduce MoneyMog implementation cost after queue position, non-fills, full-book depth and adverse selection?  
**Status:** frozen forward-data protocol; scientific data acquisition pending.

E1 remains separate from alpha research. The first scientific window requires at least 168 hours for each BTC/ETH/SOL feed plus frozen hash, coverage, sequence, queue and independent taker-VWAP audit rules. No E1 scientific result has been observed.

## Infrastructure state

GitHub Actions was retried on 2026-08-18 and still failed **before any workflow step started**, consistent with the account Actions billing/spending-limit block. That prevents the official universe-formation and checksum/REST workflows from running. The current execution environment also cannot resolve the official Binance archive or market-data REST hosts directly, so the immutable 2022 universe and Trial 4 development data cannot honestly be acquired here as a substitute.

This is an infrastructure blocker, not a strategy result. Do not infer performance from it and do not weaken provenance rules to bypass it.

## Tested implementation state on 2026-08-18

Local deterministic validation completed before any Trial 4 performance was observed:

- 13 JavaScript tests passed covering signal count, tie ranking, no-future feature cutoff, daily-gap rejection, weekly schedule, 52-week/embargo logic, elastic-net/AICc behavior, corrected one-window estimation, and promotion-gate behavior;
- 3 legacy Python firewall tests passed for the superseded builder, covering development cutoff, explicit final confirmation, and boundary-mismatch abort behavior;
- 3 additional authoritative REST-builder tests are committed for development/final separation, exact daily-kline normalization, and non-midnight timestamp rejection and are required by both Trial 4 workflows;
- syntax/compile checks were completed for the Trial 4 model, corrected windowed estimator, evaluator, REST-source wrapper, promotion checker and authoritative REST data builder.

These are implementation/provenance checks only. They are **not** evidence that Trial 4 is profitable.

## Required next execution order

1. Run the existing Trial 3 universe-formation workflow and commit the immutable 2022-only 30-symbol membership/source hashes.
2. Run Trial 3 development and Trial 4 development independently; neither may access 2026 rows. Trial 4 must use the authoritative REST builder/evaluator only.
3. Reproduce carry 2R canonically and run primary Trial 2 when checksum-archive compute is available.
4. Only after a candidate's development evidence is frozen may its separate one-shot final holdout be opened.
5. Apply the pre-frozen promotion checker. A failure creates a recorded failed trial; it does not authorize parameter rescue under the same trial number.
6. Keep E1 execution evidence separate from alpha evidence.

Until those steps produce qualifying evidence, frozen v2 remains the paper baseline and no research candidate is promoted.
