# Trial 8 operations — `bitnomial-carry-v1`

Scientific start: **2026-08-20T02:00:00Z / 10:00 PM ET Aug. 19**  
Screen: **2026-11-18T02:00:00Z**  
Final: **2027-02-16T02:00:00Z**

Trial 8 is public-data collection and paper evaluation only. It uses no exchange credentials and has no order path.

## Before start

On any machine with the branch checked out:

```bash
npm test
npm run research:t8:freeze-guard
npm run research:t8:connectivity
```

Connectivity mode fetches the official public Coinbase/Bitnomial interfaces and validates source/product schemas without persisting or printing candidate prices, funding rates or P&L.

## Persistent Linux collector

Recommended installation:

```bash
bash research/crypto/ops/install-trial8-recorder-systemd.sh
```

The installer refuses non-Linux hosts, the wrong branch, or a dirty worktree. It runs the full tests, exact manifest guard and live connectivity check before installing the service. It snapshots the acquisition runtime into a root-owned SHA-256 file and verifies that snapshot before every restart.

Default evidence files:

```text
research/crypto/data-cache/bitnomial-carry-v1-forward.ndjson
research/crypto/data-cache/bitnomial-carry-v1-forward.raw.ndjson.gz
```

Both are gitignored. Back them up byte-for-byte; do not edit or recompress them.

Service status/logs:

```bash
sudo systemctl status theoldtrader-trial8-recorder --no-pager
sudo journalctl -u theoldtrader-trial8-recorder -f
```

Sealed health check:

```bash
npm run research:t8:health
```

Health output exposes only timestamps/counts/coverage/provenance. It intentionally does not expose market values or P&L.

## Critical-boundary restart behavior

Normal sampling targets 15 seconds after each UTC hour. If the service first launches or restarts after that target but still within the frozen ten-minute context tolerance at start, screen or final, it takes one immediate catch-up observation and then resumes hourly sampling. It never extends the ten-minute boundary tolerance.

## Screening

Do not estimate Trial 8 P&L before the sealed screen.

At/after `2026-11-18T03:10:00Z`:

```bash
npm run research:t8:evaluate -- screening \
  research/crypto/data-cache/bitnomial-carry-v1-forward.ndjson \
  research/crypto/data-cache/bitnomial-carry-v1-forward.raw.ndjson.gz \
  > trial8-screening.json

npm run research:t8:report -- trial8-screening.json trial8-screening-report
```

The 70-minute delay allows the final in-window funding settlement to appear in the first-party history. The evaluation window itself does not move.

## Final

At/after `2027-02-16T03:10:00Z`:

```bash
npm run research:t8:evaluate -- final \
  research/crypto/data-cache/bitnomial-carry-v1-forward.ndjson \
  research/crypto/data-cache/bitnomial-carry-v1-forward.raw.ndjson.gz \
  > trial8-final.json

npm run research:t8:report -- trial8-final.json trial8-final-report
```

The report directory is overwrite-protected. The strongest final classification is research-only promotion eligibility.

## During the sealed window, do not

- calculate running strategy P&L;
- select a different Bitnomial product or asset;
- change long/short direction;
- change target notional or contract count based on observed funding;
- add a funding-rate entry threshold;
- alter fees/slippage after observing outcomes;
- substitute a stale Bitnomial trade with a third-party price;
- synthesize a missing funding interval;
- move the start after a bad period;
- use Trial 7 or published historical returns to retune Trial 8.

A changed economic candidate requires a new trial.
