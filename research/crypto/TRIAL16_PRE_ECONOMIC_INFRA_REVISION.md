# Trial 16 pre-economic infrastructure revision

The first Trial 16 workflow attempt acquired and checksum-verified all 459 frozen 8-hour source-union rows, with zero mark-source overlap mismatches and zero missing spot/perpetual/mark boundaries, but stopped **before economic evaluation** because the workflow asserted a particular ISO timestamp string formatting (`.000Z`) rather than parsing the timestamp semantically.

No Trial 16 return, funding P&L, basis P&L, Sharpe, drawdown, margin result, or gap-stress result was calculated or exposed by that attempt. The workflow verification is corrected to compare parsed UTC instants while retaining the exact frozen 2026-03-01 00:00 UTC through 2026-08-01 00:00 UTC boundary and 459-row requirement. No scientific/economic rule changes.
