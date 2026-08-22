# Trial 30 — proactive stress-buffer cross-venue carry

Paper/research only. No real-money trading path is authorized.

Trial 30 is an adaptive successor to Trial 29. Trial 29 passed its development return, Sharpe, drawdown, activity, and realized-maintenance gates but failed the frozen 20% unilateral-gap stress gate. Trial 30 keeps the same BTC/ETH static long-Binance / short-Hyperliquid carry, 75% sleeve notional per leg, event-time funding clock, costs, and final holdout. It replaces weekly collateral equalization with a causal pre-committed boundary rule: after realized PnL and an actual-maintenance check, collateral is equalized only if either venue lacks a 10%-of-notional reserve above 20% gap stress plus 5% maintenance. Hypothetical stress is evaluated after that proactive transfer and before the next unknown price move.

Development is explicitly adaptive/reused evidence and is not treated as independent confirmation. The 2026 final remains a one-shot untouched holdout and may be accessed only if every frozen development gate passes.
