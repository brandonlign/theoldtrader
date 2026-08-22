# Trial 4 pre-result implementation revision 1

Date: 2026-08-18  
Experiment: `ctrend-v1`  
Outcome state at revision: **NO Trial 4 universe membership, post-2022 Trial 4 data, development P&L, or final-holdout P&L had been observed.**

## Correction

The first implementation of `walkForwardCtrendPredictions` accidentally treated the elastic-net selector as a second, separately out-of-sample 52-week stacking layer on top of the 52-week first-stage Fama-MacBeth smoothing window. That would require roughly two sequential years of warm-up before a candidate prediction.

This was an engineering interpretation error, not an observed-performance response. The CTREND methodology estimates model parameters in a fixed rolling **52-week** window and then predicts the following week. The frozen Trial 4 prose likewise specified a 52-week first-stage window and a pre-embargo elastic-net training sample; it did not require a second independent 52-week OOS forecast history.

The authoritative Trial 4 evaluator therefore uses `lib/ctrend-windowed.js`:

1. collect the latest 52 eligible weekly cross-sections whose realized labels end before the one-week embargo cutoff;
2. estimate each of the 28 weekly univariate cross-sectional regressions and average its intercept/slope over those same 52 weeks;
3. apply those current smoothed first-stage models to the asset-weeks in the same training window to form the 28 generated forecast regressors;
4. fit the frozen `alpha=0.5` elastic net with AICc lambda selection using only that training window;
5. retain strictly positive forecast-selection coefficients and equally average those surviving first-stage forecasts for the next week.

The prediction week and the immediately preceding embargo week remain unavailable to all parameter estimation. No final-holdout information is involved.

## What is superseded

Only the sentence in `TRIAL4_IMPLEMENTATION_FROZEN.md` that described the second stage as using a separate 52-week history of already-available first-stage OOS forecasts is superseded. All other frozen mechanics remain unchanged: 28 signals, exact daily continuity, cross-sectional rank transform, 52-week window, `alpha=0.5`, AICc selection, positive-coefficient equal averaging, weekly schedule, 140-bps gate, long-only top-three sizing, and the 2026 holdout firewall.

The original `lib/ctrend.js` nested helper is preserved in Git history as evidence of the pre-result correction. Scientific evaluation must call `walkForwardCtrendWindowedPredictions` from `lib/ctrend-windowed.js`.
