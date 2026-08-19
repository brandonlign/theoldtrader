# Trial 7 forward-acquisition operations

Experiment: `cross-venue-funding-v1`  
Scientific start: **2026-08-20T00:00:00Z**  
90-day screening boundary: **2026-11-18T00:00:00Z**  
180-day final boundary: **2027-02-16T00:00:00Z**  
Paper/research only: **yes**

This runbook is operational, not economic. It must not be used to inspect funding spreads, marks, returns, P&L, or choose a new parameter during the sealed window.

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
- the pre-start audit prints `status: PASS` and the frozen manifest SHA-256;
- connectivity mode validates both official venue response schemas;
- connectivity mode does **not** persist or print BTC marks, oracle values, funding rates, basis or strategy P&L.

Do not use `--once` before `2026-08-20T00:00:00Z`; the recorder deliberately refuses scientific collection before the frozen start.

## 2. Long-running primary collector

The collector is intentionally a normal Node process rather than a trading daemon. It uses only public market-data endpoints and has no venue credentials or order path.

Recommended command:

```bash
npm run research:cv:record
```

It waits for the frozen scientific start if launched early, then targets **00:00:05 after each UTC hour**. The five-second offset is regression-tested in `tests/trial7-collection-schedule.test.js` and is chosen to put Hyperliquid oracle/mark context close to the hourly funding boundary while avoiding a request exactly on the boundary.

The same poll also requests recent funding history. A just-settled funding event does **not** have to be visible in that exact poll: the next hourly request has a 130-minute lookback, so the event can be recovered from a later raw funding-history response while still being matched to the preserved near-boundary oracle context. The evaluator deduplicates identical event observations and rejects conflicting duplicates.

The default outputs are:

```text
research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson
research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz
```

Both are file-specifically gitignored. The compact file contains the validated scientific record contract; the gzip file contains the exact raw first-party responses with SHA-256 provenance. Do not manually edit either file.

## 3. systemd deployment example

`ops/theoldtrader-trial7-recorder.service.example` is a template. Copy it to `/etc/systemd/system/theoldtrader-trial7-recorder.service`, replace the repository/user paths, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable theoldtrader-trial7-recorder
sudo systemctl start theoldtrader-trial7-recorder
```

The service should restart after engineering/runtime failures. A restart does not fabricate missing observations; gaps remain visible to the frozen coverage gate and may only be repaired under `TRIAL7_DATA_RECOVERY.md`.

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

1. stop neither file for routine backup if the filesystem supports a consistent copy;
2. preserve the original file bytes rather than exporting parsed CSV;
3. calculate SHA-256 for copied snapshots;
4. record backup timestamp, source path, destination and hashes in an external operator log;
5. never replace the live file with a transformed/recompressed version.

The evaluator independently hashes the final compact file and concatenated gzip archive. Raw individual responses are also rehashed from their stored `rawText` before economics are calculated.

## 6. What to do after an outage

Do **not** change the strategy, start date, coverage threshold, or timestamp tolerance.

First:

```bash
npm run research:cv:health
```

Then restore primary live capture. Later, missing first-party contexts may be recovered only under `TRIAL7_DATA_RECOVERY.md`. Recovery is not allowed to choose values based on whether they improve the candidate result.

Important implementation state: the scientific evaluator currently supports `PRIMARY_LIVE` semantic auditing end-to-end. `OFFICIAL_RECOVERY` records are intentionally rejected until a source-specific raw semantic adapter is implemented and tested for the exact official source. Therefore an outage cannot silently be “fixed” with an unverified historical parser.

## 7. Screening boundary — do not evaluate early

Before **2026-11-18T00:00:00Z**, do not run a modified evaluator, spreadsheet, notebook, or one-off calculation to estimate Trial 7 return.

At/after the boundary, the sealed command is:

```bash
npm run research:cv:evaluate -- screening \
  research/crypto/data-cache/cross-venue-funding-v1-forward.ndjson \
  research/crypto/data-cache/cross-venue-funding-v1-forward.raw.ndjson.gz \
  > trial7-screening-evaluation.json
```

The evaluator itself refuses to run before the boundary. Before any economics it now performs **three independent provenance layers**:

1. compact/raw acquisition-type and SHA-256 consistency;
2. raw semantic reconstruction of every primary-live compact mark/oracle/funding value;
3. Binance funding-schedule reconstruction from first-party `premiumIndex.nextFundingTime`, requiring every announced in-window funding timestamp to appear in settled `fundingRate` history. This deliberately avoids assuming an immutable 8-hour Binance interval.

Only after those pass does the main data gate check hourly first-party context coverage, Hyperliquid hourly funding completeness/oracle matching, boundary contexts and the remaining strategy-independent integrity rules.

The 90-day classification cannot promote the strategy and cannot authorize retuning.

Generate the predeclared report only after the immutable evaluation exists:

```bash
npm run research:cv:report -- \
  trial7-screening-evaluation.json \
  trial7-screening-report
```

The reporter refuses to overwrite an existing report directory.

## 8. Final boundary

At/after **2027-02-16T00:00:00Z**:

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
- use the Lau paper/Zenodo cached data to fill a candidate observation;
- interpolate a missing oracle, mark or funding event;
- replace a failed data gate with a descriptive return calculation.

Any economically changed successor after the first Trial 7 result requires a new trial number.
