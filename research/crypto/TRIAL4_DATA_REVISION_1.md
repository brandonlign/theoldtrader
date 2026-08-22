# Trial 4 pre-result data revision 1

Date: 2026-08-18  
Experiment: `ctrend-v1`  
Outcome state at revision: **NO Trial 4 universe membership, post-2022 Trial 4 data, development result, or final-holdout result had been observed.**

## Problem found before acquisition

The first Trial 4 data-builder draft reused Trial 3's monthly Binance Vision archive helper. That contradicted Trial 4's frozen intention to avoid known monthly-SPOT archive integrity concerns. It also contradicted the Trial 4 manifest's stated daily/official-data provenance.

No Trial 4 data were acquired through that draft and no performance was observed.

## Authoritative Trial 4 source

Trial 4 data acquisition now uses Binance's official **market-data-only REST** endpoint:

- base: `https://data-api.binance.vision`
- endpoint: `GET /api/v3/klines`
- interval: `1d`
- symbols: exactly the immutable Trial 3 2022-only universe; no current `exchangeInfo` list is consulted
- pagination: explicit `startTime`, `endTime`, `limit=1000`
- default millisecond timestamps; every accepted daily open must be exact UTC midnight
- no interpolation or forward-fill

Every raw JSON response page is saved before normalization and recorded with its URL, byte count, row count, and SHA-256. The normalized Trial 4 dataset is separately canonicalized and SHA-256 hashed.

Binance's official Spot API documentation identifies `data-api.binance.vision` as the public market-data-only REST base and supports `/api/v3/klines` there. This source is preferable here to silently using monthly archive files after the repository already recorded evidence of monthly-SPOT discrepancies.

## Firewall remains unchanged

- Development requests are physically capped at `2026-01-01T00:00:00Z` and the builder aborts if any normalized row reaches or crosses that boundary.
- Final acquisition is a separate mode and requires `--confirm-final YES`.
- Final acquisition remains one-shot at the workflow/result level.
- The 2022-only universe rule, 28 indicators, model, costs, portfolio rules, promotion criteria, and all other Trial 4 mechanics are unchanged.

## Superseded artifact

`prepare-ctrend-data.py` is retained in Git history as the pre-result monthly-helper draft but is **not authoritative and must not be used for scientific Trial 4 evaluation**. The authoritative builder is `prepare-ctrend-rest-data.py`, and the Trial 4 development/final workflows must call only that file.
