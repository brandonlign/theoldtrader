# Trial 16 pre-final capitalization audit

Status: **recorded before Trial 16 confirmation-window carry economics**.

Trial 16 changes one economic component relative to the observed Trial 2U source replication: the futures collateral reserve rises from 20% to 50% of $10,000 starting equity. Spot sizing, equal-BTC-unit short sizing, entry/exit rule, no-rebalancing rule, funding accounting, execution references, costs, maintenance assumption, source-union rule, and +25%/+50%/+100% adverse-perpetual-mark stresses are unchanged.

The 50% reserve is not chosen from the sealed 2026-03-01 through 2026-08-01 confirmation window. It is the smallest round 10-percentage-point reserve step above the already-observed historical Trial 2U stress requirement. Trial 2U used $2,000 collateral and reported minimum stress excess margins of:

- +25% mark gap: -$200.28
- +50% mark gap: -$1,052.11
- +100% mark gap: -$2,755.78

Raising the reserve from 20% to 50% adds exactly $3,000 of futures collateral while leaving the historical position units and stress marks unchanged. On the already-observed Trial 2U path, the corresponding arithmetic excess margins would therefore be approximately:

- +25%: +$2,799.72
- +50%: +$1,947.89
- +100%: +$244.22

This arithmetic is a capitalization check on already-observed Trial 2U evidence, not a new backtest and not evidence about Trial 16's sealed confirmation-period profitability. The confirmation interval remains 2026-03-01 through 2026-08-01 and must be acquired/evaluated exactly once under the frozen Trial 16 gate.
