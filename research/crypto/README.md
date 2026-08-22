# TheOldTrader Crypto Research

> **Current priority (2026-08-19):** Trial 2 `funding-carry-v1` is the flagship **strategy research candidate**; E1 `coinbase-maker-execution-v1` remains the parallel flagship **execution experiment**. This is research prioritization only, not promotion evidence. See `FLAGSHIP_CARRY.md` and `STATUS.md`.

This directory is isolated from the live/paper crypto execution path. **Nothing here can submit an order, access exchange credentials, or change `cloudflare/crypto-engine.js` / `src/crypto/strategy.js`.** The frozen v2 strategy is imported read-only only so historical evaluation can call the exact live signal function.

## Scientific rules

- Every serious candidate gets a new immutable manifest before its final holdout is read.
- The first final evaluation writes to a unique result directory and is never overwritten.
- Failures remain in git.
- The final chronological holdout is not used to alter a frozen candidate. A changed candidate needs a new experiment ID and increments the trial ledger.
- Alpha/portfolio trials and execution-policy experiments are counted separately in `TRIAL_LEDGER.md`.
- All reported returns are net of modeled fees, slippage and spread.
- Historical data is cached/hashed when possible so the exact evaluation sample is recoverable.
- This project is paper/research only. There is no real-money path.

## Trial 1 — directional expected-return forecasting

`manifests/crypto-oos-v1.json` freezes the first candidate: pooled ridge regression of 24-hour forward log returns using low-dimensional price/volume/volatility/cross-asset features. It makes one decision per UTC day and can hold long only when the predicted gross return exceeds the modeled round-trip cost.

Comparators are cash, BTC buy-and-hold, equal-weight BTC/ETH/SOL buy-and-hold, a sign-only 30-day time-series trend baseline, and frozen TheOldTrader v2.

Ordinary branch pushes run validation only. The untouched Coinbase final holdout can be opened only by a deliberate manual dispatch of `crypto-research.yml`, after validation succeeds, and the job refuses to overwrite a prior final result. The primary holdout is currently sealed because GitHub Actions is blocked before checkout by the account's Actions billing/spending-limit state. A separate frozen BTC/Binance robustness replication is preserved under `results/binance-btc-replication-v1/` and does not substitute for the primary holdout.

## Trial 2 — funding/basis carry

`manifests/funding-carry-v1.json` freezes a separate market-neutral BTC spot / BTCUSDT perpetual carry experiment. **No Trial 2 carry P&L has been observed.**

The frozen hedge is unambiguous: spend 15% of starting equity on BTC spot, then short exactly those BTC units in the USD-M BTCUSDT perpetual. The perpetual dollar notional is determined by the contemporaneous contract price rather than independently forced to 15%. Twenty percent of starting equity is reserved as futures collateral. There is no rebalancing, leverage optimization, funding threshold, sign filter, entry-date selection, or regime timing.

`prepare-carry-data.py` builds a checksum-verified exact 8-hour grid from four official Binance Vision series:

- **spot:** daily BTCUSDT 8h kline open;
- **perpetual execution reference:** monthly USD-M BTCUSDT standard contract 8h kline open;
- **perpetual valuation reference:** monthly USD-M BTCUSDT markPrice 8h kline open;
- **funding:** monthly USD-M BTCUSDT fundingRate archive.

The standard contract and mark price have deliberately different roles. Entry/exit execution friction is applied around the standard contract open. Mark price is used for unrealized short P&L, funding notional, maintenance margin and stress. Treating mark price as if it were the historical executable contract price is prohibited.

Funding archives use raw `calc_time`, which may differ by milliseconds from the scheduled kline boundary. The raw funding timestamp and skew are preserved and mapped to the nearest 00:00/08:00/16:00 UTC boundary only if absolute skew is <=60 seconds. Any larger skew, collision, failed official `.CHECKSUM`, missing scheduled funding payment, or missing exact spot/contract/mark open aborts data preparation. No interpolation or forward-fill is permitted.

The frozen 2021-05-01 through 2026-03-01 window contains exactly **5,295** scheduled observations. Both preprocessing and `carry-evaluate.js` independently require the complete 5,295-row grid. The synchronized CSV contains:

```text
timestamp,raw_funding_timestamp,funding_timestamp_skew_ms,spot_price,perp_exec_price,perp_mark_price,funding_rate
```

The evaluator skips funding at the entry boundary, accrues later funding on contemporaneous mark notional, marks margin on mark price, opens/closes the perpetual against the standard contract execution reference with frozen costs, checks the historical maintenance-margin rule and +25%/+50%/+100% mark-gap stresses, and compares against cash plus an identical 15%-spot buy-and-hold leg.

It also emits a daily audit path. `carry-report.js` converts the frozen result into:

- `REPORT.md`
- `comparison-metrics.csv`
- `daily-diagnostics.csv`
- `equity-curve.svg`
- `drawdown.svg`
- `cumulative-funding.svg`
- `basis.svg`
- `margin-excess.svg`

