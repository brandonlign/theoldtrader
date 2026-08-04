# MoneyMog

MoneyMog is a **paper-first Polymarket research dashboard** with two independent engines:

- **Structural arbitrage:** finds executable binary complete sets priced below or above their $1 collateral value after depth, fees, and safety buffers.
- **Whale watch:** ranks public wallets for repeatable forecasting skill and evaluates new public trades against delay, liquidity, slippage, position state, and churn.

No simulated or real trades start automatically.

## Dashboard

The Next.js dashboard uses a minimalist paper-ledger design and is ready for Vercel.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

It provides:

- manual read-only structural-arbitrage scans
- public-wallet ranking with one-hit-wonder filters
- fee-, depth-, and safety-adjusted opportunity tables
- optional status and signal views for the hosted whale monitor
- clear paused states for paper and real execution
- responsive desktop and mobile layouts

No API key, wallet, or private key is required for the read-only features.

## Commands

```bash
npm test              # deterministic strategy and whale-monitor tests
npm run build         # production dashboard build
npm run scan          # read-only structural-arbitrage scan
npm run whales:rank   # read-only public-wallet ranking
```

Local whale observation is deliberately locked:

```bash
MONEYMOG_WHALE_MONITOR_ENABLED=true npm run whales:observe
```

The first observation pass only establishes a baseline, preventing old trades from being mistaken for new signals. Later passes record `COPY_CANDIDATE` or `REJECTED` decisions without changing a portfolio.

The existing one-pass structural paper accountant is also locked:

```bash
MONEYMOG_PAPER_ENABLED=true npm run paper:once
```

Neither command submits real orders.

## Whale selection and monitoring

Wallets are not selected by leaderboard profit alone. MoneyMog checks:

- resolved-market sample size
- approximate return on deployed capital
- win rate and profit factor
- maximum drawdown
- category-specific leaderboard strength
- concentration in the largest win
- profitability after removing the largest win

For each newly observed public BUY, the monitor checks:

- whether the wallet still holds a directional position
- trade size relative to that wallet's normal activity
- two-sided churn suggesting market-making or hedging
- detection delay
- current executable ask and order-book depth
- fee schedule and expected copy cost
- price deterioration from the whale's fill
- optional agreement from multiple ranked wallets

See [`docs/whale-monitor.md`](docs/whale-monitor.md) for the full setup and safety model.

## Vercel

Import `brandonlign/moneymog` into Vercel and use the default Next.js settings. No environment variables are required for the initial read-only dashboard.

Vercel remains the long-term dashboard. Continuous monitoring should run separately and report back to it.

## Free hosted monitor

The repository includes an optional **Cloudflare Worker + D1** implementation:

- `cloudflare/worker.js`
- `cloudflare/schema.sql`
- `wrangler.toml.example`

It is disabled by default. The example cron rotates through small wallet batches, stores only observation state and signals, and is intended for free paper testing—not latency-sensitive real-money execution.

After deployment, connect it to Vercel with server-side environment variables:

```text
MONEYMOG_WORKER_URL
MONEYMOG_WORKER_API_TOKEN
```

## Safety boundary

- No wallet credentials, private keys, or signing code exist.
- Dashboard scans and wallet ranking are read-only.
- Whale observation records signals only.
- Paper execution is disabled by default.
- Real-money execution is not implemented.
- Multi-outcome negative-risk arbitrage is not enabled.

## Modeling limits

A valid signal is not proof of future profitability:

- public wallet attribution can arrive after the original fill
- the copied price may be materially worse
- public positions may be part of an external hedge
- order-book depth can disappear before execution
- two-leg arbitrage is not atomic
- fees and protocol behavior can change

Paper results should eventually include measured detection delay, partial fills, rejected orders, book movement, and realistic bankroll constraints before real-money use is considered.
