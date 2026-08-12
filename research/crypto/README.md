# MoneyMog Crypto Research

This directory is isolated from the live/paper crypto execution path. **Nothing here can submit an order, access exchange credentials, or change `cloudflare/crypto-engine.js` / `src/crypto/strategy.js`.** The frozen v2 strategy is imported read-only only so historical evaluation can call the exact live signal function.

## Scientific rules

- Every serious candidate gets a new immutable manifest before its final holdout is read.
- The first final evaluation writes to a unique result directory and is never overwritten.
- Failures remain in git.
- The final chronological holdout is not used to alter a frozen candidate. A changed candidate needs a new experiment ID and increments the trial ledger.
- All reported returns are net of modeled fees, slippage and spread.
- Historical candle data is cached and hashed so the exact evaluation sample is recoverable.
- This project is paper/research only. There is no real-money path.

## v1

`manifests/crypto-oos-v1.json` freezes the first candidate: pooled ridge regression of 24-hour forward log returns using low-dimensional price/volume/volatility/cross-asset features. It makes one decision per UTC day and can hold long only when the predicted gross return exceeds the modeled round-trip cost.

Comparators are cash, BTC buy-and-hold, equal-weight BTC/ETH/SOL buy-and-hold, a sign-only 30-day time-series trend baseline, and frozen MoneyMog v2.

The GitHub research workflow downloads/caches Coinbase 15-minute candles, runs development walk-forward folds and the untouched final holdout, performs the predeclared spread stress, writes JSON/CSV/Markdown plus SVG plots, commits the exact data cache and result bundle back to this research branch, and refuses to overwrite an existing final result.
