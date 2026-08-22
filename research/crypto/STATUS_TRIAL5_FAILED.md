# Trial 5 (`tsmom-v1`) development result — FAILED

Date observed: 2026-08-18
Evaluator: `node research/crypto/tsmom-evaluate.js development`
Scientific status: **development gate failed; no parameter rescue permitted under Trial 5**.

## Observed result

The user executed the frozen Trial 5 development evaluator against official Coinbase daily-candle acquisition. The evaluator wrote `research/crypto/results/tsmom-v1/development-summary.json` locally and reported:

`Trial 5 development gate: FAIL`

The exact generated summary artifact has not yet been committed to the repository, so this status record deliberately does not reconstruct or invent its component metrics.

## Consequence

Trial 5 is a failed serious alpha/portfolio trial. Its frozen 30/90/180-day momentum horizons, monthly cadence, 60-day volatility scaler, 50% annualized volatility target, BTC/ETH/SOL asset set, 15%/45% caps, and 140-bps round-trip cost model may not be changed and rerun under `tsmom-v1`.

The pre-freeze 2026 diagnostic and prospective final are not opened for promotion because the development gate failed. A materially changed momentum candidate would require a new trial number, but the research program should prefer a genuinely different economic hypothesis rather than parameter rescue.

## Evidence handling

The locally generated `development-summary.json` remains the authoritative detailed result bundle and should be committed unchanged when available. This file records only the already-observed gate outcome so the failed trial cannot disappear from the research history.
