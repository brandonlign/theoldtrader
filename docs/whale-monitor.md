# Whale monitor

MoneyMog contains a disabled-by-default public-wallet monitor. It does not place simulated or real trades.

## What it does

1. Pulls top wallets from Polymarket category leaderboards.
2. Scores resolved histories using sample size, approximate ROI, win rate, drawdown, profit factor, category rank, and profit after removing the wallet's largest win.
3. Rejects wallets whose apparent success depends on one trade.
4. Establishes a baseline before monitoring, so old trades are never treated as new signals.
5. For each new public BUY, checks current position, trade size versus the wallet's normal size, two-sided churn, detection delay, live order-book depth, fee schedule, and price deterioration.
6. Records either `COPY_CANDIDATE` or `REJECTED` with explicit reasons. It does not alter a balance.

## Local read-only ranking

```bash
npm run whales:rank
```

This fetches public data and prints recommended wallets. It does not save state or start monitoring.

## Local observation

Put selected wallets in `MONEYMOG_WHALE_WALLETS`, then explicitly enable observation:

```bash
MONEYMOG_WHALE_MONITOR_ENABLED=true npm run whales:observe
```

The first pass only saves a baseline. Later passes inspect trades that appeared after that baseline. The paper simulation remains paused.

## Free hosted observation

The repository includes a Cloudflare Worker + D1 version because Railway is not permanently free.

1. Create a free Cloudflare account.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Create a D1 database and replace the database ID.
4. Apply `cloudflare/schema.sql`.
5. Add an API token secret and your ranked wallet JSON.
6. Deploy with Wrangler.
7. Keep `MONITOR_ENABLED=false` until you intentionally want observation to begin.
8. Add the Worker URL and API token to Vercel as `MONEYMOG_WORKER_URL` and `MONEYMOG_WORKER_API_TOKEN`.

The example polls every minute but processes only a small rotating wallet batch. That is suitable for zero-cost paper observation, not latency-sensitive real-money execution.

## Safety boundary

- No private keys or Polymarket trading credentials are accepted.
- No order-submission code exists in the whale monitor.
- No simulated portfolio is modified.
- Real-money execution will require a separate, always-on, hardened worker and a new review of fees, geofencing, authentication, failure handling, and partial fills.
