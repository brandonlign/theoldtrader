# Trial 7 first-party data recovery rules

Status: **frozen before any Trial 7 candidate result**  
Experiment: `cross-venue-funding-v1` / Trial 7  
Purpose: provenance recovery only; **not** a second strategy specification

## Why this document exists

Trial 7 is scientifically prospective because its strategy, source rules, window, economics and evaluation gates are frozen before the observations occur. A six-month daemon is a useful acquisition mechanism, but daemon uptime is not itself the hypothesis.

The target is at least **98% hourly first-party BTC context coverage**. Primary live recording is preferred. Missing contexts may count toward that metric only when recovered from an official first-party venue source under the rules below. The evidence bundle must identify primary and recovered observations separately.

Recovery may repair **data provenance/coverage only**. It may not change the position, venues, direction, notional, holding window, funding accounting, costs, collateral, boundary cashflow rules, sampling/timestamp rules, risk statistics, consistency windows, stress rules, or evaluation gates in the canonical `manifests/cross-venue-funding-v1.json`.

**Current implementation status:** `OFFICIAL_RECOVERY` remains fail-closed in the scientific evaluator. These rules authorize future engineering of exact source-specific recovery adapters; they do not make recovered data usable by prose alone. An adapter must independently reconstruct its compact fields from preserved first-party raw bytes/objects and pass dedicated tests before recovered rows can score Trial 7.

## Frozen timing rules recovery must preserve

Recovery may never create a different timing convention from primary-live data:

- normal primary context target is `HH:00:05Z`;
- entry/exit selection is the **first valid official observation at or after** the declared boundary within 10 minutes;
- a pre-boundary observation is ineligible even if closer in absolute time;
- Hyperliquid settled funding may normalize to the nearest UTC hour only when raw absolute skew is ≤60 seconds, with raw timestamp/skew preserved;
- Hyperliquid funding oracle matching uses the first valid official context at or after the normalized event within the frozen funding-price tolerance;
- funding cashflows satisfy `startBoundary < eventTime <= endBoundary`: exact start-boundary funding is excluded, exact end-boundary funding is included;
- Binance funding completeness follows the venue-announced `nextFundingTime` schedule rather than a synthetic fixed interval.

A recovery adapter that cannot reproduce those same rules cannot score Trial 7.

## Primary live sources

### Hyperliquid

- `POST https://api.hyperliquid.xyz/info` with `type: metaAndAssetCtxs` for BTC mark/oracle context.
- `POST https://api.hyperliquid.xyz/info` with `type: fundingHistory`, BTC, for settled funding events.

### Binance USD-M

- `GET /fapi/v1/premiumIndex?symbol=BTCUSDT` for mark/index context and the venue-announced `nextFundingTime` schedule.
- `GET /fapi/v1/fundingRate` for official settled funding events and event mark prices.

Every raw response/object used by the scientific result must be preserved or independently recoverable and SHA-256 identified.

## Allowed Hyperliquid fallback

Hyperliquid's first-party historical-data documentation identifies the requester-pays bucket:

```text
s3://hyperliquid-archive/asset_ctxs/[date].csv.lz4
```

for historical asset contexts. Hyperliquid explicitly warns that archive uploads occur only approximately monthly, are not guaranteed timely, and may have missing data.

A missing live BTC asset-context observation may be repaired from that official `asset_ctxs` object only when all of the following hold:

1. the exact archive object key, byte SHA-256 and decompressed byte SHA-256 are preserved;
2. the parser extracts BTC only after the raw archive has been preserved/hashed;
3. the recovered record contains the required oracle/mark fields and a source timestamp;
4. the recovered context satisfies the same frozen directional timestamp rule as a live observation—first valid official context at or after the target time, never a pre-target nearest neighbor;
5. no interpolation, averaging between contexts, candle substitution, or later outcome-driven selection is used;
6. the recovered value is not selected by comparing which candidate value produces better Trial 7 P&L;
7. the generated compact record is explicitly marked `OFFICIAL_RECOVERY` and retains archive provenance/hashes sufficient for an independent semantic audit.

