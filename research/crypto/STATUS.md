# TheOldTrader crypto research status — 2026-08-19

Authoritative current branch: `research/cross-venue-funding-v1-current`  
Parent research branch: `research/tsmom-v1` / draft PR `#14`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No new strategy has yet earned promotion over frozen TheOldTrader crypto v2.** Trial 1's completed robustness replication was weak/negative. Trials 5 (`tsmom-v1`) and 6 (`lowvol-v1`) both failed their frozen development gates on first evaluation and are locked against rescue. Trial 3 and Trial 4 remain frozen/unobserved behind their immutable-universe/data-acquisition requirements.

There are now **two serious carry tracks**, with different evidence roles:

1. **Trial 2 `funding-carry-v1` — flagship historical carry candidate.** It is the already-frozen single-venue-family spot/perpetual carry protocol. Its primary checksum-archive result remains unobserved. The observed exact-family REST replication 2R remains non-promotion evidence and still requires canonical reproduction.
2. **Trial 7 `cross-venue-funding-v1` — flagship forward carry challenger.** It is a static BTC-only long-Binance-USD-M / short-Hyperliquid perpetual pair, frozen prospectively before any TheOldTrader cross-venue result. Scientific observation starts at **2026-08-20T00:00:00Z**, with a sealed 90-day screen ending **2026-11-18T00:00:00Z** and a 180-day final ending **2027-02-16T00:00:00Z**.

E1 `coinbase-maker-execution-v1` remains the parallel flagship **execution** experiment. It must not be treated as alpha evidence or used to retroactively lower the cost model of prior trials.

### Why the Trial 7 decision changed

Earlier on 2026-08-19 the working recommendation was to finish Trial 2 and E1 before spending Trial 7. That recommendation is now revised **before any Trial 7 candidate result**. Two pieces of new information materially changed the decision:

- a current literature/source audit identified an independently studied cross-venue perpetual funding spread as a genuinely different return source with first-party public venue data available for prospective observation; and
- repository archaeology found that this exact BTC-only candidate had already been frozen prospectively on the stale `research/cross-venue-funding-v1` branch on 2026-08-18, before the later time-series-momentum and low-volatility experiments consumed Trials 5 and 6.

The stale branch is preserved. Its original commits are `ed726ad32574c5aa41ef791dc90f19bff46b0e1e` (provisional Trial-5 freeze) and `68dd16647fe7721bbd5509162fec1f8fc3a90a13` (forward recorder). The current candidate is administratively registered as Trial 7 rather than rewriting those commits or pretending the idea was invented after the Trial 5/6 failures.

## Trial 2 — `funding-carry-v1` — FLAGSHIP HISTORICAL CARRY

**Family:** market-neutral BTC spot / BTCUSDT perpetual funding-and-basis carry.  
**Primary:** frozen, unobserved, checksum-archive acquisition pending.  
**Replication 2R:** official Binance REST exact-family replication observed and locked; non-promotion only.

The frozen economics remain unchanged: 15% starting-equity BTC spot purchase, short exactly the same BTC units in the perpetual, 20% starting-equity futures collateral reserve, no rebalancing or funding-sign/timing optimization, both-leg TheOldTrader friction, standard contract prices for execution, mark price for funding/valuation/margin, exact 8-hour schedule, no interpolation, and frozen gap/margin stress.

`FLAGSHIP_CARRY.md` records the historical-carry evidence ladder. The result-agnostic audit is available through:

```bash
npm run research:carry:flagship -- research/crypto/results/funding-carry-v1/summary.json
```

The audit can only return historical rejection or `PROMISING_HISTORICAL_ONLY`; it can never promote the strategy. Primary historical robustness still has to be produced canonically and then survive later untouched validation before any separate promotion proposal can exist.

## Trial 7 — `cross-venue-funding-v1` — FLAGSHIP FORWARD CHALLENGER

**Family:** static cross-venue perpetual funding spread.  
**Direction:** long Binance USD-M `BTCUSDT` perpetual / short Hyperliquid BTC perpetual.  
**Asset selection:** BTC only, frozen.  
**Scientific mode:** forward only.  
**First TheOldTrader cross-venue result observed:** no.

The economic candidate is deliberately simple:

- identical BTC quantity on both legs;
- approximately 15% of starting equity notional per leg at entry;
- 20% starting-equity collateral reserve per venue;
- one entry and one exit;
- no rebalancing;
- no compounding;
- no funding threshold;
- no direction switching;
- no asset selection;
- no leverage optimization;
- unused capital remains cash.

Primary execution friction is frozen at **15 bps all-in per venue order**, applied adversely to both venue entries and exits: four orders total. A separate **25 bps/order** stress must also remain profitable for the final gate. The primary cost is intentionally not a VIP/maker discount assumption.

### Trial 7 funding and basis accounting

Funding rates stay on their native venue schedules; rates are never converted to a synthetic common interval and never forward-filled.

- Hyperliquid short funding: at each observed hourly event strictly inside the declared window, `+BTC quantity × matched official oracle price × funding rate`.
- Binance long funding: at each observed official funding event strictly inside the declared window, `-BTC quantity × event markPrice × funding rate`.
- Funding exactly on the frozen start or end boundary is excluded.

Cross-venue basis P&L is reported separately from funding. A positive funding spread is not enough to pass if relative venue prices, four execution frictions, or margin risk erase the carry.

### Trial 7 provenance and data gate

`manifests/cross-venue-funding-v1.json` and `TRIAL7_CROSS_VENUE_FUNDING_FROZEN.md` are authoritative. Candidate evaluation uses first-party venue data only. The published paper/replication package is design motivation and **cannot** score Trial 7 or authorize promotion.

