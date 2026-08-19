# TheOldTrader flagship strategy research — carry

Status: **research flagship candidate, not promoted**  
Strategy: `funding-carry-v1` (Trial 2)  
Paper-only: **yes**  
Live promotion authorized: **no**

## Decision

The current flagship research candidate is the already-frozen, delta-neutral BTC spot/perpetual carry strategy in Trial 2. This is a prioritization decision, not a strategy revision and not evidence that Trial 2 is profitable.

Trials 5 and 6 tested two distinct low-turnover Coinbase spot families and failed their frozen development gates under TheOldTrader's conservative retail-cost model. Trial 2 is economically and statistically different: its intended return source is realized perpetual funding plus basis convergence while holding equal BTC units long spot and short perpetual, rather than forecasting the direction of BTC, ETH, or SOL.

The Trial 2 economic specification remains exactly frozen. This document does not change its dates, position size, collateral, execution-price references, funding timing, costs, margin assumptions, or no-rebalancing rule.

## Why carry leads the flagship search

1. **Different return source.** It does not rescue the failed candle-directional families with another price transform.
2. **Low turnover.** Trial 2 enters once and exits once over the frozen robustness window, so implementation friction is structurally less dominant than it is for frequently rebalanced alpha.
3. **Market-neutral intent.** Equal BTC units offset first-order BTC direction while leaving funding, basis, execution, and margin risk observable rather than hidden.
4. **Literature-scale economics.** Recent peer-reviewed crypto-carry evidence reports economically large average carry, making this family worth testing under TheOldTrader's deliberately harsher retail assumptions rather than assuming the published result transfers.
5. **Already preregistered.** Trial 2 was frozen before its primary checksum-archive result, so pursuing it does not spend another alpha-trial number or introduce outcome-driven tuning.

## What is explicitly *not* the flagship right now

The 2026 quarter-hour/order-imbalance literature is scientifically interesting and the E1 Coinbase recorder is capable of collecting the required trade/L2 inputs. However, the reported predictive components are measured in basis points over multi-hour horizons and the paper's directly traded opening-return effect is substantially smaller still. Under TheOldTrader's current retail friction, that is not enough economic margin to justify freezing a new Trial 7 before execution evidence exists.

Therefore:

- no Trial 7 is created here;
- no quarter-hour signal is tuned or backtested opportunistically;
- E1 remains an execution experiment, not alpha evidence;
- microstructure alpha stays a later hypothesis that can be frozen prospectively only if execution evidence makes its economics credible.

## Flagship evidence ladder

The carry strategy is not allowed to jump from a historical result to promotion. Evidence must accumulate in this order:

### A. Canonical primary Trial 2

Run the already-frozen checksum-archive workflow exactly once when infrastructure permits. It must reproduce the exact 5,295-boundary protocol, official checksums, exact timestamp synchronization, equal-BTC hedge, frozen costs, and margin rules.

A positive result is **historical robustness evidence only** because aggregate funding information was known before the original window was frozen.

### B. Non-rescue flagship audit

Run `carry-flagship-audit.js` on the immutable Trial 2 summary. The audit may classify historical evidence but may not change the strategy.

The audit requires only result-agnostic properties that were already part of the scientific intent:

- exact synchronized-grid integrity;
- no historical maintenance-margin breach;
- positive net-of-cost return versus cash;
- survival of every already-frozen +25%/+50%/+100% mark-gap stress;
- complete funding/price-hedge/fee decomposition.

The audit never outputs `PROMOTED`. Its strongest possible label is `PROMISING_HISTORICAL_ONLY`.

### C. Canonical 2R reproduction

Reproduce the already-observed official-REST exact-family replication from its frozen inputs. 2R remains non-promotion evidence regardless of its result. Any disagreement between canonical reproduction and the preserved originating result is an implementation/provenance investigation, not permission to retune.

### D. Untouched validation

Before any promotion proposal, the unchanged strategy must pass a later untouched forward or independently sealed evaluation. The validation window and data rules must be committed before its result is viewed. No result from A–C can choose the forward window, funding threshold, sign filter, leverage, collateral, or entry timing.

### E. Execution evidence stays separate

E1 can measure realistic maker/taker implementation costs, but it may not retroactively rewrite Trial 2 or prior alpha-trial costs. Any future carry successor that uses a different execution policy must be frozen prospectively under a new strategy/implementation specification.

## Failure rules

The flagship label is revoked for the frozen Trial 2 candidate if the canonical primary result has any of the following:

- broken synchronized-data integrity;
- historical maintenance-margin breach;
- non-positive net return after the frozen costs;
- failure of any already-frozen gap-stress scenario.

A failure does not authorize a funding-sign filter, better entry date, more collateral, different leverage, lower fee assumption, or selective subperiod. Those would be a new candidate and must receive a new trial/specification before evaluation.

## Current bottleneck

The strategy is scientifically ready to be evaluated; infrastructure is not. The primary carry workflow exists but GitHub Actions has been blocked before checkout by the account billing/spending-limit condition. Until that is resolved or an equivalent provenance-preserving execution environment is available, the correct state is **flagship candidate / primary result unobserved**.

## Validation state

The result-agnostic audit logic was added with deterministic tests for success-without-promotion, historical margin breach, frozen gap-stress failure, non-positive net return versus cash, broken synchronized-grid provenance, and attempted live-promotion input. The repository build path reported 104/104 tests passing and a successful Next.js compile after the audit/test additions.

## Next code step

When primary Trial 2 can be executed, its immutable `summary.json` is the direct input to `carry-flagship-audit.js`. No additional parameter-selection phase is permitted between the primary result and that audit. If the audit rejects, the frozen Trial 2 flagship candidate is closed. If it returns `PROMISING_HISTORICAL_ONLY`, the next strategy work is to freeze an unchanged untouched validation protocol before viewing that validation result.
