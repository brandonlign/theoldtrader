# Trial 7 forward-acquisition operations

Experiment: `cross-venue-funding-v1`  
Scientific start: **2026-08-20T00:00:00Z**  
90-day screening boundary: **2026-11-18T00:00:00Z**  
180-day final boundary: **2027-02-16T00:00:00Z**  
Earliest supported evaluation: **10 minutes after the applicable boundary**  
Paper/research only: **yes**

This runbook is operational, not economic. The authoritative scientific specification is `research/crypto/manifests/cross-venue-funding-v1.json`. It must not be used to inspect funding spreads, marks, returns, P&L, or choose a new parameter during the sealed window.

## 1. Before the window opens

From the exact `research/cross-venue-funding-v1-current` checkout:

```bash
npm install
npm test
npm run research:cv:prestart
npm run research:cv:connectivity
```

Expected properties:

- the full deterministic test suite passes;
- the pre-start audit prints `status: PASS`, the final implementation freeze timestamp, and the canonical manifest SHA-256;
- connectivity mode validates both official venue response schemas;
- connectivity mode does **not** persist or print BTC marks, oracle values, funding rates, basis or strategy P&L.

Do not use `--once` before `2026-08-20T00:00:00Z`; the recorder deliberately refuses scientific collection before the frozen start.

## 2. Long-running primary collector

The collector is intentionally a normal Node process rather than a trading daemon. It uses only public market-data endpoints and has no venue credentials or order path.

Recommended command:

```bash
npm run research:cv:record
```

It waits for the frozen scientific start if launched early, then targets **five seconds after each UTC hour (`HH:00:05Z`)**. The five-second offset is regression-tested in `tests/trial7-collection-schedule.test.js` and puts Hyperliquid oracle/mark context immediately after the hourly funding boundary without creating a later choice of sampling time.

The same poll also requests recent funding history. A just-settled funding event does **not** have to be visible in that exact poll: the next hourly request has a 130-minute lookback, so the event can appear in a later raw funding-history response while still being matched to the preserved first valid post-event oracle context. The evaluator deduplicates identical event observations and rejects conflicting duplicates.

### Frozen boundary cashflow timing

Entry and exit both use the first valid official context **at or after** their declared UTC boundary within 10 minutes. Consequently:

- funding exactly at the **start** boundary occurs before the post-boundary entry and is **excluded**;
- funding exactly at the **end** boundary occurs before the post-boundary exit and is **included**;
- the supported evaluator will not run until the full 10-minute exit-context tolerance has elapsed.

The default outputs are:

```text
research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson
research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz
```

Both are file-specifically gitignored. The compact file contains the validated scientific record contract; the gzip file contains the exact raw first-party responses with SHA-256 provenance. Do not manually edit either file.

## 3. Preferred systemd deployment

A fail-closed installer is included:

```bash
bash research/crypto/ops/install-trial7-recorder-systemd.sh
```

Optional first argument: the service user name. The installer refuses to proceed unless the checkout is on the exact research branch and the worktree is clean. It uses `npm ci`, runs the full tests, the pre-start audit and connectivity check, then installs a hardened systemd service that can write only the Trial 7 data directory. It does not add credentials or any order path.

A lower-level template remains at `research/crypto/ops/theoldtrader-trial7-recorder.service.example` for manual review. The installed service should restart after engineering/runtime failures. A restart does not fabricate missing observations; gaps remain visible to the frozen coverage gate and may only be repaired under `TRIAL7_DATA_RECOVERY.md`.

## 4. Sealed health monitoring

Use:

```bash
npm run research:cv:health
```

This health command intentionally exposes only:

- manifest/provenance status;
- row counts;
- latest primary-live timestamp/age;
- recent hourly primary-live coverage;
- maximum recent primary-live gap;
- primary-live vs official-recovery counts.

It does **not** expose price, oracle, funding-rate, basis or candidate P&L values. `OFFICIAL_RECOVERY` rows cannot make a stale primary-live collector appear healthy.

Operational status meanings:

- `HEALTHY` — recent primary-live capture is within the frozen maximum age;
- `NO_PRIMARY_LIVE_DATA` — acceptable before the scientific window has produced data; investigate after the start;
- `STALE_PRIMARY_LIVE_DATA` — collector needs engineering attention, but do not alter the strategy;
- `INVALID_PROVENANCE` — stop scientific use and investigate manifest/acquisition identity.

