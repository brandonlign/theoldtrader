# MoneyMog

MoneyMog is a **paper-first Polymarket structural-arbitrage engine**. The first implemented strategy is binary complete-set arbitrage:

- **Buy and merge:** buy equal YES and NO shares when their executable cost is below the $1 complete-set value.
- **Split and sell:** create an equal YES/NO pair from $1 of collateral, then sell both when executable bids exceed $1.

The code does not predict event outcomes. It evaluates full order-book depth, current per-market fee parameters, minimum order size, stale-book risk, a configurable safety buffer, and fixed execution costs.

## Safety boundary

- No wallet, private key, signing, or real-order code exists.
- `npm run scan` reads public market data and reports opportunities only.
- Paper execution is disabled by default.
- Nothing runs on a timer or in the background.
- Multi-outcome negative-risk arbitrage is deliberately not enabled yet; incorrectly identifying an exhaustive outcome set would create fake “guaranteed” opportunities.

## Setup

```bash
npm install
npm run check
```

Configuration is read from environment variables; `.env.example` lists the available settings.

## Scan without starting the simulation

```bash
npm run scan
```

This produces JSON containing discovered opportunities and skipped-market counts. It does **not** alter a portfolio.

## Start one paper pass later

Only when ready:

```bash
MONEYMOG_PAPER_ENABLED=true npm run paper:once
```

This performs one local accounting pass and exits. It does not place orders.

## Detection logic

For each active binary market:

1. Fetch YES and NO order books from the public CLOB API.
2. Check both top-of-book complete-set directions.
3. Fetch the authoritative CLOB market fee schedule only for gross candidates.
4. Walk both books to every meaningful depth breakpoint.
5. Calculate taker fees per fill level.
6. Subtract the safety buffer and configured fixed cost.
7. Keep only opportunities exceeding both net-profit and ROI thresholds.
8. Reject stale books and insufficient depth.

The current documented taker-fee curve is:

```text
fee = shares × feeRate × price × (1 - price)
```

MoneyMog obtains `feeRate` and the curve exponent from `/clob-markets/{condition_id}`. The fee model remains isolated in `src/fees.js` so it can be changed without touching strategy logic if Polymarket changes protocol behavior.

## Important modeling limits

Even a mathematically valid complete set is not automatically risk-free in live trading:

- The two order-book legs are not atomic.
- A book can change between detection and submission.
- Merge/split operations introduce separate on-chain completion steps.
- Fees and protocol behavior can change.
- Displayed depth may not equal executable depth by the time an order arrives.

The paper engine currently assumes both quoted legs complete at the observed levels. A proper replay simulator should later model detection delay, partial fills, legging failures, and book movement before results are treated as realistic.

## Structure

```text
src/clients/              Public Gamma and CLOB clients
src/strategy/             Complete-set detector
src/paper/                Disabled-by-default paper accounting
src/fees.js               Isolated fee-curve implementation
src/orderbook.js          Depth walking and fee-aware leg quotes
src/scanner.js            Market discovery and orchestration
tests/                    Deterministic strategy tests
```
