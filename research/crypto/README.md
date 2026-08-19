# TheOldTrader crypto research

TheOldTrader's crypto research is **paper-only** and isolated from the hosted production/paper baseline. No file in this research suite authorizes real-money execution.

## Current research priority

The current flagship **strategy research candidate** is the already-frozen Trial 2 `funding-carry-v1`. The current flagship **execution experiment** is E1 `coinbase-maker-execution-v1`.

See:

- `FLAGSHIP_CARRY.md` for the carry evidence ladder and anti-rescue rules;
- `STATUS.md` for the current handoff;
- `TRIAL_LEDGER.md` for all serious candidate attempts, including failures;
- `LITERATURE.md` for the evidence review.

The flagship label does not mean Trial 2 has passed. Its primary checksum-archive result remains unobserved. Frozen crypto v2 remains the paper baseline until a candidate clears its preregistered evidence and a separate promotion decision exists.

## Flagship carry audit

After the immutable primary Trial 2 summary exists, run:

```bash
npm run research:carry:flagship -- research/crypto/results/funding-carry-v1/summary.json
```

The audit is intentionally unable to promote the strategy. It can only reject the frozen historical candidate or label it `PROMISING_HISTORICAL_ONLY`; untouched forward or independently sealed validation remains mandatory.

## E1 execution recorder

Engineering pilot:

```bash
npm run research:e1:pilot
```

Scientific recorder:

```bash
npm run research:e1:scientific
```

Aggregate evaluation after a complete run:

```bash
npm run research:e1:evaluate -- research/crypto/data-cache/<run-id>/run-manifest.json
```

E1 is execution evidence only. It cannot be used to retroactively lower the transaction-cost assumptions of prior alpha/carry trials.

## Scientific rules

- Every serious strategy candidate is frozen before its first evaluation and recorded in `TRIAL_LEDGER.md`.
- Failed candidates stay visible and may not be rescued under the same trial number.
- Replications of an identical specification are labeled separately and cannot replace the primary experiment.
- Holdouts/final windows are not used to tune a strategy after observation.
- Data provenance, missing-data behavior, transaction costs, turnover, margin risk, and execution assumptions are part of the experiment rather than cleanup performed after P&L is known.
- Research results do not modify the live/paper baseline automatically.

The older detailed trial-specific documents and workflows remain authoritative for their frozen specifications; this README is an orientation layer, not a replacement for those manifests.
