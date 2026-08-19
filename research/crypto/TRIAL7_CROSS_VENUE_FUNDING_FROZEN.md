# Trial 7 — `cross-venue-funding-v1` forward freeze

Freeze timestamp: **2026-08-19T21:15:27Z**  
Scientific start: **2026-08-20T00:00:00Z**  
90-day screening boundary: **2026-11-18T00:00:00Z**  
180-day final boundary: **2027-02-16T00:00:00Z**  
Paper/research only: **yes**  
Real-money trading authorized: **no**

## Why this is Trial 7, despite the old branch saying Trial 5

A stale branch named `research/cross-venue-funding-v1` was created on 2026-08-18 before any TheOldTrader cross-venue result was observed. It contains two preserved commits:

- `ed726ad32574c5aa41ef791dc90f19bff46b0e1e` — `Freeze Trial 5 cross-venue funding specification`
- `68dd16647fe7721bbd5509162fec1f8fc3a90a13` — `Add forward recorder for Trial 5`

That branch diverged from `research/crypto-oos-v1` before the later time-series-momentum and low-volatility experiments were evaluated and formally occupied Trials 5 and 6. The old branch is intentionally **not** force-reset or rewritten.

This current branch carries the same cross-venue economic candidate forward as **Trial 7**. Renumbering is administrative trial-accounting hygiene; it does not erase the earlier freeze or pretend the candidate was invented later.

## What changed before any Trial 7 result

Three pre-result corrections are explicit rather than hidden:

1. **Forward start moved by one day.** The old manifest named 2026-08-19T00:00:00Z, but continuous scientific acquisition had not been established before that boundary passed. The prospective boundary is therefore moved to 2026-08-20T00:00:00Z before any TheOldTrader cross-venue candidate result is inspected.
2. **Hyperliquid funding uses oracle price.** The old draft said mark price for funding notional. Hyperliquid's first-party funding documentation states that the actual payment is `position_size * oracle_price * funding_rate`. The current manifest therefore requires an official oracle context near each funding event and fails closed if it cannot be recovered.
3. **Promotion stress is stronger.** The primary economic candidate remains 15 bps all-in friction per venue order. A predeclared 25 bps/order stress and explicit margin/basis stresses are added as failure gates. These can only make promotion harder.

No historical or forward TheOldTrader P&L, funding spread, subperiod selection, threshold optimization, asset selection, venue switching, leverage search, or cost tuning was used to make those revisions.

## Frozen economic candidate

- Asset: **BTC only**.
- Long leg: Binance USD-M `BTCUSDT` perpetual.
- Short leg: Hyperliquid BTC perpetual.
- Enter once; exit once.
- Identical BTC quantity on both legs.
- Each leg starts near 15% of starting equity notional.
- 20% of starting equity is reserved as collateral for each venue.
- No rebalancing.
- No compounding.
- No funding-rate threshold.
- No direction switching.
- No asset selection.
- No leverage optimization.
- Primary execution friction: **15 bps per order**, four orders across paired entry/exit.
- Promotion stress: **25 bps per order**.
- Unused capital remains cash.

The position is intended to isolate the *relative funding differential* rather than BTC direction. Equal base units remove first-order directional exposure, but cross-venue basis, fee, funding, stablecoin/collateral, venue and margin risks remain real and must be measured rather than assumed away.

## Funding accounting

Rates are never converted into a synthetic common rate and never forward-filled.

- Hyperliquid: every actual hourly event is accrued on the short using the matched official oracle price. Positive funding is received by the short; negative funding is paid.
- Binance: every actual official funding event is accrued on the long using the `markPrice` returned with the funding-history event. Positive funding is paid by the long; negative funding is received.

If a required event or funding-notional price cannot be established from first-party venue data under the frozen timestamp rules, scientific evaluation fails the data gate.

## Price/basis accounting

The evaluator must report separately:

1. Hyperliquid funding P&L;
2. Binance funding P&L;
3. net funding spread P&L;
4. Binance long price P&L;
5. Hyperliquid short price P&L;
6. combined cross-venue basis P&L;
7. entry/exit friction;
8. final net paired P&L.

A profitable funding component is insufficient if cross-venue basis movement or costs erase it.

## Evidence boundaries

The Lau (2026) paper and its Zenodo replication package are **motivation only**. Their historical sample may be used to understand methodology and failure modes but may not be counted as TheOldTrader validation or used to choose Trial 7 subperiods.

The 90-day screen is predeclared interim evidence. It cannot authorize a parameter change and cannot promote the strategy. The 180-day final result is the first promotion-eligible forward window, but even a pass only allows a separate proposal to replace the paper baseline; it never authorizes real-money execution.

## Failure / anti-rescue rule

After the first Trial 7 candidate result is observed, do not change the direction, asset, venues, allocation, costs, collateral, window, filters, data substitution, funding-price rule, holding rule, or stress rules under `cross-venue-funding-v1`.

A failed Trial 7 stays failed. Any economically changed successor must receive a new numbered trial.
