# MoneyMog crypto research status — 2026-08-12

Authoritative research branch: `research/crypto-oos-v1`  
Draft PR: `#8`  
Live/paper v2 execution code modified by this branch: **no**  
Real-money trading enabled: **no**

## Frozen live baseline

MoneyMog crypto v2 remains the frozen paper baseline. Research code may import its signal/risk functions read-only for historical comparison, but this branch does not modify the execution path.

## Trial 1 — `crypto-oos-v1`

**Family:** pooled 24-hour ridge expected-return forecast with an explicit cost gate.  
**Primary data:** Coinbase BTC-USD / ETH-USD / SOL-USD 15-minute candles.  
**Final holdout:** 2026-03-01 through 2026-08-01.  
**Status:** FROZEN; PRIMARY HOLDOUT UNTOUCHED.

The primary evaluator includes expanding walk-forward training, a 24-hour embargo, realistic fees/slippage/spread, exact frozen-v2 comparison, trend/buy-hold/cash controls, regime analysis, stability diagnostics, and reproducible reports/plots. A first-entry performance-accounting bug discovered in the auxiliary replication was corrected in the primary pipeline **before any primary result was observed**.

### Holdout firewall and infrastructure blocker

GitHub Actions currently refuses to start jobs before checkout because the account reports failed payments / insufficient Actions spending limit. This is infrastructure, not a model result; `results/crypto-oos-v1/BLOCKED.md` preserves the original blocker.

The research workflow was hardened after this was discovered: ordinary pushes now run **validation only**. The final Coinbase evaluation is a separate `workflow_dispatch`-only job and refuses to run if a prior `summary.json` exists. The latest ordinary push confirmed the firewall: `validate` failed before checkout because of billing while `evaluate-primary-coinbase-holdout` was **skipped**. Therefore restoration of Actions compute cannot accidentally open the frozen holdout on an unrelated push.

## Trial 1R — `binance-btc-replication-v1`

**Purpose:** exact-family BTC-only cross-venue robustness diagnostic; not promotion eligible and not a substitute for the Coinbase holdout.  
**Data:** BTCUSDT 15-minute Binance spot history, exact source SHA-256 preserved.  
**Holdout:** 2024-05-01 through 2024-11-01.  
**Status:** EVALUATED; FAILED ROBUSTNESS DIAGNOSTIC.

Corrected holdout summary:

| Strategy | Net return | Sharpe | Closed trades | Modeled fees |
|---|---:|---:|---:|---:|
| ridge24 cost gate | 0.00% | 0.00 | 0 | $0.00 |
| frozen MoneyMog v2 | -2.09% | -4.14 | 14 | $190.46 |
| 30-day trend | -3.30% | -1.45 | 9 | $156.29 |
| BTC buy-and-hold at 15% exposure | +2.84% | +0.82 | 1 | $19.83 |
| cash | 0.00% | 0.00 | 0 | $0.00 |

Ridge24 had 0 positive-return development folds out of 11. In the holdout, forecast/realized-return correlation was -0.119 and the maximum 24-hour forecast was 1.258%, below the frozen ~1.40% round-trip hurdle. **Do not lower the hurdle, alter lambda/features/horizon, or otherwise rescue trial 1 after observing this.**

The auxiliary evaluator initially anchored returns to the first post-entry snapshot and therefore omitted first-entry friction for strategies that entered immediately. That reporting calculation was corrected to anchor to the fixed $10,000 starting capital; no signals, fills or trades changed. Git history and the result report preserve the correction.

## Trial 2 — `funding-carry-v1`

**Family:** market-neutral BTC spot / BTCUSDT perpetual funding-and-basis carry.  
**Status:** FROZEN DATA ACQUISITION PENDING; NO CARRY P&L OBSERVED.

Frozen design:

- long BTC spot / short equal BTC units of USD-M perpetual;
- 15% spot notional, 20% account reserve as futures collateral;
- no funding threshold, sign filter, leverage tuning, rebalancing, or entry-date selection;
- same conservative MoneyMog friction on both legs;
- actual basis P&L, funding cash flows, margin accounting, and +25%/+50%/+100% gap stress;
- historical robustness window fixed to 2021-05-01 through 2026-03-01;
- the funding payment coincident with entry is not earned;
- historical result is robustness/development evidence only because whole-sample funding summary statistics were visible before the manifest was fully frozen;
- any promotion would require a later untouched forward or independently sealed evaluation.

