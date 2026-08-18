# TheOldTrader

TheOldTrader is one **hosted, paper-only Polymarket research system**:

- **Vercel** serves the paper-ledger dashboard.
- **Cloudflare Worker** rotates small scheduled market and wallet batches.
- **Cloudflare D1** is the shared source of truth for cash, positions, executions, opportunities, whale signals, Hero decisions, and Worker health.

There are no wallet keys, signing functions, approvals, or real-order endpoints anywhere in the project.

## Research engines

1. **Binary complete-set arbitrage** — evaluates executable YES + NO complete sets after depth, fees, safety buffers, stale-book checks, and delayed re-fetches.
2. **Stable multi-outcome complete-set arbitrage** — only accepts non-augmented negative-risk groups with at least three active outcomes, no `Other` outcome, consistent grouping, and complete live books.
3. **Conservative whale-copy simulation** — only considers new public BUY trades from pre-qualified wallets after score, walk-forward, delay, churn, price, slippage, current-position, and liquidity checks.
4. **Hero allocator** — prioritizes structural opportunities, limits per-market and per-category concentration, reserves most cash each cycle, blocks duplicates, and caps directional whale paper exposure.

Every candidate is persisted with a selected or rejected decision and its reasons.

## Conservative hosted defaults

- Worker cron: every 5 minutes.
- Binary batch: 30 markets per cycle, rotated through a bounded window.
- Multi-outcome batch: 5 events per cycle, also rotated.
- Whale batch: 2 configured wallets per cycle.
- Maximum capital considered per cycle: 12% of account equity.
- Structural share of that cycle budget: 90%.
- Maximum whale allocation: 0.75% per trade and 2.5% total account exposure.
- Execution delay: 2 seconds, followed by fresh order-book requests.
- Available depth haircut: 25%.
- Minimum paired multi-leg fill: 92%.

These settings intentionally do **not** pretend a free Worker can scan every market every minute.

## Local validation

```bash
npm install
npm test
npm run build
```

Useful read-only commands:

```bash
npm run scan
npm run scan:multi
npm run scan:all
npm run whales:rank
```

The local JSON paper runner is separate from the hosted D1 portfolio. It starts only when you explicitly run `npm run paper:once` or `npm run paper:run`; no environment flag is required.

# Beginner hosted setup

## 1. Create the Cloudflare D1 database

Install dependencies and log in:

```bash
npm install
npx wrangler@latest login
```

Create the database:

```bash
npx wrangler@latest d1 create theoldtrader
```

Cloudflare prints a `database_id`. Copy the Worker example:

```bash
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and replace:

```text
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

with the ID Cloudflare printed.

Create the tables in the remote D1 database:

```bash
npx wrangler@latest d1 execute theoldtrader --remote --file=cloudflare/schema.sql
```

## 2. Add the Worker API secret

Generate a long random token:

```bash
openssl rand -hex 32
```

Copy the output somewhere private, then store it in Cloudflare:

```bash
npx wrangler@latest secret put API_TOKEN
```

Paste the random token when prompted. The same token will later be added to Vercel.

Do not add this token to `wrangler.toml`, GitHub, or a browser-exposed variable.

## 3. Deploy the Worker while simulation is paused

Confirm this remains in `wrangler.toml`:

```toml
PAPER_SIMULATION_ENABLED = "false"
```

Deploy:

```bash
npx wrangler@latest deploy
```

Wrangler prints a URL similar to:

```text
https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev
```

Test the public service check:

```bash
curl https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev/health
```

Then test the authenticated shared snapshot:

```bash
curl -H "Authorization: Bearer YOUR_RANDOM_TOKEN" \
  https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev/api/snapshot
```

At this point it should report a paused paper portfolio with a $10,000 starting balance.

## 4. Optional: configure qualified whale wallets

Keep this disabled initially:

```toml
WHALE_MONITOR_ENABLED = "false"
WHALE_WALLETS = "[]"
```

After running `npm run whales:rank` and freezing qualified wallets, use JSON like:

```toml
WHALE_MONITOR_ENABLED = "true"
WHALE_WALLETS = '[{"wallet":"0xREPLACE_WITH_40_HEX_CHARACTERS","score":80,"walkForward":{"OVERALL":{"eligible":true,"forwardRoi":0.08,"profitableFoldRate":0.70}}}]'
```

A high historical score alone is not enough. The Hero allocator rejects whale signals without eligible forward evidence, positive forward ROI, and sufficient profitable-fold consistency.

Redeploy after editing Worker variables:

```bash
npx wrangler@latest deploy
```

## 5. Import the repository into Vercel

1. Open the Vercel dashboard.
2. Choose **Add New → Project**.
3. Import `brandonlign/theoldtrader` from GitHub.
4. Keep the detected framework as **Next.js**.
5. Keep the root directory as the repository root.
6. Do not change the build command.

## 6. Add Vercel environment variables

In the Vercel project, open **Settings → Environment Variables** and add only:

```text
THEOLDTRADER_WORKER_URL=https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev
THEOLDTRADER_WORKER_API_TOKEN=YOUR_RANDOM_TOKEN
```

These are the only app-level environment variables TheOldTrader needs. Add them to Production, Preview, and Development if you want every Vercel environment to show the same D1 paper account. Redeploy the Vercel project after saving them.

These variables are server-side. Never rename them with a `NEXT_PUBLIC_` prefix.

## 7. Verify the dashboard connection before enabling simulation

Open the Vercel deployment. It should show:

- status `PAUSED`;
- paper balance `$10,000.00`;
- zero positions and executions;
- a real Worker run timestamp after the scheduled trigger fires;
- no Worker connection warning.

You can create a paused run immediately instead of waiting for cron:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_RANDOM_TOKEN" \
  https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev/api/run
```

## 8. Enable the hosted paper simulation

Only after the paused snapshot and Vercel dashboard both work, change this in `wrangler.toml`:

```toml
PAPER_SIMULATION_ENABLED = "true"
```

Deploy again:

```bash
npx wrangler@latest deploy
```

This enables **paper simulation only**. It does not enable real trading because no real execution code exists.

## 9. Verify automatic updates

Trigger one cycle manually:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_RANDOM_TOKEN" \
  https://theoldtrader-paper-worker.YOUR-SUBDOMAIN.workers.dev/api/run
```

Refresh the Vercel dashboard. Confirm:

1. Worker status is `HEALTHY` or, when one source failed, `DEGRADED` with an error count.
2. The last-run time changed.
3. Opportunities and Hero decisions appear even when all candidates were rejected.
4. Any accepted execution appears in the execution ledger.
5. Cash, realized paper P&L, and open positions match `/api/snapshot`.
6. The page updates on its own within about 15 seconds while open.

Scheduled cycles then continue every five minutes.

# Worker APIs

All portfolio data APIs require `Authorization: Bearer <API_TOKEN>`:

```text
GET  /api/snapshot
GET  /api/portfolio
GET  /api/executions
GET  /api/opportunities
GET  /api/signals
GET  /api/health
POST /api/run
```

`GET /health` is only a minimal unauthenticated service check and does not expose portfolio state.

# Resetting the paper account

Changing `PAPER_STARTING_CASH` does not overwrite an existing D1 portfolio. This protects results from accidental resets. To restart from scratch, delete and recreate the D1 database, then rerun `cloudflare/schema.sql`.

# Modeling limits

Paper fills remain estimates. Public wallet data can arrive late, books can move between calls, fee behavior can change, and real multi-leg execution would not be atomic. TheOldTrader records delayed books, partial fills, failed later legs, stale data, fees, concentration limits, and rejection reasons rather than calling detected spreads guaranteed profit.