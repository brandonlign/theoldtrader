# Trial 2U observed result

Observed once in GitHub Actions run `32377064044` from frozen head `0561478bbb2cb7a8ee7e729e2c468b9a439ec7ea`.

Classification: **positive historical/source-replication evidence only**. This is not pristine forward validation and does not authorize live trading.

## Source integrity

The source-union input contained all 5,295 frozen 8-hour boundaries from 2021-05-01 through 2026-03-01. The synchronized CSV SHA-256 is `51ec7656a9d80d6aed342c8097e7e40805d1b36e2366e2df5a065ae8dc3e76b2`.

A separate pre-economic audit established that 5,238 monthly/daily mark rows overlapped with **zero mismatches**. Monthly supplied 33 rows absent from daily; daily supplied 24 rows absent from monthly; the union had zero missing boundaries.

The immutable Actions evidence artifact is `funding-carry-v1U-source-union-evidence`, artifact ID `9409504052`, ZIP SHA-256 `1c39e8740ef27e366dcb8ac50da5aa8cc0a4d139a11e6d22922073f7d674b573`.

## Frozen economics result

Starting equity: $10,000.

- Funding carry net return: **+5.5388%**
- Funding carry annualized return: **+1.1213%**
- End equity: **$10,553.88**
- Sharpe: **6.22**
- Sortino: **3.58**
- Max drawdown: **-0.234%**
- Total modeled fees: **$38.18**
- BTC spot 15% buy-and-hold comparator: **+1.6326%** total / **+0.3355% annualized**
- Cash comparator: **0%**

P&L decomposition:

- Funding P&L: **+$597.60**
- Spot leg after fees: **+$163.26**
- Perpetual leg after fees: **-$206.98**
- Combined price-hedge P&L after fees: **-$43.71**

The intended economic mechanism therefore appeared in the historical replication: positive funding income exceeded basis/hedge losses and fees.

## Margin / robustness limitation

There was **no historical margin breach** in the realized path. Minimum futures-equity / maintenance ratio was 5.02x and minimum margin excess was $651.55.

However, the frozen gap-stress results are materially weaker:

- +25% perpetual-mark gap: **BREACH**; minimum excess margin -$200.28
- +50% perpetual-mark gap: **BREACH**; minimum excess margin -$1,052.11
- +100% perpetual-mark gap: **BREACH**; minimum excess margin -$2,755.78

Therefore Trial 2U is not a deployable flagship as frozen. Any successor that changes collateral, position size, leverage, venue, thresholds, or execution assumptions requires a new trial number and cannot overwrite this result.

## Interpretation

Trial 2U supports the broader BTC funding-carry mechanism under checksum-verified first-party historical data and unchanged Trial 2 economics. It does **not** establish forward profitability, executable U.S. venue access, or sufficient tail-risk protection. The appropriate next work is a separately frozen successor with safer capitalization and/or a cleaner accessible forward venue, plus independent execution-cost evidence.