The one-time manual carry workflow runs deterministic Python and Node tests first, downloads/checksums the official archives, evaluates the frozen candidate once, generates the full evidence bundle, and commits the synchronized data/source provenance plus all result files atomically. It refuses to overwrite an observed Trial 2 result.

When compute with outbound internet is available, the equivalent manual commands are:

```bash
python3 research/crypto/prepare-carry-data.py \
  research/crypto/manifests/funding-carry-v1.json \
  research/crypto/data-cache/funding-carry-v1-synchronized.csv \
  research/crypto/data-cache/funding-carry-v1-sources.json

node research/crypto/carry-evaluate.js \
  research/crypto/manifests/funding-carry-v1.json \
  research/crypto/data-cache/funding-carry-v1-synchronized.csv \
  > research/crypto/results/funding-carry-v1/summary.json

node research/crypto/carry-report.js \
  research/crypto/results/funding-carry-v1/summary.json \
  research/crypto/results/funding-carry-v1

npm run research:carry:flagship -- \
  research/crypto/results/funding-carry-v1/summary.json
```

`CARRY_DATA_AUDIT.md` records why a secondary premium/basis dataset cannot be forward-filled into this experiment. `CARRY_PRECHECK.md` is only an order-of-magnitude funding-scale sanity check and must never be presented as Trial 2 performance. `FLAGSHIP_CARRY.md` defines the result-agnostic evidence ladder: even a passing historical audit can only be labeled `PROMISING_HISTORICAL_ONLY` and still requires untouched validation.

Do not introduce a funding threshold, sign filter, leverage/allocation change, entry-date selection or rebalancing rule under Trial 2 after seeing its result. Any such change is a new numbered trial.

## Execution E1 — forward Coinbase maker-fill research

`manifests/coinbase-maker-execution-v1.json` freezes a **non-alpha** forward-data experiment for measuring post-only maker execution economics. It uses only public Coinbase market data; it neither authenticates to an account nor submits orders.

The recorder requires a Node runtime with the standards-based `WebSocket` global (Node 22+ recommended). Coinbase recommends distributing high-volume subscriptions across connections, so E1 records BTC, ETH and SOL on three independent public WebSockets/files. Launch all three together with:

```bash
node research/crypto/record-coinbase-microstructure-all.mjs --duration-minutes=60
```

A one-hour run is only an engineering pilot. The eventual scientific run uses `--duration-minutes=10080` (seven days) and all three product files must independently pass the frozen coverage checks.

For each completed product recording, first run the conservative maker simulator:

```bash
node research/crypto/analyze-coinbase-maker-execution.mjs \
  research/crypto/data-cache/coinbase-microstructure-BTC-USD-<timestamp>.ndjson.gz
```

Then run the **independent raw-feed integrity/full-book audit** against that recording and the generated maker-order CSV:

```bash
node research/crypto/audit-coinbase-execution-integrity.mjs \
  research/crypto/data-cache/coinbase-microstructure-BTC-USD-<timestamp>.ndjson.gz \
  research/crypto/data-cache/coinbase-microstructure-BTC-USD-<timestamp>-maker-orders.csv
```

The maker simulator reconstructs the level-2 book, places frozen hypothetical orders at the best bid/ask every 15 minutes, assumes each joins the back of displayed queue, credits **no queue-ahead cancellations**, requires observed maker-side trade volume to consume queue ahead plus order size (or a trade-through), and measures 1m/5m/15m/60m signed midpoint markouts.

The independent audit re-reads the immutable raw gzip rather than trusting the maker output. It independently verifies the companion SHA-256, connection coverage, product identity, `level2` and `market_trades` sequence continuity, and every eligible placement timestamp. It also executes the **same base quantity** against the full opposite-side recorded book at placement to create the immediate-taker VWAP comparator. Insufficient recorded taker depth is marked unavailable rather than imputed.

A product is eligible for the final scientific E1 report only if it has at least 168 hours, >=98% connected time, no disconnect over five minutes, zero parse errors, zero forward `level2` sequence gaps, zero forward `market_trades` sequence gaps, a verified raw hash, and no unmatched eligible placements. Initial connection delay counts against coverage. Reconnect-spanning maker orders are discarded; no new maker order is placed until a fresh level2 snapshot rebuilds the book.

After all three products independently pass, the final validator takes **summary/audit pairs** and refuses to write the combined result unless the products and raw hashes match:

```bash
node research/crypto/validate-coinbase-maker-window.mjs \
  BTC-maker-summary.json BTC-execution-integrity.json \
  ETH-maker-summary.json ETH-execution-integrity.json \
  SOL-maker-summary.json SOL-execution-integrity.json
```

The combined maker-versus-taker savings metric is explicitly conditional on a maker fill and therefore is **not** strategy P&L and does not assign a fictitious value to non-fills. Product/side/notional/time subsets cannot be cherry-picked afterward as a deployment policy.

A future change to placement price, TTL, queue model, cancellation treatment, order sizes or maker/taker switching rule requires a new execution experiment number.
