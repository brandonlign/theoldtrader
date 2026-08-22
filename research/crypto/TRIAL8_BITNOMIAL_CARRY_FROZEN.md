# Trial 8 — `bitnomial-carry-v1`

Final pre-observation freeze: **2026-08-20T00:16:31Z**  
Scientific start: **2026-08-20T02:00:00Z**  
90-day screening boundary: **2026-11-18T02:00:00Z**  
180-day final boundary: **2027-02-16T02:00:00Z**  
Paper/research only: **yes**  
Real-money trading authorized: **no**

The authoritative specification is `research/crypto/manifests/bitnomial-carry-v1.json`. Its exact Git blob identity is pinned by `lib/trial8-freeze-identity.js`. Supported Trial 8 commands run the byte guard before collection, health, evaluation or reporting.

## Why Trial 8 exists

Trial 7 froze a Binance-USD-M / Hyperliquid cross-venue funding spread before performance observation, but the required Binance public futures endpoint returned HTTP 451 from both available collection environments. No Trial 7 candidate observation was recorded. Trial 7 is therefore retained as an **operational no-start**, not rewritten as a failed strategy and not used to tune Trial 8.

Trial 8 preserves the independently motivated carry mechanism while changing the economic instrument pair, so it receives a new trial number rather than masquerading as a Trial 7 infrastructure fix.

## Frozen economic candidate

- Buy Coinbase Exchange `BTC-USD` spot.
- Short the Bitnomial `PBTCUC` Bitcoin USD Centi perpetual.
- Bitnomial contract size is fixed at 0.01 BTC; only whole contracts are allowed.
- Target notional is 20% of $10,000 starting equity per leg.
- Number of contracts = floor(target notional / one-contract notional), subject to a 25% maximum actual notional cap per leg.
- Buy exactly the same BTC quantity on Coinbase as the short Bitnomial contracts represent.
- Hold once from the frozen start to the frozen evaluation boundary.
- No rebalancing, compounding, funding threshold, direction switching, asset selection, leverage optimization or outcome-driven entry timing.
- Unused capital remains zero-return cash.

Equal BTC units hedge first-order BTC direction, but the position still carries spot/perpetual basis risk, venue risk, funding-sign risk, execution costs and futures collateral risk.

## Return mechanism

Bitnomial perpetual funding settles every eight hours at 00:00, 08:00 and 16:00 UTC. Positive funding means longs pay shorts. For each valid first-party funding interval with `startBoundary < interval_end <= endBoundary`, Trial 8 credits the short:

`BTC quantity × Bitnomial funding mark_price × funding_rate`.

Rates are never resampled, interpolated or forward-filled. Every regular eight-hour settlement inside the held interval must be present; an unexplained missing settlement fails the data gate before economics are calculated.

## First-party source model

Coinbase public source:

- `GET https://api.exchange.coinbase.com/products/BTC-USD/ticker`
- preserves bid, ask, last price and exchange timestamp.

Bitnomial public sources:

- product specs: `/exchange/api/v1/prod/product/specs/`
- live product data: `/exchange/api/v1/prod/product/data/:product_id`
- funding history: `/exchange/api/v1/funding-rates/`

The recorder must identify exactly one active Bitcoin USD Centi perpetual, verify 0.01-BTC contract size, convert Bitnomial tick prices to USD using `price_increment`, and keep funding rows only for the same product ID.

Every raw response is preserved and SHA-256 hashed. The evaluator independently reparses the exact raw bytes and reproduces Coinbase ticker values, Bitnomial product identity/price and all funding fields before strategy P&L may be calculated.

## Frozen execution model

### Coinbase spot

Primary per order:

- 60 bps fee;
- 10 bps additional adverse slippage;
- entry uses the observed ask;
- exit uses the observed bid.

### Bitnomial perpetual

Primary per order:

- $0.10 exchange+clearing fee per contract per side;
- 10 bps adverse price slippage.

### Promotion cost stress

- Coinbase: 100 bps all-in per order;
- Bitnomial: 25 bps adverse slippage per order plus the same fixed $0.10/contract/side fee.

Four orders occur over the round trip: Coinbase buy/sell and Bitnomial short/cover.

## Price and data-quality gates

- Entry and exit use the first valid official observation at or after the declared boundary within ten minutes.
- Pre-boundary observations are ineligible.
- At least 98% of expected hourly first-party contexts must exist.
- No context gap may exceed 130 minutes.
- Bitnomial `last_price_time` must be no more than 30 minutes old at retained contexts/exit; a stale trade is not replaced with an invented or third-party price.
- All compact source hashes must exist in the preserved raw archive.
- Product ID must remain invariant.

## Margin/risk gates

Trial 8 reserves 30% of starting equity as research collateral for the short perpetual. The frozen research maintenance threshold is 15% of current perpetual notional. The observed path plus adverse 5%, 10% and 20% short-venue relative-basis shocks must all remain above that threshold.

The evaluator reports total-equity max drawdown, daily Sharpe/Sortino, funding, spot P&L, perpetual P&L, basis P&L, explicit fees, high-cost stress and three non-overlapping 60-day contribution windows.

## Gates

### 90 days

The screen cannot promote or authorize retuning. It requires clean data/provenance, positive primary net P&L, positive funding contribution and no observed/frozen-stress margin breach.

### 180 days

Strongest possible result: `PROMOTION_ELIGIBLE_RESEARCH_ONLY`.

It additionally requires:

- annualized net return on total starting equity >1%;
- at least two of three 60-day windows positive;
- max drawdown <10%;
- high-cost stress net positive.

Even a full pass authorizes only a separate proposal to replace the paper baseline. It does not authorize real-money trading.

## Anti-rescue rule

After the first Trial 8 candidate observation, changing venues, direction, asset, contract/BTC sizing, costs, collateral, boundaries, funding rule, stale-price rule, source substitution, holding rule or stress rules requires a new trial number. Trial 7 performance cannot be used to tune Trial 8, and published historical returns cannot score Trial 8.
