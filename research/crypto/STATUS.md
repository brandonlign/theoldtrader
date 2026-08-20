# TheOldTrader crypto research status — 2026-08-19

Authoritative research branch: `research/tsmom-v1`  
Draft PR: `#14` stacked on research PR `#8`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No new strategy has yet earned promotion over frozen TheOldTrader crypto v2.** Trial 1's completed robustness replication was weak/negative. Trials 5 (`tsmom-v1`) and 6 (`lowvol-v1`) both failed their frozen development gates on first evaluation and are locked against rescue. Trial 3 and Trial 4 remain frozen/unobserved behind their immutable-universe/data-acquisition requirements.

The current **flagship strategy research candidate is Trial 2 `funding-carry-v1`**, not because it has been proven profitable, but because it is a genuinely different, low-turnover, delta-neutral return source with an already-frozen primary protocol. The primary checksum-archive Trial 2 result remains unobserved. Its observed official-REST replication 2R remains non-promotion evidence and still requires canonical reproduction.

E1 `coinbase-maker-execution-v1` remains the parallel flagship **execution** experiment. It must not be treated as alpha evidence or used to retroactively lower the cost model of Trials 1–6.

The correct next scientific actions are therefore to execute the already-frozen primary carry experiment and E1 evidence collection, not tune failed spot-price families or freeze an opportunistic Trial 7.

## Flagship carry decision

`FLAGSHIP_CARRY.md` records the current prioritization and evidence ladder. Nothing in that decision changes Trial 2 economics.

A result-agnostic audit is now available through:

```bash
npm run research:carry:flagship -- research/crypto/results/funding-carry-v1/summary.json
```

The audit can only return historical rejection or `PROMISING_HISTORICAL_ONLY`; it can never promote the strategy. It rejects broken exact-grid provenance, any historical maintenance-margin breach, any failure of the already-frozen +25%/+50%/+100% gap stresses, incomplete P&L/fee decomposition, or non-positive net return versus cash. Even its strongest historical label still requires a later untouched forward or independently sealed validation.

## Trial 1 — `crypto-oos-v1`

**Family:** pooled 24-hour ridge expected-return forecast + explicit cost gate.  
**Primary Coinbase final holdout:** untouched / infrastructure-blocked.  
**Robustness replication 1R:** evaluated and failed.

The frozen BTCUSDT Binance replication produced zero ridge holdout trades, negative forecast/realized-return correlation, and did not support rescuing the same candle information set with a more complex model. Frozen v2 and a simple trend comparator lost money in that replication while low-exposure BTC buy-and-hold was positive. Trial 1 may not be retuned after that observed robustness result.

## Trial 2 — `funding-carry-v1` — FLAGSHIP STRATEGY RESEARCH CANDIDATE

**Family:** market-neutral BTC spot / BTCUSDT perpetual funding-and-basis carry.  
**Primary:** frozen, unobserved, checksum-archive acquisition pending.  
**Replication 2R:** official Binance REST exact-family replication observed and locked; non-promotion only.

The frozen economics remain unchanged: 15% starting-equity BTC spot purchase, short exactly the same BTC units in the perpetual, 20% starting-equity futures collateral reserve, no rebalancing or funding-sign/timing optimization, both-leg TheOldTrader friction, standard contract prices for execution, mark price for funding/valuation/margin, exact 8-hour schedule, no interpolation, and frozen gap/margin stress.

The flagship label is a research-priority label only. Primary historical robustness must be produced canonically, pass the result-agnostic audit, and then survive untouched forward or independently sealed validation before any separate promotion proposal can exist.

## Trial 3 — `cross-sectional-v1`

**Family:** low-turnover monthly cross-sectional spot expected-return selection.  
**Status:** frozen before universe formation and before any 2023+ Trial 3 result.  
**Development/final performance observed:** no.

Trial 3 remains blocked on immutable 2022-only historical-universe formation. Its frozen design and holdout firewall remain unchanged.

## Trial 4 — `ctrend-v1`

**Family:** CTREND-inspired cross-sectional aggregate technical-trend expected-return selection.  
**Status:** frozen before shared 2022-only universe formation and before any Trial 4 post-2022 performance.  
**Development/final performance observed:** no.

Trial 4 remains frozen and unobserved. It may not use Trial 3 P&L, coefficients, picks, or holdout results as inputs.

## Trial 5 — `tsmom-v1`

**Status:** **FAILED development on first frozen evaluation.**  
No parameter, cadence, lookback, volatility target, asset-set, cost, or entry-rule rescue is permitted under Trial 5.

## Trial 6 — `lowvol-v1`

**Status:** **FAILED development on first frozen evaluation.**  
No formation-window, holding-period, universe, exposure, cost, or selector rescue is permitted under Trial 6.

## Execution experiment E1 — `coinbase-maker-execution-v1`

**Question:** can post-only maker execution reduce implementation cost after queue position, non-fills, full-book depth and adverse selection?  
**Status:** frozen forward-data protocol; scientific data acquisition pending.

E1 remains separate from alpha research. The first scientific window requires at least 168 hours for each BTC/ETH/SOL feed plus frozen hash, coverage, sequence, queue and independent taker-VWAP audit rules. No E1 scientific result has been observed.

The three-product runner now emits 30-second progress heartbeats, child-process state, and bytes written so an engineering/scientific recording cannot silently die while appearing active.

## Microstructure-alpha note

Recent quarter-hour/order-imbalance research is scientifically relevant to the L2/trade data E1 already records, especially multi-hour return predictability after quarter-hour opening flow. It is **not** promoted to Trial 7 here. The reported signal magnitude is measured in basis points and its direct opening-return trading effect is smaller still, while TheOldTrader's current retail friction is much larger. A new microstructure-alpha trial should be frozen only if execution evidence first makes the economics credible; E1 itself must not be mined as alpha training data after its outcomes are observed without a separate prospective protocol.

## Infrastructure state

GitHub Actions has been blocked before workflow steps by the account Actions billing/spending-limit condition. That still blocks the manual canonical primary carry workflow and several official-data workflows.

Vercel preview builds are functioning and provide repository-wide deterministic validation. The flagship-audit addition passed the existing project test/build path; it does not substitute for the missing official carry data acquisition.

## Required next execution order

1. **Primary Trial 2:** run the existing checksum-archive carry workflow exactly once when provenance-preserving execution is available; do not change the frozen candidate.
2. Run the new result-agnostic carry flagship audit on that immutable summary. Historical failure closes the frozen flagship candidate; historical success remains `PROMISING_HISTORICAL_ONLY`.
3. Canonically reproduce the already-observed exact-family 2R result without changing 2R.
4. Continue E1 engineering/scientific acquisition independently; execution evidence cannot rewrite prior alpha/carry results.
5. If carry clears historical evidence, commit a later untouched forward or independently sealed validation protocol **before viewing its result**. Only that unchanged validation can support a future promotion proposal.
6. Keep Trials 3/4 frozen until their existing provenance/data blockers can be resolved. Do not use their unobserved state as permission for outcome-driven redesign.
7. Do not create Trial 7 merely to keep trying variants. A new candidate should introduce a defensible new return source and be frozen before its first result.

Until qualifying evidence exists, frozen v2 remains the paper baseline and no research candidate is promoted.
