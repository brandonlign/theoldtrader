# Trial 7 first-party data recovery rules

Status: **frozen before any Trial 7 candidate result**  
Experiment: `cross-venue-funding-v1` / Trial 7  
Purpose: provenance recovery only; **not** a second strategy specification

## Why this document exists

The primary Trial 7 evidence is prospective hourly recording from the official Binance and Hyperliquid public endpoints. A single long-running process can nevertheless fail for engineering reasons. This document defines in advance when an official historical source may repair a missing raw observation without allowing a later researcher to choose a convenient substitute after seeing performance.

Recovery may repair **data provenance/coverage only**. It may not change the position, venues, direction, notional, holding window, funding accounting, costs, collateral, stress rules, or evaluation gates in `manifests/cross-venue-funding-v1.json`.

## Primary live sources

### Hyperliquid

- `POST https://api.hyperliquid.xyz/info` with `type: metaAndAssetCtxs` for BTC mark/oracle context.
- `POST https://api.hyperliquid.xyz/info` with `type: fundingHistory`, BTC, for settled funding events.

### Binance USD-M

- `GET /fapi/v1/premiumIndex?symbol=BTCUSDT` for mark/index context.
- `GET /fapi/v1/fundingRate` for official settled funding events and event mark prices.

Every primary raw response used by the scientific result must be preserved or independently recoverable and SHA-256 identified.

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
6. the recovered value is not selected by comparing which candidate value produces better Trial 7 P&L.

If the official archive cannot supply the required context under those rules, the missing observation remains missing and the scientific data gate may fail.

## Hyperliquid funding recovery

Settled funding rates may be re-fetched from the official `fundingHistory` API because they are historical event records. Recovery must preserve the raw API response and SHA-256. Duplicate observations with the same timestamp must agree exactly within the evaluator's frozen numeric tolerance; conflicting duplicates abort evaluation rather than being averaged.

The funding event itself does not contain the oracle price required by Hyperliquid's funding-cashflow formula. The funding event therefore remains unusable unless an official live/archive asset context supplies the oracle under the frozen timestamp rule.

## Allowed Binance fallback

Binance funding events may be re-fetched only from the official USD-M `fundingRate` history endpoint. The evaluator uses the event's own `fundingTime`, `fundingRate`, and `markPrice`. It does not reconstruct funding notional from a candle.

Entry/exit Binance mark/index context may be recovered only from an official Binance market-data source whose exact timestamp/source can satisfy the manifest's entry/exit tolerance. If the official premium-index snapshot was not recorded and no first-party historical source can establish the required mark/index context within tolerance, the scientific gate fails rather than substituting a third-party price.

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

## Recovery report requirement

Any final Trial 7 evidence bundle must state separately:

- primary live-record observations used;
- official Hyperliquid archive observations used;
- official funding-history observations re-fetched;
- official Binance historical contexts used;
- unrecovered gaps;
- source object/API hashes;
- timestamp match distances;
- whether the original 98% live-recorder coverage gate passed **before** fallback.

Fallback can establish economic/provenance completeness where explicitly allowed, but it does **not** rewrite the manifest's live-recorder coverage statistic. A result that misses the frozen primary coverage requirement remains a data-gate failure unless a later, separately frozen trial defines a different acquisition standard.
