# Whale monitor

TheOldTrader contains a disabled-by-default public-wallet monitor. It does not place simulated or real trades.

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

Save the qualified wallet array to a local ignored file, for example:

```text
.theoldtrader/qualified-whales.json
```

Then explicitly pass that file when you want one observation cycle:

```bash
npm run whales:observe -- .theoldtrader/qualified-whales.json
```

The file may contain wallet strings or the richer wallet objects produced by the ranking workflow. `.theoldtrader/` is gitignored, so local selections do not need environment variables and are not committed accidentally.

The first pass only saves a baseline. Later passes inspect trades that appeared after that baseline. The paper simulation remains separate.

## Free hosted observation

The repository includes a Cloudflare Worker + D1 version because Railway is not permanently free.

1. Create a free Cloudflare account.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Create a D1 database and replace the database ID.
4. Apply `cloudflare/schema.sql`.
5. Add an API token secret and your ranked wallet JSON.
6. Deploy with Wrangler.
7. Keep the hosted whale monitor disabled until you intentionally want observation to begin.
8. Add only the Worker URL and API token to Vercel as `THEOLDTRADER_WORKER_URL` and `THEOLDTRADER_WORKER_API_TOKEN`.

Hosted Worker configuration remains in `wrangler.toml`; it is separate from the app-level `.env` file.

## Safety boundary

- No private keys or Polymarket trading credentials are accepted.
- No order-submission code exists in the whale monitor.
- No simulated portfolio is modified by the local whale monitor.
- Real-money execution would require a separate, always-on, hardened worker and a new review of fees, geofencing, authentication, failure handling, and partial fills.
