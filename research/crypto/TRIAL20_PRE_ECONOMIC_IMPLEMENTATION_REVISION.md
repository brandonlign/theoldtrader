# Trial 20 pre-economic implementation revision

A synthetic, read-only preflight exposed two checkout dependencies before any real LTCUSDT or TRXUSDT derivative economics were evaluated: the Trial 20 wrapper expected `funding-carry-v1.json` and carry helper files that are not present on the Trial 20 branch inherited from `main`.

Before any Trial 20 economic result, the source acquisition code was made self-contained through `research/crypto/lib/carry_source_union.py`, and the evaluator was made self-contained while preserving the already-frozen spot/perpetual hedge accounting, funding timing, transaction costs, collateral and margin stresses.

No Trial 20 asset, sleeve weight, date, fee, slippage, spread, sizing, collateral, entry/exit rule, source requirement, stress, development gate, final promotion gate, or anti-rescue rule changed. This is an implementation-only repair of missing cross-branch dependencies found with synthetic data.
