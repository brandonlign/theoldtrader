# Trial 7 forward-acquisition operations

Experiment: `cross-venue-funding-v1`  
Scientific start: **2026-08-20T00:00:00Z**  
90-day screening boundary: **2026-11-18T00:00:00Z**  
180-day final boundary: **2027-02-16T00:00:00Z**  
Earliest supported evaluation: **70 minutes after the applicable boundary**  
Paper/research only: **yes**

This runbook is operational, not economic. The authoritative scientific specification is `research/crypto/manifests/cross-venue-funding-v1.json`, whose exact final pre-start bytes are pinned by `research/crypto/lib/trial7-freeze-identity.js`. This runbook must not be used to inspect funding spreads, marks, returns, P&L, or choose a new parameter during the sealed window.

## 1. Before the window opens

From the exact `research/cross-venue-funding-v1-current` checkout:

```bash
npm ci
npm test
npm run research:cv:prestart
npm run research:cv:connectivity
```

Expected properties:

- the full deterministic test suite passes;
- the pre-start audit prints `status: PASS`, the final implementation freeze timestamp, and the canonical manifest SHA-256;
- connectivity mode validates both official venue response schemas;
- connectivity mode does **not** persist or print BTC marks, oracle values, funding rates, basis or strategy P&L;
- every supported `research:cv:*` command first verifies the exact frozen canonical-manifest bytes.

Do not invoke the raw recorder with `--once` before `2026-08-20T00:00:00Z`; scientific collection deliberately refuses pre-start persistence.

## 2. Long-running primary collector

The collector is intentionally a normal Node process rather than a trading daemon. It uses only public market-data endpoints and has no venue credentials or order path.

Recommended command:

```bash
npm run research:cv:record
```

The supported command runs through `trial7-recorder-start.mjs`. Normal collection targets **five seconds after each UTC hour (`HH:00:05Z`)**. The five-second offset is regression-tested and puts Hyperliquid oracle/mark context immediately after the hourly funding boundary without creating a later choice of sampling time.

### Critical-boundary catch-up

The ordinary schedule is not widened. A narrow fail-safe exists only for the scientific start, 90-day boundary, and 180-day boundary: if the service first launches or restarts **after `:00:05` but still before `:10:00`**, the supervisor takes one immediate primary snapshot, then hands off to the unchanged hourly recorder. This prevents a late-but-still-valid service start from skipping the entire frozen entry/exit context window. It never admits a context after the existing 10-minute tolerance.

The same poll requests recent funding history. A just-settled event does not have to be visible in that exact response. The recorder uses a 130-minute history lookback, so a later first-party history response may expose a settlement that had already occurred.

### Frozen boundary cashflow timing

Entry and exit use the first valid official context **at or after** their declared UTC boundary within 10 minutes. Consequently:

- funding exactly at the **start** boundary occurs before the post-boundary entry and is **excluded**;
- funding exactly at the **end** boundary occurs before the post-boundary exit and is **included**;
- the funding inclusion rule is `startBoundary < eventTime <= endBoundary`.

### Settlement-publication delay versus market context

The final freeze distinguishes two cutoffs:

1. **Market/context cutoff: boundary +10 minutes.** Only records through this cutoff may supply entry/exit marks, funding-oracle matches, hourly context coverage, margin paths, basis P&L, comparator values, or return statistics.
2. **Settlement-discovery cutoff: boundary +70 minutes.** A first-party funding-history response after the +10-minute context cutoff but no later than +70 minutes may only prove a settlement whose own event timestamp already satisfies `startBoundary < eventTime <= endBoundary`.

Late discovery rows are independently raw-semantic-audited. Their mark, oracle, index price, current funding, and future schedule fields are prohibited from economics. The evaluator projects only qualifying historical settlement-event fields into the in-memory context view and records source timestamps/hashes plus `postWindowMarketFieldsUsed=false`.

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