The recorder:

```bash
npm run research:cv:connectivity
npm run research:cv:once
npm run research:cv:record
```

stores a compact hourly record plus the exact raw venue responses in a concatenated gzip archive. Every raw response is SHA-256 hashed; every compact record carries the frozen-manifest SHA-256. Pre-start `connectivity` mode validates source schemas without persisting or printing candidate marks/rates.

Scientific evaluation:

```bash
npm run research:cv:evaluate -- screening \
  research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson \
  research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz
```

and later the same command with `final` refuses to run before its frozen boundary. It verifies raw-response hashes, hourly recorder coverage, funding-event coverage, exact manifest identity, Hyperliquid funding-to-oracle matching, Binance funding marks, cross-venue basis P&L, each venue's collateral path, observed research margin, frozen 5%/10%/25% adverse basis shocks, primary and 25-bps/order stressed execution costs, three non-overlapping 60-day windows, and total-equity drawdown.

The 90-day classification can only be `SCREENING_PASS_NO_PROMOTION`, `SCREENING_FAIL_NO_PROMOTION`, or a data-gate failure. The strongest possible 180-day result is **`PROMOTION_ELIGIBLE_RESEARCH_ONLY`**. That label permits only a separate proposal to replace the paper baseline; it never authorizes real-money trading.

### Trial 7 pre-result implementation corrections

The current branch records these before any Trial 7 result:

1. provisional trial number 5 → administrative Trial 7 because Trials 5/6 were later consumed by other experiments;
2. prospective start Aug. 19 → Aug. 20 because continuous acquisition was not established before the old boundary passed;
3. Hyperliquid funding notional uses official `oraclePx`, correcting the stale draft's `markPx` wording;
4. 25 bps/order cost stress plus explicit basis/margin stresses added as harder promotion gates;
5. funding exactly on entry/exit boundaries excluded, and the directional comparator fixed to Binance premium-index `indexPrice` so no new selectable spot feed is introduced.

None of these revisions used a Trial 7 P&L, funding spread, favorable subperiod, asset screen, threshold, leverage search, or cost optimization.

## Trial 1 — `crypto-oos-v1`

**Family:** pooled 24-hour ridge expected-return forecast + explicit cost gate.  
**Primary Coinbase final holdout:** untouched / infrastructure-blocked.  
**Robustness replication 1R:** evaluated and failed.

The frozen BTCUSDT Binance replication produced zero ridge holdout trades, negative forecast/realized-return correlation, and did not support rescuing the same candle information set with a more complex model. Trial 1 may not be retuned after that observed robustness result.

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

E1 remains separate from strategy evidence. The first scientific window requires at least 168 hours for each BTC/ETH/SOL feed plus frozen hash, coverage, sequence, queue and independent taker-VWAP audit rules. No E1 scientific result has been observed.

The three-product runner emits 30-second progress heartbeats, child-process state, and bytes written so a recording cannot silently die while appearing active.

## Microstructure-alpha note

Recent quarter-hour/order-imbalance research remains scientifically relevant to the L2/trade data E1 records, but it is **not** Trial 7. Its reported basis-point-scale signal currently has less economic margin than the newly frozen cross-venue funding candidate. E1 itself remains execution evidence and may not be mined retrospectively as alpha without a separate prospective protocol.

## Deterministic implementation validation

Trial 7 added nine adversarial synthetic tests covering:

- frozen-boundary refusal;
- a complete positive 180-day path that can only become research-promotion eligible;
- missing hourly Hyperliquid funding;
- missing raw-response hashes;
- positive funding erased by adverse basis movement;
- primary-cost profit erased by the frozen 25-bps/order stress;
- observed per-venue margin breach;
- conflicting duplicate funding observations;
- exclusion of funding exactly on frozen start/end boundaries.

The first full repository build after those tests ran **113 tests with 113 passing** and completed the Next.js production build. This is implementation evidence only, not performance evidence.

## Infrastructure state

GitHub Actions remains blocked before workflow steps by the account Actions billing/spending-limit condition. That still blocks the manual canonical primary Trial 2 workflow and several other official-data workflows.

Vercel preview builds are functioning and provide repository-wide deterministic validation. They do not substitute for the prospective Trial 7 data window or the missing canonical Trial 2 result.

## Required next execution order

1. **Trial 7 pre-start engineering:** finish source/recorder provenance checks before 2026-08-20T00:00Z without observing/storing a candidate result before the boundary.
2. **Trial 7 acquisition:** preserve the frozen manifest hash and begin hourly first-party recording at/after the declared start. Do not inspect a strategy P&L before the sealed 90-day screen.
3. **Primary Trial 2:** run the existing checksum-archive carry workflow exactly once when provenance-preserving execution is available; do not change the frozen candidate.
4. Run the result-agnostic Trial 2 flagship audit on its immutable summary. Historical failure closes that frozen candidate; historical success remains `PROMISING_HISTORICAL_ONLY`.
5. Canonically reproduce the already-observed exact-family 2R result without changing 2R.
6. Continue E1 acquisition independently; execution evidence cannot rewrite prior strategy results.
7. Keep Trials 3/4 frozen until their existing provenance/data blockers can be resolved. Do not use their unobserved state as permission for outcome-driven redesign.
8. After the first Trial 7 result, do not alter its direction, venues, asset, allocation, costs, collateral, timing, data substitution, funding accounting, or stress rules. A changed successor requires Trial 8.

Until qualifying evidence exists, frozen v2 remains the paper baseline and no research candidate is promoted.
