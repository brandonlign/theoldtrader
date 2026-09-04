# Trial 3 post-development integrity review

Status: **INTEGRITY NO-GO FOR PROMOTION — FINAL HOLDOUT REMAINS SEALED**  
Experiment: `cross-sectional-v1` / Trial 3  
Shared downstream experiment: `ctrend-v1` / Trial 4  
Development result already observed: **yes**  
2026 final-holdout rows acquired: **no**

## Conclusion

Trial 3's frozen 2024–2025 development result remains preserved exactly as observed (+83.74% net, 1.23 Sharpe under the preregistered 140-bps round-trip friction), but Trial 3 is **not eligible for promotion or final-holdout access** because a post-development audit found a genuine data-identity integrity exception in the immutable universe: `LUNAUSDT` spans two economically distinct underlying assets during the 2022 formation window.

The frozen promotion criteria already require **no data-integrity exception**. This is therefore not a new threshold invented after seeing a good result; it is application of the preregistered rule. Opening the one-shot 2026 final holdout cannot repair a criterion that has already failed, so the correct action is to leave that holdout sealed and preserve the development result as scientifically informative but non-promotable evidence.

Trial 4 reuses exactly the same universe and symbol history, so its final holdout is also blocked. Any Trial 4 development result produced by the already-running frozen workflow is retained as a diagnostic result, not promotion evidence.

No Trial 3 or Trial 4 economic/statistical rule is changed in place. A scientifically repaired version requires a new numbered alpha trial.

## Finding A — `LUNAUSDT` is not one stable underlying asset across 2022

The immutable 2022-only Trial 3 universe contains `LUNAUSDT` as member 21. Its formation record reports 348 valid 2022 daily bars spanning 2022-01-01 through 2022-12-31.

That symbol changes underlying identity during the formation year:

1. Terra's official exchange-migration documentation states that the original Terra chain became Terra Classic, original Luna became Luna Classic (`LUNC`), and a **new chain** assumed the Terra name with a **new Luna (`LUNA`)** asset: https://docs.terra.money/migration/exchange-migration/
2. Binance TR's 2022-05-31 notice likewise explains that the original LUNA was renamed LUNC and that the new Terra 2.0 LUNA was a different listing: https://www.binance.tr/tr/blog/duyurular/72bb2d8ded7144c1b81aacd770d1efa5
3. Binance's later historical-chart update explicitly says LUNA/USDT chart history before 2022-05-31 contains Terra Classic (LUNC) historical trading data and that, while those old rows would be removed from `uiKlines`, `GET /api/v3/klines` would continue to return all related Kline data. A preserved copy of the 2024-01-30 Binance announcement is available at: https://www.coincarp.com/zh/exchange/announcement/binance-8d1fe8552fa24726b27caf640cbcefbb/

Therefore treating all 2022 `LUNAUSDT` rows as one economic asset concatenates old-LUNA/LUNC history with new-LUNA history. This affects the scientific inputs even though LUNA was not selected by the observed development portfolio:

- 2022 formation liquidity and therefore the top-30 membership boundary;
- the `asset_age_log_days` feature, because new LUNA inherits old LUNA's first-observation date;
- pooled Trial 3 training rows and contemporaneous cross-sectional transforms;
- Trial 4's shared universe and daily signal panel.

The next eligible row in the already-frozen 2022 liquidity ranking is `EOSUSDT`, so a general identity-stability rule would change membership rather than merely relabeling metadata. That is a material candidate change and cannot be made under Trial 3 after development observation.

## Finding B — exact development continuity audit passed

Static review identified a second possible issue: Trial 3 requires exact prior daily continuity for features, but target construction uses monthly endpoint opens and does not itself explicitly test every intervening daily bar. An asset with an interior gap could therefore theoretically contribute a label spanning an untradeable interval.

This concern was tested against an **exact byte-for-byte reproduction** of the already-observed development dataset without acquiring any 2026 row. GitHub Actions run `32405162429` produced artifact `cross-sectional-v1-development-integrity-audit-1` (artifact `9420012953`, SHA-256 `345fda5439f7e5006c718c43a5716cb08fa1b334a7e4ebc7068825c2f947c78b`). The reacquired canonical dataset SHA-256 exactly matched the observed provenance:

`70fef58f47c63f8d6dc45c7c3c439531cfac317851168a2ef2e736b500c1d00d`

Results:

- 1,036 panel rows;
- 1,006 labeled target rows;
- **0** target rows bridge an interior daily-data gap;
- **0** actually selected holding intervals contain an interior daily-data gap;
- eligible cross-section size was 27–30 assets across 36 decision dates;
- January 2026-or-later rows acquired: **0**.

The exact audit result is preserved at `research/crypto/results/cross-sectional-v1-development/integrity-audit-1.json`.

So the continuity concern is cleared for the observed development dataset. It does **not** clear the separate LUNA underlying-identity defect.

## Additional robustness characterization preserved

The same audit confirms the strong result is not literally a single selected asset:

- BTC selected in 21 development months;
- ETH in 20;
- BNB and XRP in 7 each;
- SOL in 6;
- five additional assets appear at least once.

XRP is nevertheless the largest contributor. It represents 42.47% of positive realized profit and 45.85% of positive total marked contribution. A purely arithmetic attribution that subtracts XRP's observed contribution while leaving all other realized/marked contributions fixed still leaves about +44.94% net return. That arithmetic is **not** a counterfactual re-simulation and must not be presented as one.

## Final-holdout firewall

Trial 3 and Trial 4 final access are now fail-closed:

- Trial 3 final workflow requires the deliberately absent `research/crypto/TRIAL3_FINAL_ACCESS_AUTHORIZED.md` marker before any final acquisition step.
- Trial 4 final workflow requires the deliberately absent `research/crypto/TRIAL4_FINAL_ACCESS_AUTHORIZED.md` marker before any final acquisition step.
- Trial 3 final data acquisition additionally requires `--confirm-final YES` before reading its manifest or initiating network acquisition.

No authorization marker should be created for Trial 3 or Trial 4 under the current frozen specifications because the shared-universe integrity exception already violates a required promotion criterion.

## Required next scientific action

Freeze a new numbered identity-clean successor **before observing its development result**. The successor may inherit Trial 3 mechanics unchanged, but its universe-formation specification must explicitly require one stable underlying asset identity throughout the formation/history interval and must reject ticker reuse across economically distinct assets. That repair must be defined generically, not as an outcome-based one-off deletion of LUNA.

The successor can use only development data first. The untouched January–July 2026 holdout remains available for a later one-shot evaluation only if the repaired candidate earns it under prospectively frozen rules.

The live/paper baseline remains unchanged and no real-money trading path is authorized.
