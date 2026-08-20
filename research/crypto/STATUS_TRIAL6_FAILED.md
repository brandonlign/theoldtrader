# Trial 6 status — failed development

Date observed: 2026-08-18
Experiment: `lowvol-v1`
Trial: 6

## Frozen result

The first frozen development evaluation was executed on the user's local checkout after the Trial 6 implementation tests were corrected to measure the actual frozen entry-time exposure constraint rather than end-of-day exposure after price movement.

The evaluator completed and reported:

```text
Loading official Coinbase daily candles for Trial 6 development...
Wrote development evidence to research/crypto/results/lowvol-v1/development-summary.json
Trial 6 development gate: FAIL
```

This is a failed strategy trial. The 90-day formation window, monthly cadence, BTC/ETH/SOL universe, one-asset selection rule, 15% post-friction exposure target, cost model, comparators, and development criteria are now locked as failed. They may not be altered and rerun under `lowvol-v1`.

The exact generated JSON development summary is local until committed from the machine that executed the Coinbase evaluation. The quoted gate result above is sufficient to lock the trial status; no performance metric is invented or inferred here.

## Consequence

Do not rescue Trial 6 by changing the volatility window, adding momentum, expanding the asset universe, changing the rebalance cadence, or reducing modeled transaction costs. Any new alpha hypothesis must receive a new trial number before observation.

Because Trials 5 and 6 are two distinct low-turnover Coinbase spot families that both failed under the same conservative retail friction model, the next research priority is execution experiment E1 (`coinbase-maker-execution-v1`), not another immediate spot-price transform. E1 must determine whether realistically executable passive orders can materially reduce implementation cost after fill probability, queue competition, and adverse selection. A new Trial 7 should not be frozen until E1 either produces usable cost evidence or itself fails under its frozen forward protocol.
