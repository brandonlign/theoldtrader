# MoneyMog Crypto Research

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

Comparators are cash, BTC buy-and-hold, equal-weight BTC/ETH/SOL buy-and-hold, a sign-only 30-day time-series trend baseline, and frozen MoneyMog v2.

The GitHub research workflow downloads/caches Coinbase 15-minute candles, runs development walk-forward folds and the untouched final holdout, performs the predeclared spread stress, writes JSON/CSV/Markdown plus SVG plots, commits the exact data cache and result bundle back to this research branch, and refuses to overwrite an existing final result.

The primary Coinbase holdout is currently sealed because GitHub Actions is blocked before checkout by the account's Actions billing/spending-limit state. A separate frozen BTC/Binance robustness replication is preserved under `results/binance-btc-replication-v1/` and does not substitute for the primary holdout.

## Trial 2 — funding/basis carry

`manifests/funding-carry-v1.json` freezes a separate market-neutral BTC spot / BTCUSDT perpetual carry experiment. `prepare-carry-data.py` builds checksum-verified synchronized Binance inputs with no forward-looking interpolation; `carry-evaluate.js` independently marks spot/perpetual legs, funding, fees, margin and gap stress.

When compute with outbound internet is available:

```bash
python3 research/crypto/prepare-carry-data.py
node research/crypto/carry-evaluate.js \
  research/crypto/manifests/funding-carry-v1.json \
  research/crypto/data-cache/funding-carry-v1-synchronized.csv
```

Do not introduce a funding threshold, sign filter, leverage change, entry-date selection or rebalancing rule under trial 2 after seeing its result.

## Execution E1 — forward Coinbase maker-fill research

`manifests/coinbase-maker-execution-v1.json` freezes a **non-alpha** forward-data experiment for measuring post-only maker execution economics. It uses only public Coinbase market data; it neither authenticates to an account nor submits orders.

The recorder requires a Node runtime with the standards-based `WebSocket` global (Node 22+ recommended). A one-hour run is only an engineering pilot:

```bash
node research/crypto/record-coinbase-microstructure.mjs --duration-minutes=60
```

Analyze a completed recording with:

```bash
node research/crypto/analyze-coinbase-maker-execution.mjs \
  research/crypto/data-cache/coinbase-microstructure-<timestamp>.ndjson.gz
```

The analyzer reconstructs the level-2 book, places frozen hypothetical orders at the best bid/ask every 15 minutes, assumes the order joins the back of displayed queue, credits **no queue-ahead cancellations**, requires observed maker-side trade volume to consume queue ahead plus order size (or a trade-through), and measures 1m/5m/15m/60m signed midpoint markouts.

A scientific E1 report requires at least 168 hours plus the frozen data-quality coverage rules. Reconnect-spanning orders are discarded and the book must be rebuilt from a fresh snapshot before new hypothetical orders are allowed. A future change to placement price, TTL, queue model, cancellation treatment, order sizes or maker/taker switching rule requires a new execution experiment number.
