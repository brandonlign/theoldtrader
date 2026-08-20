# TheOldTrader crypto research status — 2026-08-19

Authoritative current branch: `research/bitnomial-carry-v1`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No research strategy has yet earned promotion over frozen TheOldTrader crypto v2.** Trials 5 (`tsmom-v1`) and 6 (`lowvol-v1`) failed their first frozen development evaluations. Trial 1's completed robustness replication was weak/negative. Trials 3 and 4 remain frozen/unobserved behind their existing provenance/data requirements.

The current forward flagship candidate is now **Trial 8 `bitnomial-carry-v1`**: buy Coinbase BTC-USD spot and short equal BTC units of Bitnomial `PBTCUC` perpetual, testing whether Bitnomial funding carry survives realistic spot costs, perpetual execution, basis movement and collateral stress.

## Why Trial 8 replaced Trial 7 operationally

Trial 7 `cross-venue-funding-v1` was fully frozen before its intended start but never produced a scientific candidate observation. Binance USD-M's public futures endpoint returned HTTP 451 from both available acquisition environments. Trial 7 is therefore preserved as an **operational no-start**, not a strategy-performance failure.

Trial 8 is a new numbered candidate rather than a venue edit to Trial 7 because its instruments and basis/collateral mechanics differ. No Trial 7 result exists and none may tune Trial 8.

## Trial 8 frozen state

**Final pre-observation freeze:** 2026-08-20T00:16:31Z  
**Scientific start:** 2026-08-20T02:00:00Z / 10:00 PM ET Aug. 19  
**90-day screen:** 2026-11-18T02:00:00Z  
**180-day final:** 2027-02-16T02:00:00Z  
**Strongest possible result:** `PROMOTION_ELIGIBLE_RESEARCH_ONLY`

The exact canonical manifest is `research/crypto/manifests/bitnomial-carry-v1.json`, pinned to Git blob `3bb0261f909129a9892f0958105decabcaacd39b`. Supported `research:t8:*` commands verify those bytes before execution.

### Frozen economics

- Long Coinbase Exchange BTC-USD spot.
- Short Bitnomial `PBTCUC` Bitcoin USD Centi perpetual.
- Whole Bitnomial contracts only; 0.01 BTC per contract.
- Target 20% of $10,000 starting equity notional per leg; 25% actual-notional cap.
- Coinbase spot quantity equals the BTC represented by the short contracts.
- 30% starting-equity reserve for perpetual collateral.
- No rebalancing, compounding, threshold, direction switching, asset selection or leverage optimization.
- Unused capital remains zero-return cash.

### Funding mechanism

Bitnomial funding settles every eight hours at 00:00, 08:00 and 16:00 UTC. Positive funding means longs pay shorts. Trial 8 credits each valid short settlement as:

`BTC quantity × official funding mark_price × funding_rate`.

Rates stay on their native intervals; missing settlements are not synthesized, interpolated or forward-filled.

### Frozen costs

Primary Coinbase spot per order:

- 60 bps fee;
- 10 bps adverse slippage;
- observed ask on entry and bid on exit.

Primary Bitnomial perpetual per order:

- published $0.10/contract/side exchange+clearing fee;
- 10 bps adverse price slippage.

Promotion stress:

- Coinbase 100 bps all-in per order;
- Bitnomial 25 bps adverse slippage plus the fixed per-contract fee.

### Data/provenance gates

Only public first-party Coinbase and Bitnomial data may score the candidate. No API keys or exchange credentials are required.

The recorder preserves exact raw responses and SHA-256 hashes for:

- Coinbase BTC-USD ticker;
- Bitnomial product specs;
- Bitnomial product data;
- Bitnomial funding history.

The evaluator independently reparses those raw bytes and verifies every compact Coinbase/Bitnomial field before P&L can run. It also requires:

- first valid entry/exit context at or after the declared boundary within ten minutes;
- ≥98% hourly context coverage;
- no context gap >130 minutes;
- Bitnomial `last_price_time` no more than 30 minutes stale;
- invariant Bitnomial product ID and 0.01-BTC contract identity;
- every expected eight-hour funding settlement present;
- all compact source hashes available in the raw archive.

A failed data/provenance gate produces **no strategy economics**.

### Margin/risk gates

Trial 8 uses a frozen 15% research maintenance threshold on current perpetual notional and adverse relative-basis shocks of 5%, 10% and 20%. The observed path and every frozen shock must avoid a margin breach.

The evaluator reports funding, spot P&L, perpetual P&L, raw basis P&L, fees, net P&L, max drawdown, Sharpe, Sortino, high-cost stress and three fixed 60-day windows.

## Commands

Connectivity only, with no candidate values persisted:

```bash
npm run research:t8:connectivity
```

Persistent Linux installation:

```bash
bash research/crypto/ops/install-trial8-recorder-systemd.sh
```

Sealed health monitoring:

```bash
npm run research:t8:health
```

Screen/final evaluation and deterministic reporting are described in `TRIAL8_OPERATIONS.md`. Early evaluation is refused by the evaluator.

## Validation state

Trial 8 has its own adversarial evaluator tests covering clean carry, missing funding intervals, stale Bitnomial prices, adverse basis movement, harsher cost stress, pre-boundary context rejection, product-ID drift and early-evaluation refusal. Exact-manifest and systemd-installer regression tests are also present.

Fresh Vercel builds for the latest Trial 8 head have not yet appeared after a burst of repository pushes; therefore **do not claim current-head full-suite CI is green until a new build actually completes**. The prior Trial 7 scientific branch had a completed 170/170 full-suite checkpoint, but that is not Trial 8 validation.

## Other tracks

- Trial 2 `funding-carry-v1`: historical carry flagship; primary result remains unobserved.
- Trial 7 `cross-venue-funding-v1`: operational no-start; no performance result.
- Trials 3/4: frozen/unobserved.
- Trial 5 `tsmom-v1`: failed development; no rescue.
- Trial 6 `lowvol-v1`: failed development; no rescue.
- E1 `coinbase-maker-execution-v1`: separate execution experiment; cannot rewrite strategy costs retrospectively.

Until Trial 8 or another frozen candidate earns qualifying evidence, v2 remains the paper baseline.
