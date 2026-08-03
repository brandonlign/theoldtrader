# MoneyMog

MoneyMog is a **paper-first Polymarket structural-arbitrage dashboard**. It scans public order books for binary complete-set pricing errors without placing simulated or real trades.

## Dashboard

The web app uses a minimalist paper-ledger design and is ready to deploy on Vercel.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

The dashboard currently provides:

- manual read-only market scans
- paper-account status with simulation clearly paused
- fee-, depth-, and safety-adjusted opportunity ranking
- scan controls for market count, maximum size, minimum profit, ROI, and buffer
- an audit of why markets were filtered out
- responsive desktop and mobile layouts

No API key, wallet, or private key is required.

## Strategy

The first implemented strategy is binary complete-set arbitrage:

- **Buy and merge:** buy equal YES and NO shares when their executable cost is below the $1 complete-set value.
- **Split and sell:** create an equal YES/NO pair from $1 of collateral, then sell both when executable bids exceed $1.

The code evaluates full order-book depth, current per-market fee parameters, minimum order size, stale-book risk, a configurable safety buffer, and fixed execution costs.

## Safety boundary

- No wallet, private key, signing, or real-order code exists.
- Dashboard scans are read-only.
- Paper execution is disabled by default.
- Nothing runs on a timer or in the background.
- Multi-outcome negative-risk arbitrage is deliberately not enabled yet.

## Commands

```bash
npm test       # deterministic strategy and API-contract tests
npm run build  # production dashboard build
npm run scan   # read-only CLI scan
```

Paper execution remains locked unless explicitly enabled later:

```bash
MONEYMOG_PAPER_ENABLED=true npm run paper:once
```

That command performs one local accounting pass and still does not place real orders.

## Vercel

Import `brandonlign/moneymog` into Vercel and use the default Next.js settings. No environment variables are required for the initial read-only dashboard.

Optional environment variables are documented in `.env.example`. For faster Vercel scans, keep `MONEYMOG_MAX_MARKETS` reasonably small; the dashboard defaults to 120 and caps manual requests at 250.

## Modeling limits

Even a mathematically valid complete set is not automatically risk-free in live trading:

- the two order-book legs are not atomic
- a book can change between detection and submission
- merge/split operations introduce separate on-chain completion steps
- fees and protocol behavior can change
- displayed depth may disappear before execution

A later realistic simulator should model detection delay, partial fills, legging failures, and order-book movement before any results are treated as evidence of profitability.
