# Trial 7 — `cross-venue-funding-v1` forward freeze

Initial current-branch freeze timestamp: **2026-08-19T21:15:27Z**  
Final implementation freeze timestamp: **2026-08-19T22:54:27Z**  
Scientific start: **2026-08-20T00:00:00Z**  
90-day screening boundary: **2026-11-18T00:00:00Z**  
180-day final boundary: **2027-02-16T00:00:00Z**  
Paper/research only: **yes**  
Real-money trading authorized: **no**

The authoritative scientific specification is **`research/crypto/manifests/cross-venue-funding-v1.json`**. This note explains provenance; when prose and executable detail differ, evaluation must stop and the canonical manifest plus its regression tests control. No economic specification may be changed after the first Trial 7 candidate result.

## Why this is Trial 7, despite the old branch saying Trial 5

A stale branch named `research/cross-venue-funding-v1` was created on 2026-08-18 before any TheOldTrader cross-venue result was observed. It contains two preserved commits:

- `ed726ad32574c5aa41ef791dc90f19bff46b0e1e` — `Freeze Trial 5 cross-venue funding specification`
- `68dd16647fe7721bbd5509162fec1f8fc3a90a13` — `Add forward recorder for Trial 5`

That branch diverged before the later time-series-momentum and low-volatility experiments were evaluated and formally occupied Trials 5 and 6. The old branch is intentionally **not** force-reset or rewritten.

This branch carries the same cross-venue economic candidate forward as **Trial 7**. Renumbering is administrative trial-accounting hygiene; it does not erase the earlier freeze or pretend the candidate was invented after the Trial 5/6 failures.

## Pre-result revision history

All changes below were made before the scientific start and before any TheOldTrader Trial 7 candidate performance was observed. The manifest contains the full timestamped revision log.

### Economic/risk clarifications

1. **Prospective start moved Aug. 19 → Aug. 20.** Continuous scientific acquisition was not established before the old boundary passed. The new boundary was frozen before any candidate return/funding-spread result was inspected.
2. **Hyperliquid funding uses oracle price.** The stale draft said mark price. The first-party mechanism uses position size × oracle price × funding rate.
3. **Promotion stress made harder.** The primary candidate remains 15 bps all-in per venue order; a separate 25 bps/order promotion stress plus venue-by-venue margin and 5%/10%/25% adverse relative-basis shocks were frozen before data.
4. **Funding at the exact entry/exit boundary is excluded.** Only events strictly inside the declared window accrue.
5. **Risk/reporting semantics were made explicit.** Max drawdown begins from pre-entry equity; daily risk returns use fixed 24-hour boundary-to-boundary observations; Sortino uses zero-target downside deviation; three 60-day contribution windows telescope to full 180-day P&L; funding, raw basis and execution friction are separately reported; break-even all-in friction is solved analytically under the frozen four-fill model.

### Timing/provenance hardening

6. **Primary hourly context target fixed at `HH:00:05Z`.** This removes a later choice of sampling offset.
7. **Boundary fills use the first valid official context at or after the boundary within 10 minutes.** A pre-boundary observation is ineligible even if closer in absolute time.
8. **Hyperliquid raw funding timestamps normalize to the nearest UTC hour only within ±60 seconds.** Raw timestamps/skews remain preserved; collisions/conflicting duplicates fail closed.
9. **Binance completeness follows Binance's announced schedule.** Every in-window `premiumIndex.nextFundingTime` announcement must later appear as an official settled `fundingRate.fundingTime`; the evaluator does not assume an immutable eight-hour interval.
10. **Compact/raw provenance is timestamp-bound.** Every PRIMARY_LIVE compact source must resolve to the same source/hash/acquisition type at the exact same `recordedAt` in the preserved raw archive before economics can run.
11. **Recorder/evaluator/reporter are canonical-manifest locked.** A custom manifest cannot be substituted through the supported scientific commands.
12. **Recovery is specified but fail-closed in the evaluator until source-specific independent raw parsers exist.** A prose claim or third-party parser cannot make recovered data score the candidate.

None of these changes used a Trial 7 P&L, favorable funding spread, subperiod choice, asset screen, threshold, venue switch, leverage search, or cost optimization.

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
- Unused capital remains zero-return cash.

Equal base units remove first-order BTC direction, but cross-venue basis, execution, funding, stablecoin/collateral, venue and margin risks remain real. “Delta neutral” is not treated as “risk free.”

## Funding accounting

Rates are never resampled to a synthetic common interval and never forward-filled.

- Hyperliquid: each valid hourly settled event strictly inside the window is accrued on the short using the first valid official oracle context at or after its normalized UTC-hour event time, within the frozen tolerance. Positive funding is received by the short; negative funding is paid.
- Binance: each valid official settled event strictly inside the window is accrued on the long using the event's official `markPrice`. Positive funding is paid by the long; negative funding is received.

A required event, schedule announcement, funding-notional price, raw hash, raw semantic reconstruction, or timestamp match that cannot satisfy the frozen first-party rules fails the data gate before strategy P&L is calculated.

## Price, cost and consistency accounting

The primary decomposition is:

`net P&L = net funding P&L + raw cross-venue basis P&L − modeled execution friction`.

The report always shows the three terms separately. After-friction leg/basis P&L may also be shown as a diagnostic, but it is never added to execution friction again.

For the 180-day final, three consecutive 60-day contribution windows use the same total-equity path. Entry friction appears in window 1, exit friction in window 3, and the three windows must telescope back to full final P&L within numerical tolerance.

## Evidence boundaries

The Lau (2026) paper and its Zenodo replication package are **motivation only**. Their historical sample may be used to understand methodology/failure modes but may not be counted as TheOldTrader validation, fill a missing observation, choose a subperiod, or authorize promotion.

The 90-day screen is predeclared interim evidence. It cannot authorize a parameter change and cannot promote the strategy. The 180-day final result is the first promotion-eligible forward window, but even a full pass can only produce `PROMOTION_ELIGIBLE_RESEARCH_ONLY` and a separate proposal about the paper baseline. It never authorizes real-money execution.

## Failure / anti-rescue rule

After the first Trial 7 candidate result is observed, do not change direction, asset, venues, allocation, costs, collateral, boundaries, sampling rule, funding normalization, schedule audit, data substitution, holding rule, risk statistics, consistency windows, or stress rules under `cross-venue-funding-v1`.

A failed Trial 7 stays failed. Any economically changed successor must receive a new numbered trial.
