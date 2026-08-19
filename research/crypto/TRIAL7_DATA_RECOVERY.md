# Trial 7 first-party data recovery rules

Status: **frozen before any Trial 7 candidate result**  
Experiment: `cross-venue-funding-v1` / Trial 7  
Purpose: provenance recovery only; **not** a second strategy specification

## Why this document exists

Trial 7 is scientifically prospective because its strategy, source rules, window, economics and evaluation gates are frozen before the observations occur. A six-month daemon is a useful acquisition mechanism, but daemon uptime is not itself the hypothesis.

The target is therefore at least **98% hourly first-party BTC context coverage**. Primary live recording is preferred. Missing contexts may count toward that same coverage metric only when recovered from an official first-party venue source under the predeclared rules below. The evidence bundle must identify primary and recovered observations separately.

Recovery may repair **data provenance/coverage only**. It may not change the position, venues, direction, notional, holding window, funding accounting, costs, collateral, stress rules, or evaluation gates in `manifests/cross-venue-funding-v1.json`.

## Primary live sources

### Hyperliquid

- `POST https://api.hyperliquid.xyz/info` with `type: metaAndAssetCtxs` for BTC mark/oracle context.
- `POST https://api.hyperliquid.xyz/info` with `type: fundingHistory`, BTC, for settled funding events.

### Binance USD-M

- `GET /fapi/v1/premiumIndex?symbol=BTCUSDT` for mark/index context.
- `GET /fapi/v1/fundingRate` for official settled funding events and event mark prices.

Every raw response used by the scientific result must be preserved or independently recoverable and SHA-256 identified.

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
4. the recovered context satisfies the same frozen timestamp tolerance as a live observation;
5. no interpolation, averaging between contexts, candle substitution, or later observation is used;
6. the recovered value is not selected by comparing which candidate value produces better Trial 7 P&L;
7. the generated compact record is explicitly marked as recovered rather than live and retains the archive provenance/hash.

A valid recovered context may count toward the frozen **hourly first-party context coverage** metric. If the official archive cannot supply the required context under those rules, the observation remains missing.

## Hyperliquid funding recovery

Settled funding rates may be re-fetched from the official `fundingHistory` API because they are historical event records. Recovery must preserve the raw API response and SHA-256. Duplicate observations with the same timestamp must agree within the evaluator's frozen numeric tolerance; conflicting duplicates abort evaluation rather than being averaged.

The funding event itself does not contain the oracle price required by Hyperliquid's funding-cashflow formula. The funding event therefore remains unusable unless an official live/archive asset context supplies the oracle under the frozen timestamp rule.

## Allowed Binance fallback

Binance funding events may be re-fetched only from the official USD-M `fundingRate` history endpoint. The evaluator uses the event's own `fundingTime`, `fundingRate`, and `markPrice`. It does not reconstruct funding notional from a candle.

Hourly Binance mark/index context may be recovered only from an **official Binance USD-M market-data interface** that exposes the corresponding historical mark/index series and exact timestamps. The exact endpoint/request and raw response must be preserved and SHA-256 identified. Recovery must use the same timestamp rule as live recording and may not choose between multiple official series after comparing candidate P&L.

Entry/exit Binance context remains subject to the frozen 10-minute boundary tolerance. If no first-party source can establish the required mark/index context within tolerance, the scientific gate fails rather than substituting a third-party price.

## Sources that are prohibited from scoring Trial 7

The following may be useful for methodology comparison but **cannot** fill a scientific Trial 7 observation:

- the Lau (2026) paper's cached historical data;
- the paper's Zenodo replication files;
- CoinGlass or other funding aggregators;
- exchange-data resellers;
- TradingView or chart screenshots;
- third-party reconstructed Hyperliquid archives;
- a later candle interpolated to the missing event;
- a synthetic zero funding event;
- a prior funding rate carried forward.

Using one of those sources for candidate scoring would change the frozen provenance rule and requires a new trial rather than a silent repair.

## Coverage accounting

The evaluator's existing implementation field is named `minimumRecorderCoverage` for compatibility with the initial code, but the frozen manifest now defines its scientific meaning as **hourly first-party context coverage**.

For each required hourly context bucket, count at most one usable observation:

- `PRIMARY_LIVE` — captured prospectively by the Trial 7 recorder; or
- `OFFICIAL_RECOVERY` — reconstructed later from an allowed first-party source under this document.

The combined usable coverage must be at least 98%. The evidence bundle must additionally report primary-live coverage separately so the reader can see how much of the result depended on recovery.

A recovered context does **not** excuse a funding-event gap, timestamp mismatch, raw-hash failure, missing funding-notional price, or conflicting duplicate. Those remain independent fail-closed gates.

## Recovery report requirement

Any screening/final Trial 7 evidence bundle must state separately:

- primary live-record observations used and primary-live coverage;
- official Hyperliquid archive observations used;
- official funding-history observations re-fetched;
- official Binance historical contexts used;
- combined hourly first-party context coverage;
- unrecovered gaps;
- source object/API hashes;
- timestamp match distances;
- raw source type for every recovered record.

No recovery decision may depend on whether it improves or worsens Trial 7 return. If two allowed first-party constructions materially disagree and the manifest does not already choose between them, evaluation must stop for a provenance investigation rather than selecting the better result.
