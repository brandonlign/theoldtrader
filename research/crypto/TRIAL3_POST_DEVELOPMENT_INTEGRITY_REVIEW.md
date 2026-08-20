# Trial 3 post-development integrity review

Status: **FINAL HOLDOUT BLOCKED — integrity review in progress**  
Experiment: `cross-sectional-v1` / Trial 3  
Shared downstream experiment: `ctrend-v1` / Trial 4  
Development result already observed: **yes**  
2026 final-holdout rows acquired: **no**

## Why this review exists

Trial 3 produced a strong frozen development result before this review: +83.74% net return over 2024–2025 with 1.23 Sharpe under the preregistered 140-bps round-trip friction. A strong result increases rather than decreases the need to look for implementation, provenance, identity, and survivorship defects before opening the one-shot final holdout.

This document does **not** authorize any change to Trial 3 economics, features, universe membership, dates, ridge lambda, costs, or promotion criteria. Trial 3 has already been observed on development data. Any material repair to the scientific candidate after this point requires a new numbered trial rather than an in-place rescue.

## Finding A — `LUNAUSDT` has a material asset-identity ambiguity

The immutable 2022-only Trial 3 universe contains `LUNAUSDT` as member 21. Its formation record reports 348 valid 2022 daily bars spanning 2022-01-01 through 2022-12-31.

That symbol is not a stable asset identity across 2022:

1. Terra's official exchange-migration documentation states that the original Terra chain became Terra Classic, original Luna became Luna Classic (`LUNC`), and a **new chain** assumed the Terra name with a **new Luna (`LUNA`)** asset: https://docs.terra.money/migration/exchange-migration/
2. Binance TR's 2022-05-31 notice likewise explains that the original LUNA was renamed LUNC and that the new Terra 2.0 LUNA was a different listing: https://www.binance.tr/tr/blog/duyurular/72bb2d8ded7144c1b81aacd770d1efa5
3. Binance's later historical-chart update explicitly says LUNA/USDT chart history before 2022-05-31 contains Terra Classic (LUNC) historical trading data and that, while those old rows would be removed from `uiKlines`, `GET /api/v3/klines` would continue to return all related Kline data. A preserved copy of the 2024-01-30 Binance announcement is available at: https://www.coincarp.com/zh/exchange/announcement/binance-8d1fe8552fa24726b27caf640cbcefbb/

Therefore treating all 2022 `LUNAUSDT` rows as one economic asset can concatenate old-LUNA/LUNC history with new-LUNA history. That can affect at least:

- 2022 formation liquidity and therefore the top-30 membership boundary;
- the frozen `asset_age_log_days` feature, because new LUNA can inherit old LUNA's first-observation date;
- pooled Trial 3 training rows and contemporaneous cross-sectional transforms even if LUNA itself was never selected for a development portfolio;
- Trial 4, because it reuses exactly the same immutable universe and daily symbol history.

This issue was discovered **after** Trial 3 development performance was observed. It therefore must not be silently repaired inside Trial 3.

## Finding B — training-label continuity needs an exact-data audit

Trial 3 feature construction correctly requires exact prior daily continuity for its 90-day feature history. However, the target is computed from the current monthly open to the next monthly open when both endpoint bars exist. Static review shows the target builder does not itself require every intervening daily bar to exist.

That creates a possible mismatch: an asset with an interior data gap could contribute a training label spanning an untradeable interval, while the portfolio simulator would force-exit an already-held asset at the first missing daily bar.

No conclusion is made from code inspection alone. The repository now contains a post-development audit that reacquires **development-only** data and requires the canonical dataset SHA-256 to match the already-observed development provenance exactly before scanning every labeled interval and every actually selected holding interval for gaps:

- `research/crypto/audit-cross-sectional-development-integrity.js`
- `.github/workflows/audit-trial3-development-integrity.yml`

The audit is descriptive only. It has read-only repository permission, cannot access 2026 rows, cannot modify the candidate, and cannot promote Trial 3.

## Final-holdout firewall strengthened

While this review is unresolved:

- Trial 3 final workflow requires the deliberately absent `research/crypto/TRIAL3_FINAL_ACCESS_AUTHORIZED.md` marker before any final acquisition step.
- Trial 4 final workflow requires the deliberately absent `research/crypto/TRIAL4_FINAL_ACCESS_AUTHORIZED.md` marker before any final acquisition step.
- Trial 3 final data acquisition itself additionally requires an explicit `--confirm-final YES` token before it reads the manifest or can begin network acquisition.

These markers must **not** be created merely because the development result is attractive. They may be created only after the integrity disposition is documented and scientifically defensible.

## Required disposition before any final access

1. Complete the exact-dataset continuity audit and preserve its result.
2. Determine whether the LUNA identity discontinuity is scientifically material to Trial 3 and/or Trial 4, without opening the 2026 holdout.
3. If a material repair is required, freeze it prospectively as a **new alpha-trial identity** and evaluate development before considering its untouched final holdout. Do not mutate Trial 3 or Trial 4 after observation.
4. If Trial 3 or Trial 4 is judged invalid for final evaluation, record that status explicitly rather than deleting the strong development result.
5. Only after the disposition is frozen should a corresponding final-access authorization marker be authored.

The live/paper baseline remains unchanged and no real-money trading path is authorized.