## 5. Storage and backup rules

The two forward files are scientific evidence and should be backed up outside the Git working tree. A backup is valid only when byte-for-byte preservation is possible.

Recommended operational practice:

1. preserve the original file bytes rather than exporting parsed CSV;
2. calculate SHA-256 for copied snapshots;
3. record backup timestamp, source path, destination and hashes in an external operator log;
4. never replace the live file with a transformed/recompressed version;
5. keep the primary recorder files out of Git—the repository intentionally ignores the exact Trial 7 forward filenames.

The evaluator independently hashes the final compact file and concatenated gzip archive. Raw individual responses are also rehashed from their stored `rawText` before economics are calculated.

## 6. What to do after an outage

Do **not** change the strategy, start date, coverage threshold, timestamp tolerance or boundary rules.

First:

```bash
npm run research:cv:health
```

Then restore primary live capture. Later, missing first-party contexts may be recovered only under `TRIAL7_DATA_RECOVERY.md`. Recovery is not allowed to choose values based on whether they improve the candidate result.

Important implementation state: the scientific evaluator currently supports `PRIMARY_LIVE` semantic auditing end-to-end. `OFFICIAL_RECOVERY` records are intentionally rejected until a source-specific independent raw semantic adapter is implemented and tested for the exact official source. Therefore an outage cannot silently be “fixed” with an unverified historical parser.

## 7. Screening boundary — do not evaluate early

Do not run a modified evaluator, spreadsheet, notebook, or one-off calculation to estimate Trial 7 return before the sealed screen. The supported screening command may be run **no earlier than 2026-11-18T00:10:00Z**:

```bash
npm run research:cv:evaluate -- screening \
  research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson \
  research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz \
  > trial7-screening-evaluation.json
```

The evaluator itself refuses earlier execution. Before any economics it performs independent integrity layers:

1. canonical-manifest identity and compact/raw acquisition/hash/timestamp binding;
2. raw semantic reconstruction of every PRIMARY_LIVE compact mark/oracle/funding field used by the frozen evidence window;
3. Hyperliquid settled-funding timestamp normalization to the nearest UTC hour only under the frozen ±60-second rule, with raw skew preserved and collisions/conflicts rejected;
4. Binance funding-schedule reconstruction from first-party `premiumIndex.nextFundingTime`, requiring every announced funding timestamp through the exit boundary to appear in settled `fundingRate` history;
5. hourly first-party context coverage, Hyperliquid funding completeness/oracle matching, boundary contexts, and the remaining strategy-independent data gates.

Only after those pass can the evaluator calculate funding, raw basis, execution friction, per-venue margin, cost stress, drawdown or return statistics.

The 90-day classification cannot promote the strategy and cannot authorize retuning.

Generate the predeclared report only after the immutable evaluation exists:

```bash
npm run research:cv:report -- \
  trial7-screening-evaluation.json \
  trial7-screening-report
```

The reporter re-binds the artifact to the current canonical manifest hash and refuses to overwrite an existing report directory.

## 8. Final boundary

The supported final command may be run **no earlier than 2027-02-16T00:10:00Z**:

```bash
npm run research:cv:evaluate -- final \
  research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson \
  research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz \
  > trial7-final-evaluation.json

npm run research:cv:report -- \
  trial7-final-evaluation.json \
  trial7-final-report
```

The strongest possible classification is `PROMOTION_ELIGIBLE_RESEARCH_ONLY`. Even that result authorizes only a separate proposal about the **paper baseline**. It does not authorize real-money trading.

## 9. Prohibited operator actions during the sealed window

Do not:

- inspect a running estimate of Trial 7 P&L;
- change Binance/Hyperliquid direction;
- add ETH/SOL or select a favorable asset;
- filter on current funding spread;
- change the 15 bps/order primary or 25 bps/order stress costs;
- change collateral/notional based on observed funding or basis;
- reset the start date after a bad period;
- change whether start/end boundary funding is earned;
- use the Lau paper/Zenodo cached data to fill a candidate observation;
- interpolate a missing oracle, mark or funding event;
- replace a failed data gate with a descriptive return calculation.

Any economically changed successor after the first Trial 7 candidate result requires a new trial number.