Data provenance is deliberately strict. Because open Binance public-data issue #475 reports cases where monthly SPOT archives differ from daily/API history, MoneyMog freezes checksum-verified **daily** BTCUSDT 8-hour spot archives, monthly USD-M 8-hour mark-price archives, and monthly funding-rate archives. `prepare-carry-data.py` verifies every official `.CHECKSUM`, uses only exact kline opens at funding timestamps, forbids interpolation, and rejects incomplete/non-8-hour funding grids. `carry-evaluate.js` independently marks both legs and never credits the first funding payment. The carry workflow is manual-dispatch only and refuses to overwrite an observed result.

## Execution experiment E1 — `coinbase-maker-execution-v1`

**Question:** Can post-only maker execution materially lower MoneyMog's effective implementation cost after realistic non-fills, queue competition, depth and adverse selection?  
**Status:** FROZEN FORWARD-DATA PROTOCOL; NO LIVE RECORDING RESULT OBSERVED.

The current 60 bps/side taker assumption matches Coinbase Exchange's lowest published taker tier; the corresponding published maker benchmark is 40 bps/side. This does **not** justify replacing v2's costs with maker fees. E1 is designed to measure whether MoneyMog-sized post-only orders can actually earn maker treatment often enough to matter.

Frozen E1 design:

- public Coinbase Advanced Trade `level2`, `market_trades`, and `heartbeats` only; no account/order credentials and no real orders;
- BTC-USD, ETH-USD and SOL-USD recorded on **three independent public WebSocket connections/files**;
- hypothetical BUY orders join best bid and SELL orders join best ask every 15 minutes;
- $500 and $1,500 hypothetical sizes; five-minute TTL;
- conservative back-of-queue fill rule: observed same-price maker-side trade volume must consume displayed queue ahead plus the hypothetical order; queue-ahead cancellations are **not** credited;
- trade-through can establish a fill because observed executions crossed the resting limit;
- 1m/5m/15m/60m signed midpoint markouts measure post-fill adverse selection;
- one-hour recordings are engineering tests only; each product needs at least 168 hours, >=98% connected-time coverage, no disconnect over five minutes, zero parse errors, zero forward `level2` sequence gaps and zero forward `market_trades` sequence gaps;
- initial connection delay counts against coverage;
- reconnect-spanning hypothetical orders become `DATA_GAP`; no new order is placed until a fresh level2 snapshot rebuilds that product book;
- raw gzip files and companion SHA-256 values are preserved independently by product.

Execution analysis is deliberately redundant:

1. `analyze-coinbase-maker-execution.mjs` reconstructs books and simulates the frozen maker orders using the conservative queue rule.
2. `audit-coinbase-execution-integrity.mjs` independently re-reads the immutable raw feed, verifies the compressed-file SHA-256, recomputes coverage and both channel sequence streams, matches every eligible placement back to the raw book, and prices the **same base quantity** as an immediate taker against the full opposite-side book. If recorded depth is insufficient, the taker comparator is unavailable rather than imputed.
3. `validate-coinbase-maker-window.mjs` refuses the final scientific report unless all three unique products have verified hashes, a scientific maker window, and a passing independent integrity audit with matching raw hashes. It then combines fill rates, markouts and the full-book taker comparator, and refuses to overwrite an existing E1 scientific result.

`tests/crypto-maker-execution.test.js` covers conservative queue consumption and level2 gap invalidation. `tests/crypto-execution-integrity.test.js` separately covers multi-level taker VWAP and deliberate `market_trades` sequence loss. Materially changing placement price, TTL, queue model, cancellation treatment, order sizes or maker/taker switching requires a new execution experiment number.

## Research conclusion so far

The evidence does **not** support promoting a more complex directional ML model. The only completed OOS robustness test found weak/negative 24-hour forecast information and severe cost sensitivity in v2/trend trading. The highest-value unresolved questions are therefore different economic return sources such as carry and the actual achievable execution cost after queue/non-fill/adverse-selection effects—not a post-hoc Transformer/XGBoost rescue on the same candle features.

This is not a claim that carry or maker execution will work. Trial 2 must still survive both-leg costs, basis movements, funding and margin stress; E1 must still survive low fill probability and adverse selection.
