# TheOldTrader crypto research status — 2026-08-19

Authoritative current branch: `research/cross-venue-funding-v1-current`  
Draft stacked PR: **#15** against `research/tsmom-v1`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No research strategy has yet earned promotion over frozen TheOldTrader crypto v2.** Trial 1's completed robustness replication was weak/negative. Trials 5 (`tsmom-v1`) and 6 (`lowvol-v1`) failed their frozen development gates on first evaluation and are locked against rescue. Trials 3 and 4 remain frozen/unobserved behind their existing provenance/data requirements.

There are now two serious carry tracks with different evidence roles:

1. **Trial 2 `funding-carry-v1` — flagship historical carry candidate.** Its primary checksum-archive result remains unobserved. Exact-family REST replication 2R is observed but non-promotion evidence and still requires canonical reproduction.
2. **Trial 7 `cross-venue-funding-v1` — flagship forward carry challenger.** Static BTC-only long Binance USD-M `BTCUSDT` perpetual / short Hyperliquid BTC perpetual. The final pre-start implementation freeze is timestamped **2026-08-19T23:04:02Z**, before the scientific start at **2026-08-20T00:00:00Z**.

E1 `coinbase-maker-execution-v1` remains a separate execution experiment. It cannot be used as alpha evidence or to retroactively lower the costs of prior strategy trials.

## Trial 7 scientific state

**First Trial 7 candidate result observed:** no.  
**Scientific start:** 2026-08-20T00:00:00Z.  
**90-day screening boundary:** 2026-11-18T00:00:00Z.  
**Earliest supported screening evaluation:** 2026-11-18T00:10:00Z.  
**180-day final boundary:** 2027-02-16T00:00:00Z.  
**Earliest supported final evaluation:** 2027-02-16T00:10:00Z.  
**Strongest possible final classification:** `PROMOTION_ELIGIBLE_RESEARCH_ONLY`.

The authoritative specification is `research/crypto/manifests/cross-venue-funding-v1.json`. `TRIAL7_CROSS_VENUE_FUNDING_FROZEN.md` records the provenance/revision history, and `TRIAL7_OPERATIONS.md` is the operator runbook.

### Frozen economics

- BTC only.
- Long Binance USD-M `BTCUSDT` perpetual.
- Short Hyperliquid BTC perpetual.
- Identical BTC quantity on both legs.
- Approximately 15% of starting equity notional per leg.
- 20% starting-equity collateral reserve per venue.
- One entry and one exit.
- No rebalancing, compounding, funding threshold, direction switching, asset selection or leverage optimization.
- Primary all-in friction: **15 bps per venue order**, four fills total.
- Promotion cost stress: **25 bps per order**.
- Research maintenance threshold: 10% of current leg notional per venue.
- Frozen adverse relative-basis shocks: 5%, 10%, 25%.
- Unused capital remains zero-return cash.

### Frozen boundary economics

Entry and exit use the first valid official context **at or after** the respective UTC boundary within 10 minutes. Therefore:

- exact **start-boundary funding is excluded** because it settles before the post-boundary entry;
- exact **end-boundary funding is included** because it settles before the post-boundary exit;
- the evaluator refuses to run until the full 10-minute exit-context tolerance has elapsed.

The funding inclusion rule is `startBoundary < eventTime <= endBoundary`.

### Funding and basis accounting

Rates remain on their native venue schedules and are never forward-filled or resampled to a synthetic common interval.

- Hyperliquid short funding uses the matched official `oraclePx` after the normalized hourly event.
- Binance long funding uses the settled funding event's official `markPrice`.
- Primary P&L decomposition is `net funding + raw cross-venue basis - modeled execution friction = net P&L`.
- After-friction leg/basis P&L is diagnostic only and is never double-counted with the separately reported friction.

A positive funding spread is insufficient if cross-venue basis, four-fill execution friction, venue-specific collateral stress or drawdown erases it.

## Trial 7 first-party provenance firewall

Primary live collection targets **`HH:00:05Z`** and uses only public first-party Binance/Hyperliquid market-data endpoints. It has no order path and requires no exchange credentials.

Every scientific compact observation carries the canonical manifest SHA-256 and hashes of the exact raw venue responses. Before economics can run, the supported evaluator requires:

1. canonical manifest identity and compact/raw acquisition/hash consistency;
2. exact `recordedAt` binding between every PRIMARY_LIVE compact source and its raw payload;
3. independent raw semantic reconstruction of compact mark/oracle/funding fields;
4. Hyperliquid settled-funding timestamp normalization to the nearest UTC hour only within ±60 seconds, with raw time/skew preserved and conflicts/collisions rejected;
5. Binance funding completeness reconstructed from first-party `premiumIndex.nextFundingTime` announcements to settled `fundingRate.fundingTime`, including an exact end-boundary settlement delivered by the post-boundary exit poll;
6. hourly first-party context coverage, boundary contexts, Hyperliquid hourly funding completeness/oracle matching and remaining fail-closed data gates.

The recorder, evaluator and reporter are canonical-manifest locked. Custom Trial-7 manifests are rejected through the supported scientific commands.

`OFFICIAL_RECOVERY` is specified in `TRIAL7_DATA_RECOVERY.md` but is intentionally unable to score the candidate until an exact source-specific first-party raw semantic adapter is implemented and tested. Published paper/Zenodo data, aggregators, reconstructed third-party feeds and interpolation are prohibited from filling scientific observations.

