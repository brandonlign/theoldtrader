# TheOldTrader crypto research status — 2026-08-19

Authoritative current branch: `research/cross-venue-funding-v1-current`  
Draft stacked PR: **#15** against `research/tsmom-v1`  
Frozen live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Current conclusion

**No research strategy has yet earned promotion over frozen TheOldTrader crypto v2.** Trial 1's completed robustness replication was weak/negative. Trials 5 (`tsmom-v1`) and 6 (`lowvol-v1`) failed their frozen development gates on first evaluation and are locked against rescue. Trials 3 and 4 remain frozen/unobserved behind their existing provenance/data requirements.

There are two serious carry tracks with different evidence roles:

1. **Trial 2 `funding-carry-v1` — flagship historical carry candidate.** Its primary checksum-archive result remains unobserved. Exact-family REST replication 2R is observed but non-promotion evidence and still requires canonical reproduction.
2. **Trial 7 `cross-venue-funding-v1` — flagship forward carry challenger.** Static BTC-only long Binance USD-M `BTCUSDT` perpetual / short Hyperliquid BTC perpetual. The final pre-start implementation/provenance freeze is timestamped **2026-08-19T23:19:57Z**, before the scientific start at **2026-08-20T00:00:00Z**.

E1 `coinbase-maker-execution-v1` remains a separate execution experiment. It cannot be used as alpha evidence or to retroactively lower the costs of prior strategy trials.

## Trial 7 scientific state

**First Trial 7 candidate result observed:** no.  
**Scientific start:** 2026-08-20T00:00:00Z.  
**90-day screening boundary:** 2026-11-18T00:00:00Z.  
**Earliest supported screening evaluation:** 2026-11-18T01:10:00Z.  
**180-day final boundary:** 2027-02-16T00:00:00Z.  
**Earliest supported final evaluation:** 2027-02-16T01:10:00Z.  
**Strongest possible final classification:** `PROMOTION_ELIGIBLE_RESEARCH_ONLY`.

The authoritative specification is `research/crypto/manifests/cross-venue-funding-v1.json`. Its exact final bytes are pinned by `research/crypto/lib/trial7-freeze-identity.js`; supported `research:cv:*` commands verify those bytes before execution. `TRIAL7_CROSS_VENUE_FUNDING_FROZEN.md` records the provenance/revision history, and `TRIAL7_OPERATIONS.md` is the operator runbook.

### Frozen economics

- BTC only; long Binance USD-M `BTCUSDT`, short Hyperliquid BTC perpetual.
- Identical BTC quantity on both legs; approximately 15% of starting equity notional per leg.
- 20% starting-equity collateral reserve per venue.
- One entry and one exit; no rebalancing, compounding, funding threshold, direction switching, asset selection or leverage optimization.
- Primary all-in friction: **15 bps per venue order**, four fills total.
- Promotion cost stress: **25 bps per order**.
- Research maintenance threshold: 10% of current leg notional per venue.
- Frozen adverse relative-basis shocks: 5%, 10%, 25%.
- Unused capital remains zero-return cash.

### Frozen timing and cashflow semantics

Entry and exit use the first valid official context **at or after** the respective UTC boundary within 10 minutes. Exact start-boundary funding is excluded; exact end-boundary funding is included. Funding inclusion is `startBoundary < eventTime <= endBoundary`.

Normal primary collection targets `HH:00:05Z`. A critical-boundary supervisor may take one immediate snapshot only when a start/screen/final restart occurs after `:00:05` but still inside the same existing +10-minute context tolerance. It does not widen that tolerance.

The final freeze separates **market context** from **settlement discovery**:

- market/context cutoff: boundary **+10 minutes**;
- first-party settlement-discovery cutoff: boundary **+70 minutes**.

A later funding-history poll may only prove an already-in-window settlement. Its post-window mark, oracle, index, current-funding and future-schedule fields are prohibited from fills, funding-oracle matching, coverage, margin, basis, comparator and return calculations. The evaluation artifact records late event source timestamps/hashes and must state `postWindowMarketFieldsUsed=false`.

### Funding and basis accounting

Rates remain on native venue schedules and are never forward-filled or resampled to a synthetic interval.

- Hyperliquid short funding uses the matched official `oraclePx` at/after the normalized hourly event within the frozen tolerance.
- Binance long funding uses each settled event's official `markPrice`.
- Binance event completeness follows first-party `premiumIndex.nextFundingTime` announcements rather than assuming an immutable eight-hour interval.
- Hyperliquid raw settled timestamps normalize to the nearest UTC hour only within ±60 seconds; raw time/skew is preserved and conflicts/collisions fail closed.
- Primary decomposition is `net funding + raw cross-venue basis - modeled execution friction = net P&L`.

A positive funding spread is insufficient if cross-venue basis, four-fill execution friction, venue-specific collateral stress or drawdown erases it.

## Trial 7 provenance firewall

Every PRIMARY_LIVE compact observation carries the canonical manifest SHA-256 and hashes of the exact raw venue responses. Before economics can run, the supported evaluator requires:

