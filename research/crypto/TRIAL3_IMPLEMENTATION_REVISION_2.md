# Trial 3 implementation revision 2 — post-friction exposure caps

Date: 2026-08-18
Experiment: `cross-sectional-v1`
Scientific state when corrected: **no Trial 3 universe, development return, or final return had been observed**.

## Problem

The portfolio simulator computed 15% per-asset / 45% aggregate target notionals from pre-trade equity, then charged entry spread, slippage, and fees. Because those costs reduce marked equity immediately while the position is still marked at the unadjusted market price, the resulting post-entry exposure could be slightly above the frozen 15% / 45% caps.

This was exposed by the deterministic three-asset portfolio test before any Trial 3 performance result existed.

## Correction

The economic target and all frozen cost assumptions are unchanged. The implementation now solves for the slightly smaller pre-cost notional that produces the requested post-entry marked exposure after frozen entry friction.

For desired total post-entry exposure `W` and immediate marked entry loss fraction `c`, the simulator uses:

`W_pre = W / (1 + W*c)`

and divides that safely across the selected assets. This preserves the intended post-friction 15% single-asset and 45% aggregate caps rather than letting transaction costs mechanically push exposure over them.

## Scientific interpretation

This is a risk-accounting bug fix, not a strategy rescue:

- no predictor, ranking, universe, rebalance cadence, cost assumption, or promotion gate changed;
- it can only reduce position size relative to the buggy implementation;
- it was made before any Trial 3 economic result was observed;
- any later outcome-driven sizing change requires a new trial number.