## Trial 7 risk/reporting definitions

Before any result, the evaluator/reporting layer was frozen to:

- max drawdown beginning from **pre-entry starting equity**, so entry friction cannot disappear;
- fixed 24-hour boundary-to-boundary daily returns with final exit included in the last return;
- zero-target Sortino downside deviation;
- three consecutive 60-day **contribution** windows for the 180-day final;
- entry friction charged once in window 1 and exit friction once in window 3;
- a required telescope check that the three 60-day contributions sum back to full final P&L;
- analytical break-even all-in friction under the frozen four-fill model;
- deterministic reporting of live/recovery coverage, funding, raw basis, friction, cost stress, margin stress and consistency windows.

A failed provenance/data gate produces **no strategy economics**.

## Trial 7 validation state

The last fully executed repository-wide Vercel validation of the coherent scientific code path, at commit `84e5343fbdea3c12d52e3d68dbfa0bbf0abd8ce3`, completed:

- **170 tests / 170 passing / 0 failing**;
- the boundary/accounting adversarial suite, including start-excluded/end-included funding semantics;
- canonical-manifest command locks;
- raw semantic/provenance mutation tests;
- Binance schedule and Hyperliquid timestamp tests;
- basis/cost/margin failure tests;
- 60-day telescope, drawdown, Sortino and analytical break-even tests;
- successful Next.js production build.

After that green scientific-code checkpoint, only documentation plus the external-host systemd deployment helper/test were added. Current head is `63eeaae703db184daa1ecd07801c188b29ac56e0`. Vercel did **not** execute that head because the account hit its build-rate limit; GitHub reports the Vercel status target as the build-rate-limit upgrade page rather than a code-test failure. The exact installer currently on the branch was separately syntax-checked with `bash -n` and its branch lock, preflight commands and sealed recorder `ExecStart` invariants were verified locally. Do not represent current-head Vercel CI as green until the quota permits a real build.

Intermediate red Vercel deployments created while the manifest/core/tests were being updated commit-by-commit are superseded states, not the final scientific implementation. The coherent scientific head above is the relevant completed build.

## Trial 7 operations / remaining blocker

**No persistent primary-live collector is currently deployed by this branch or by Vercel.** The Vercel project exposes no durable storage backend suitable for the six-month evidence files, and GitHub Actions remains blocked by the account billing/spending-limit condition.

The branch now includes:

```bash
bash research/crypto/ops/install-trial7-recorder-systemd.sh
```

for an external long-running Linux host. It refuses the wrong branch or a dirty worktree, uses the lockfile through `npm ci`, runs the test suite + pre-start audit + sealed connectivity check, then installs a hardened systemd service invoking only `npm run research:cv:record` and writing to the gitignored Trial 7 data directory.

This installer has **not** been executed on the user's external host from this session; no SSH/host connector is available here. Do not claim primary-live acquisition is running until an actual host service/health check confirms it.

## Other research tracks

### Trial 2 — `funding-carry-v1`

Historical single-venue-family BTC spot/perpetual carry. Primary result remains unobserved; exact-family REST 2R is non-promotion evidence. Trial 2 remains worth completing under its original checksum-archive protocol because it answers a different historical robustness question from Trial 7's prospective cross-venue test.

### Trial 1 — `crypto-oos-v1`

The BTCUSDT Binance robustness replication failed: zero ridge holdout trades and negative forecast/realized-return relationship. That is evidence against rescuing the same candle information set with greater model complexity.

### Trial 3 — `cross-sectional-v1`

Frozen/unobserved behind the immutable 2022-only universe/data workflow.

### Trial 4 — `ctrend-v1`

Frozen/unobserved and may not borrow Trial 3 P&L/coefficients/picks.

### Trial 5 — `tsmom-v1`

**FAILED development** on the first frozen evaluation. No rescue under Trial 5.

### Trial 6 — `lowvol-v1`

**FAILED development** on the first frozen evaluation. No rescue under Trial 6.

### E1 — `coinbase-maker-execution-v1`

Frozen execution protocol, scientific acquisition pending. It remains execution evidence only and cannot rewrite strategy costs retrospectively.

## Required execution order

1. Preserve the canonical Trial 7 manifest unchanged after the scientific start.
2. Deploy/confirm the external `research:cv:record` service and use only sealed `research:cv:health` monitoring; do not inspect market values or estimated strategy P&L.
3. If acquisition gaps occur, restore primary capture. Do not enable recovered observations for scoring until the source-specific independent adapter is implemented/tested under the already-frozen recovery rules.
4. Do not evaluate Trial 7 before **2026-11-18T00:10:00Z**. The 90-day screen cannot promote or retune the candidate.
5. Do not evaluate the final before **2027-02-16T00:10:00Z**. A full pass can only produce `PROMOTION_ELIGIBLE_RESEARCH_ONLY`.
6. Complete primary Trial 2 and canonical 2R reproduction separately when provenance-preserving execution is available.
7. Continue E1 independently; do not use it to rewrite Trial 7's frozen 15/25-bps cost assumptions.
8. Keep Trials 3/4 frozen until their existing blockers are resolved.

Until qualifying evidence exists, frozen v2 remains the paper baseline and no research candidate is promoted.
