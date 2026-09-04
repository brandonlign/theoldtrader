# Trial 4 shared-universe integrity no-go

Experiment: `ctrend-v1` / Trial 4  
Status: **NON-PROMOTABLE UNDER CURRENT SPECIFICATION**  
Final holdout accessed: **no**

Trial 4 was prospectively frozen before its shared 2022-only universe existed and before Trial 4 development performance was observed. It intentionally reuses exactly Trial 3's immutable 30-member universe.

After Trial 3 development was observed, a separate integrity review established that `LUNAUSDT` in that universe is not one continuous underlying asset across the 2022 history: original Terra LUNA became Luna Classic (`LUNC`), while a distinct new Terra chain/token assumed ticker `LUNA`; Binance historical LUNA/USDT klines retain predecessor history. See `TRIAL3_POST_DEVELOPMENT_INTEGRITY_REVIEW.md`.

Because Trial 4 consumes the same `LUNAUSDT` history for cross-sectional signal ranks and model training, the shared-universe integrity exception propagates to Trial 4 regardless of Trial 4's eventual development P&L. Its frozen promotion criteria already require no data-integrity exception or survivor/universe substitution.

Therefore:

- Any Trial 4 development output produced by the already-running frozen workflow must be preserved as diagnostic evidence, whether positive or negative.
- It cannot authorize a Trial 4 final-holdout evaluation.
- The 2026-01-01 through 2026-08-01 Trial 4 final holdout remains sealed.
- The Trial 4 final workflow is fail-closed behind the deliberately absent `TRIAL4_FINAL_ACCESS_AUTHORIZED.md` marker.
- Do not remove LUNA, add EOS, change signals, or otherwise repair Trial 4 under Trial 4 after execution began.
- Any identity-clean CTREND successor requires a new project-wide alpha-trial number and must be frozen before its first development result.

This is an integrity disposition, not evidence that the CTREND family is economically good or bad. The live/paper baseline is unchanged and no real-money trading path is authorized.
