# Trial 3 implementation revision 3 — true asset-age provenance and deterministic development gzip

Date: 2026-08-20  
Experiment: `cross-sectional-v1`  
Scientific state when corrected: **no Trial 3 universe, development return, or final return had been observed**.

## Problems found during pre-result implementation audit

Two mechanical implementation defects were identified before opening any Trial 3 development performance.

First, the frozen feature `asset_age_log_days` is defined as the natural log of one plus the number of days since an asset's **first observed Binance daily bar**. The post-formation data cache intentionally begins at `2022-10-01`, because that is sufficient for the frozen 90-day price/volume lookback before the first 2023 decision. The original panel code used the first row in that truncated cache as the age origin. That made the age feature measure time since the cache boundary rather than time since the asset's first observed Binance history.

Second, the base cache builder attempted deterministic gzip output with `gzip.open(..., mtime=0)`. Python's `gzip.open` does not expose an `mtime` argument, so the development wrapper would fail before producing a scientific dataset.

Neither defect had produced a Trial 3 universe, coefficient, portfolio return, development result, or final result.

## Corrections

The frozen economic/statistical specification is unchanged.

1. Development acquisition now enumerates the official Binance Vision monthly `1d` archive prefix for each of the already-frozen 30 members, selects the lexicographically earliest monthly ZIP, verifies that ZIP against its adjacent official `.CHECKSUM`, and records the earliest valid daily-bar timestamp. The normalized dataset stores this as `firstObservedTimeBySymbol`, and the full listing/archive/checksum provenance is preserved in the source manifest.
2. `lib/cross-sectional.js` now uses that preserved first-observed timestamp for `asset_age_log_days`. Synthetic/unit-test datasets may fall back to their first in-memory candle, but scientific Trial 3 acquisition supplies the explicit map.
3. The development wrapper provides the intended deterministic gzip semantics through `gzip.GzipFile(..., mtime=0)` while executing the frozen base builder, then rewrites the augmented canonical dataset deterministically and updates its SHA-256 provenance.
4. A deterministic test now proves that two assets with identical truncated feature caches but different preserved first-observed Binance dates receive different and exactly correct raw asset-age values.

## Scientific interpretation

This is an implementation-conformance correction, not a strategy rescue:

- the feature name, formula, feature count, ridge lambda, universe rule, dates, embargo, ranking, selection count, cost gate, and position sizing are unchanged;
- the correction makes the implementation match the already-frozen definition rather than introducing a new predictor;
- the additional data are historical listing/first-bar provenance used only to calculate the already-specified age feature;
- no 2026 final-holdout row is acquired by the development path;
- no observed performance motivated the correction;
- any outcome-driven alteration after a development or final result is observed requires a new trial number.