1. exact frozen manifest identity and compact/raw acquisition/hash consistency;
2. exact `recordedAt` binding between every PRIMARY_LIVE compact source and its raw payload;
3. independent raw semantic reconstruction;
4. Hyperliquid timestamp normalization under the frozen ±60-second rule;
5. Binance announced-schedule-to-settlement completeness;
6. settlement-discovery isolation so late rows can contribute only already-in-window funding events;
7. hourly first-party context coverage, boundary contexts, Hyperliquid funding completeness/oracle matching and remaining fail-closed gates.

`OFFICIAL_RECOVERY` is specified in `TRIAL7_DATA_RECOVERY.md` but remains unable to score the candidate until an exact source-specific first-party raw semantic adapter is implemented and tested. Published paper/Zenodo data, aggregators, reconstructed third-party feeds and interpolation are prohibited from filling scientific observations.

A failed provenance/data gate produces **no strategy economics**.

## Frozen risk/reporting definitions

- max drawdown begins from pre-entry starting equity;
- daily risk returns use fixed 24-hour boundary-to-boundary observations with final exit in the last return;
- Sortino uses zero-target downside deviation;
- the 180-day final uses three consecutive 60-day contribution windows;
- entry friction is charged once in window 1 and exit friction once in window 3;
- the three windows must telescope to full final P&L;
- break-even all-in friction is analytical under the frozen four-fill model;
- report output separates funding, raw basis and friction and exposes Binance schedule plus late-settlement provenance.

## Validation state

The last completed repository-wide Vercel validation of the pre-settlement-discovery scientific implementation is commit `84e5343fbdea3c12d52e3d68dbfa0bbf0abd8ce3`:

- **170 tests / 170 passing / 0 failing**;
- successful Next.js production build;
- asymmetric start/end funding semantics, raw provenance, schedule/timestamp checks, basis/cost/margin failures, 60-day telescope, drawdown, Sortino and analytical break-even all passed.

After that checkpoint, the pre-start audit found and corrected additional **provenance/operational** issues before the scientific start: exact manifest-byte locking, critical-boundary startup catch-up, delayed-settlement isolation, report-state hardening, and systemd runtime identity hardening. Vercel is currently refusing new preview builds because the account hit its build-rate limit, so **do not claim the current head has a full repository-wide green CI run**.

Targeted executable validation performed on the final new logic in this session:

- settlement-discovery isolation + report-state guard: **9/9 passing** in an isolated Node test harness;
- systemd installer: `bash -n` **PASS**;
- the installer now preserves the resolved Node directory in systemd `PATH` and creates a root-owned SHA-256 snapshot of every acquisition-runtime file, verified by `ExecStartPre` on each service start.

These targeted checks do not replace a future full-suite build; they narrow the unvalidated surface while the Vercel quota is blocking CI.

## Operations / remaining blocker

**No persistent primary-live collector is confirmed running from this session.** Vercel has no durable evidence storage configured for this project, GitHub Actions remains account-blocked, and this session has no SSH/host connector.

The branch includes the hardened external-host installer:

```bash
bash research/crypto/ops/install-trial7-recorder-systemd.sh
```

It refuses the wrong branch or a dirty worktree, uses the lockfile through `npm ci`, runs the full tests + machine freeze audit + sealed connectivity check, snapshots the exact acquisition runtime into `/etc/theoldtrader-trial7-recorder.sha256`, then starts only `npm run research:cv:record`. The service uses public market-data endpoints only and has no order path or exchange credentials.

Do not claim primary-live acquisition is running until the host service/health check confirms it.

## Other research tracks

- **Trial 2 `funding-carry-v1`:** historical single-venue-family BTC spot/perpetual carry; primary result still unobserved; exact-family REST 2R remains non-promotion evidence.
- **Trial 1 `crypto-oos-v1`:** BTCUSDT robustness replication failed with zero ridge holdout trades and negative forecast/realized-return relationship.
- **Trials 3/4:** frozen and unobserved behind existing provenance/data blockers.
- **Trial 5 `tsmom-v1`:** **FAILED development** on first frozen evaluation; no rescue.
- **Trial 6 `lowvol-v1`:** **FAILED development** on first frozen evaluation; no rescue.
- **E1 `coinbase-maker-execution-v1`:** frozen execution protocol, scientific acquisition pending; cannot rewrite strategy costs retrospectively.

## Required execution order

1. Preserve the exact frozen Trial 7 manifest and economic/provenance rules after the scientific start.
2. Deploy/confirm the external `research:cv:record` service and use only sealed `research:cv:health` monitoring; do not inspect market values or estimated strategy P&L.
3. If acquisition gaps occur, restore primary capture. Do not enable recovered observations for scoring until the source-specific independent adapter is implemented/tested under the already-frozen recovery rules.
4. Do not evaluate Trial 7 before **2026-11-18T01:10:00Z**. The 90-day screen cannot promote or retune the candidate.
5. Do not evaluate the final before **2027-02-16T01:10:00Z**. A full pass can only produce `PROMOTION_ELIGIBLE_RESEARCH_ONLY`.
6. Complete primary Trial 2 and canonical 2R reproduction separately when provenance-preserving execution is available.
7. Continue E1 independently; do not use it to rewrite Trial 7's frozen 15/25-bps cost assumptions.
8. Keep Trials 3/4 frozen until their existing blockers are resolved.

Until qualifying evidence exists, frozen v2 remains the paper baseline and no research candidate is promoted.