Optional first argument: the service user name. The installer refuses to proceed unless the checkout is on the exact research branch and the worktree is clean. It requires `package-lock.json`, runs `npm ci`, the full test suite, the machine freeze audit, and sealed connectivity, then installs a hardened systemd service whose `ExecStart` is the supported `npm run research:cv:record` path. It does not add exchange credentials or any order path.

A lower-level template remains at `research/crypto/ops/theoldtrader-trial7-recorder.service.example` for manual review. The service should restart after engineering/runtime failures. A restart does not fabricate missing observations; gaps remain visible to the frozen coverage gate and may only be repaired under `TRIAL7_DATA_RECOVERY.md`.

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

The evaluator independently hashes the compact file and concatenated gzip archive. Raw individual responses are also rehashed from their stored `rawText` before economics are calculated.

## 6. What to do after an outage

Do **not** change the strategy, start date, coverage threshold, timestamp tolerance, boundary rules, context cutoff, or settlement-discovery cutoff.

First:

```bash
npm run research:cv:health
```

Then restore primary live capture. Later, missing first-party contexts may be recovered only under `TRIAL7_DATA_RECOVERY.md`. Recovery is not allowed to choose values based on whether they improve the candidate result.

Important implementation state: the scientific evaluator supports `PRIMARY_LIVE` semantic auditing end-to-end. `OFFICIAL_RECOVERY` records remain intentionally unable to score until a source-specific independent raw semantic adapter is implemented and tested for the exact official source. Therefore an outage cannot silently be “fixed” with an unverified historical parser.

## 7. Screening boundary — do not evaluate early

Do not run a modified evaluator, spreadsheet, notebook, or one-off calculation to estimate Trial 7 return before the sealed screen. The supported screening command may be run **no earlier than 2026-11-18T01:10:00Z**:

```bash
npm run research:cv:evaluate -- screening \
  research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson \
  research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz \
  > trial7-screening-evaluation.json
```

The evaluator itself refuses earlier execution. Before any economics it performs independent integrity layers:

1. exact frozen canonical-manifest identity plus compact/raw acquisition/hash/timestamp binding;
2. raw semantic reconstruction of every relevant PRIMARY_LIVE compact source;
3. Hyperliquid settled-funding timestamp normalization to the nearest UTC hour only under the frozen ±60-second rule, with raw skew preserved and collisions/conflicts rejected;
4. Binance funding-schedule reconstruction from first-party `premiumIndex.nextFundingTime` announcements to settled `fundingRate.fundingTime` events;
5. settlement-discovery isolation: late rows may contribute only already-in-window funding events, never post-window market context;
6. hourly first-party context coverage, Hyperliquid funding completeness/oracle matching, boundary contexts, and the remaining strategy-independent data gates.

Only after those pass can the evaluator calculate funding, raw basis, execution friction, per-venue margin, cost stress, drawdown or return statistics.

The 90-day classification cannot promote the strategy and cannot authorize retuning.

Generate the predeclared report only after the immutable evaluation exists:

```bash
npm run research:cv:report -- \
  trial7-screening-evaluation.json \
  trial7-screening-report
```

The reporter re-verifies the exact frozen manifest bytes, re-binds the artifact to the manifest SHA-256, refuses forbidden live/promotion states, and emits both the Binance schedule audit and the event-level settlement-discovery provenance. It refuses to overwrite an existing report directory.

## 8. Final boundary

The supported final command may be run **no earlier than 2027-02-16T01:10:00Z**:

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
- change the +10-minute market-context cutoff or +70-minute settlement-discovery cutoff;
- use a late discovery row's mark/oracle/index/current-funding fields in economics;
- use the Lau paper/Zenodo cached data to fill a candidate observation;
- interpolate a missing oracle, mark or funding event;
- replace a failed data gate with a descriptive return calculation.

Any economically changed successor after the scientific start requires a new trial number.
