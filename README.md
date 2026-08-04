# MoneyMog

MoneyMog is a **paper-first Polymarket research dashboard** with three separate engines:

- **Binary complete sets:** buys YES + NO below $1 or models splitting and selling both above $1.
- **Multi-outcome complete sets:** buys every stable negative-risk outcome when their executable total is below $1.
- **Whale watch:** ranks public wallets for repeatable forecasting skill and evaluates new trades after delay, liquidity, slippage, position, and churn checks.

No simulated or real trades start automatically.

## Dashboard

The Next.js dashboard uses a minimalist paper-ledger design and is ready for Vercel.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Read-only features require no wallet, private key, or API key.

## Commands

```bash
npm test              # all deterministic tests
npm run build         # production dashboard build
npm run scan          # binary complete-set scan
npm run scan:multi    # stable multi-outcome scan
npm run scan:all      # both arbitrage scanners
npm run whales:rank   # walk-forward public-wallet ranking
```

Observation remains locked until explicitly enabled:

```bash
MONEYMOG_WHALE_MONITOR_ENABLED=true npm run whales:observe
```

The first pass establishes a baseline so old trades are not mistaken for new signals.

The realistic paper runner also remains locked:

```bash
MONEYMOG_PAPER_ENABLED=true npm run paper:once
```

When enabled later, it detects opportunities, waits for the configured delay, fetches fresh order books, applies a liquidity haircut, models partial fills and failed later legs, enforces bankroll limits, and atomically saves the portfolio. It still cannot place real orders.

## Realistic simulation

The simulator records:

- detection and execution timestamps
- configurable execution delay
- fresh execution-time order books
- available depth after a liquidity haircut
- fees and fixed costs
- partial fills and unpaired exposure
- persistent cash, positions, realized profit, and execution IDs
- duplicate protection across restarts

Local state defaults to `.moneymog/paper-state.json`. Cloudflare D1 tables are also included for hosted persistence.

## Walk-forward whale selection

MoneyMog does not select wallets using their full history and then claim that same history as proof. It repeatedly:

1. scores only the earlier resolved markets;
2. decides whether the wallet would have qualified then;
3. evaluates the following unseen markets;
4. aggregates forward ROI, profitable-fold rate, and concentration.

Wallets with impressive historical results but poor later performance are rejected. Category-specific forward records are retained when enough observations exist.

## Monitoring health

Every monitor run can report:

- wallets expected versus successfully checked
- API and order-book errors
- source-data lag
- runtime
- signals and copy candidates produced
- whether state was persisted successfully

Health is classified as `HEALTHY`, `DEGRADED`, or `UNHEALTHY` and is exposed through the Cloudflare `/health` endpoint and dashboard.

## Multi-outcome safety

MoneyMog only evaluates event groups explicitly marked as negative-risk and containing at least three active order-book markets from the same group. It walks every YES book, includes each leg’s fees, and requires sufficient depth across the entire set.

It deliberately rejects:

- augmented negative-risk events
- any event containing an `Other` outcome
- mixed negative-risk groups
- deploying or inactive markets
- stale or incomplete books

This conservative filter avoids treating a changing or incomplete outcome list as a guaranteed $1 complete set.

## Vercel and free worker

Vercel remains the long-term dashboard. Continuous monitoring runs separately.

The repository includes a disabled-by-default **Cloudflare Worker + D1** implementation:

- `cloudflare/worker.js`
- `cloudflare/schema.sql`
- `cloudflare/research-store.js`
- `wrangler.toml.example`

After deploying it, connect Vercel using server-side environment variables:

```text
MONEYMOG_WORKER_URL
MONEYMOG_WORKER_API_TOKEN
```

## Safety boundary

- No wallet credentials, private keys, signing, or real-order code exist.
- Dashboard scans and wallet ranking are read-only.
- Whale observation only records signals.
- Paper execution is disabled by default.
- Real-money execution is not implemented.
- Multi-outcome scanning does not perform negative-risk conversions or submit trades.

## Remaining limits

Paper results are still estimates. Live markets may move between requests, public wallet attribution may be delayed, and a real multi-leg transaction is not atomic. The simulator records these risks rather than calling every detected spread guaranteed profit.