A valid recovered context may count toward the frozen **hourly first-party context coverage** metric only after the source-specific recovery semantic adapter exists and passes. If the official archive cannot supply the required context under those rules, the observation remains missing.

## Hyperliquid funding recovery

Settled funding rates may be re-fetched from the official `fundingHistory` API because they are historical event records. Recovery must preserve the raw API response and SHA-256. Raw funding time must pass the same frozen ±60-second nearest-UTC-hour normalization. Duplicate observations for the same normalized timestamp must agree under the frozen numeric tolerance; collisions/conflicting duplicates abort evaluation rather than being averaged.

The funding event itself does not contain the oracle price required by Hyperliquid's funding-cashflow formula. The event remains unusable unless an allowed first-party live/archive context supplies `oraclePx` under the same **at-or-after** funding-event rule.

## Allowed Binance fallback

Binance funding events may be re-fetched only from the official USD-M `fundingRate` history endpoint. The evaluator uses the event's own `fundingTime`, `fundingRate`, and `markPrice`; it does not reconstruct funding notional from a candle.

The recovered evidence must also preserve the first-party funding schedule. A Binance recovery adapter must establish the `premiumIndex.nextFundingTime` announcements used by the frozen completeness audit or otherwise demonstrate an exact first-party historical representation of the same announcement schedule before it can score Trial 7. Merely obtaining settled `fundingRate` rows is not sufficient to weaken or bypass the announced-schedule gate.

Hourly Binance mark/index context may be recovered only from an **official Binance USD-M market-data interface** that exposes the corresponding historical mark/index series and exact timestamps. The exact endpoint/request and raw response must be preserved and SHA-256 identified. Entry/exit context must remain the first valid official context **at or after** the frozen boundary within 10 minutes. A pre-boundary price is prohibited even if closer.

If no first-party source can establish the required mark/index context or announced funding schedule under the frozen rules, the scientific gate fails rather than substituting a third-party price or inferred schedule.

## Sources that are prohibited from scoring Trial 7

The following may be useful for methodology comparison but **cannot** fill a scientific Trial 7 observation:

- the Lau (2026) paper's cached historical data;
- the paper's Zenodo replication files;
- CoinGlass or other funding aggregators;
- exchange-data resellers;
- TradingView or chart screenshots;
- third-party reconstructed Hyperliquid archives;
- a later candle interpolated to the missing event;
- a pre-boundary context substituted for the first required post-boundary context;
- a synthetic zero funding event;
- a prior funding rate carried forward;
- an assumed eight-hour Binance interval used in place of the venue-announced schedule.

Using one of those sources for candidate scoring would change the frozen provenance rule and requires a new trial rather than a silent repair.

## Coverage accounting

The evaluator's implementation field `minimumRecorderCoverage` is retained for compatibility, but the canonical manifest defines its scientific meaning as **hourly first-party context coverage**.

For each required hourly context bucket, count at most one usable observation:

- `PRIMARY_LIVE` — captured prospectively by the Trial 7 recorder; or
- `OFFICIAL_RECOVERY` — reconstructed later from an allowed first-party source under this document **after** a source-specific independent semantic adapter is implemented/tested.

The combined usable coverage must be at least 98%. The evidence bundle must additionally report primary-live coverage separately so the reader can see how much of the result depended on recovery.

A recovered context does **not** excuse a funding-event gap, timestamp mismatch, raw-hash failure, announced-schedule gap, missing funding-notional price, or conflicting duplicate. Those remain independent fail-closed gates.

## Recovery report requirement

Any screening/final Trial 7 evidence bundle that uses recovery must state separately:

- primary live-record observations used and primary-live coverage;
- official Hyperliquid archive observations used;
- official funding-history observations re-fetched;
- official Binance historical contexts/schedule evidence used;
- combined hourly first-party context coverage;
- unrecovered gaps;
- source object/API hashes;
- source timestamps and target-to-source match distances;
- raw source type for every recovered record;
- recovery adapter/version and its independent semantic-audit result.

No recovery decision may depend on whether it improves or worsens Trial 7 return. If two allowed first-party constructions materially disagree and the canonical manifest does not already choose between them, evaluation must stop for a provenance investigation rather than selecting the better result.
