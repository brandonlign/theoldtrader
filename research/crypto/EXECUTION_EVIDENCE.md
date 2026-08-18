# TheOldTrader crypto execution evidence review — 2026-08-12

This note motivates execution experiment `coinbase-maker-execution-v1`. It is **not** evidence that post-only orders improve TheOldTrader returns. E1 must measure fill probability and adverse selection forward before any execution policy is proposed.

## Evidence strong enough to affect E1

1. **The maker/taker fee difference is real, but the exact account fee is not assumed.** Coinbase Exchange currently publishes a $0K–$10K tier of 60 bps taker / 40 bps maker. Coinbase Advanced states that maker and taker fees differ and that the applicable fee depends on the account's current tier. E1 therefore uses 60/40 bps only as a published low-volume benchmark and requires any later deployment analysis to use the account-specific fee tier rather than silently substituting the benchmark.

2. **Post-only controls fee classification but does not guarantee execution.** Coinbase documents that a post-only limit order rests on the book and is charged maker fees if it fills; if it would execute immediately, the order is rejected. Therefore a backtest that simply substitutes maker fees for taker fees while assuming every signal fills is invalid.

3. **Queue position has economic value and changes adverse-selection risk.** Moallemi & Yuan, *A Model for Queue Position Valuation in a Limit Order Book* (2016/2017), decompose queue-position value into spread capture/adverse-selection and dynamic queue optionality, finding that queue value can be comparable to the bid-ask spread in some markets. Garriott, van Kervel & Zoican, *Queuing and Inventories in Limit Order Markets* (Journal of Financial Markets, 2025), show that queue position affects adverse-selection risk and liquidity provision. These results support modeling queue ahead explicitly rather than treating a touch order as immediately executable.

4. **Maker fills can be most likely precisely when post-fill returns are worst.** Albers, Cucuringu, Howison & Shestopaloff, *The Market Maker's Dilemma: Navigating the Fill Probability vs. Post-Fill Returns Trade-Off* (2024/2025), use a live Binance Bitcoin-perpetual experiment and document a negative relationship between maker fill likelihood and post-fill returns. This directly motivates E1's signed 1m/5m/15m/60m markouts. Saving fees is not enough if fills are systematically adversely selected.

5. **Passive-order fill probability is a state-dependent queueing problem.** Lokin & Yu, *Fill Probabilities in a Limit Order Book with State-Dependent Stochastic Order Flows* (2024), model best-quote and deeper-order fill probabilities as functions of order-book state. Arroyo, Cartea, Moreno-Pino & Zohren (2023) likewise treat passive fill time as a survival-analysis problem using time-varying LOB information. E1 deliberately begins with a lower-capacity, conservative empirical queue-consumption rule before considering a learned fill model.

6. **Coinbase provides the public fields needed for a conservative forward study.** Advanced Trade's public `level2` channel sends snapshots and absolute size updates and is documented as the easiest way to keep a synchronized book. The public `market_trades` channel includes trade price, size, time, product, and maker side. Coinbase recommends heartbeats to keep subscriptions alive and recommends distributing high-volume subscriptions across connections. E1 therefore records one independent public WebSocket per product and keeps raw feed messages.

## Frozen inference for TheOldTrader

The correct first question is not “how much would returns improve if fees were 40 bps?” It is:

> **At TheOldTrader-sized orders, how often can a post-only order at the touch actually fill within five minutes, and what is its effective cost after queue waiting and post-fill adverse selection compared with immediate taking?**

E1 uses a deliberately pessimistic queue rule: the hypothetical order joins behind all displayed quantity and **does not receive credit for cancellations ahead**. Only observed maker-side trade volume at that price can consume queue ahead, while an observed trade through the resting limit establishes that the hypothetical order should already have executed. This likely understates fill probability, but it avoids the more dangerous error of inventing fills from level-2 size reductions that cannot be uniquely attributed to cancellations ahead of our order.

If E1 fails under this rule, it remains failed. A more sophisticated queue estimator can be researched later, but it receives a new execution experiment number and must be motivated by queue-model evidence rather than designed to rescue E1.

## Sources

- Coinbase Help, *Exchange fees*; *Coinbase Advanced fees*; *Understanding the order types*.
- Coinbase Developer Platform, *Advanced Trade WebSocket Overview* and *Advanced Trade WebSocket Channels*.
- Moallemi, C. C. & Yuan, K., *A Model for Queue Position Valuation in a Limit Order Book*, Columbia Business School Research Paper / SSRN 2996221.
- Garriott, C., van Kervel, V. & Zoican, M., *Queuing and Inventories in Limit Order Markets*, Journal of Financial Markets 2025, 100982 / SSRN 3991930.
- Albers, J., Cucuringu, M., Howison, S. & Shestopaloff, A. Y., *The Market Maker's Dilemma: Navigating the Fill Probability vs. Post-Fill Returns Trade-Off*, SSRN 5074873.
- Lokin, F. & Yu, F., *Fill Probabilities in a Limit Order Book with State-Dependent Stochastic Order Flows*, arXiv:2403.02572.
- Arroyo, A., Cartea, A., Moreno-Pino, F. & Zohren, S., *Deep Attentive Survival Analysis in Limit Order Books: Estimating Fill Probabilities with Convolutional-Transformers*, arXiv:2306.05479.
