# TheOldTrader Crypto Research Evidence Review — 2026-08-19

This note records the evidence used to choose TheOldTrader research directions. It is not a claim that any cited strategy is profitable for TheOldTrader. The live paper trader remains unchanged. Published/working-paper results are treated as hypotheses to replicate under TheOldTrader's own costs and data, not as transferable alpha.

## Current flagship decision

TheOldTrader now has two complementary flagship **strategy-research** tracks plus one execution track:

1. **Trial 2 `funding-carry-v1` — historical carry flagship.** Already frozen spot/perpetual carry; primary checksum-archive result unobserved.
2. **Trial 7 `cross-venue-funding-v1` — forward carry challenger.** Static BTC long Binance USD-M perpetual / short Hyperliquid perpetual; frozen before any TheOldTrader cross-venue result; prospective window begins 2026-08-20T00:00Z.
3. **E1 `coinbase-maker-execution-v1` — execution flagship.** Execution evidence only, never alpha evidence by itself.

This is a revision of the earlier 2026-08-19 priority that favored completing Trial 2 before spending Trial 7. The revision was made **before any Trial 7 result** because new external evidence plus repository archaeology materially changed the information set: a 2026 cross-venue funding study provides an independently specified hypothesis, and the repository contains an earlier 2026-08-18 prospective freeze of this same BTC-only candidate on a stale branch. The old freeze is preserved rather than rewritten.

Three recent evidence updates sharpen the current choice:

- **Schmeling, Schrimpf and Todorov, *Crypto Carry* (Management Science, 2026)** document large and time-varying crypto futures carry, while emphasizing crash, margin and limited-arbitrage-capital risks. That magnitude is large enough to justify testing an unchanged delta-neutral carry family under TheOldTrader's deliberately harsh retail friction.
- **Lau, *The Funding Carry and a Cross-Venue Spread on Perpetual Futures: A Significance-Tested Study of Hyperliquid and Centralized Venues* (SSRN, 2026)** reports a persistent funding differential between Hyperliquid and major centralized perpetual venues and reports that a simple static long-CEX/short-Hyperliquid implementation remained economically meaningful after transaction-cost and basis-risk analysis. The author also publishes a Zenodo replication package with code/cached data. Because this is a working paper rather than TheOldTrader evidence, its results motivate Trial 7 but are explicitly barred from scoring it or selecting its forward subperiods.
- **Kim and Hansen, *The Quarter-Hour Effect* (2026)** document quarter-hour bursts in crypto-futures activity and multi-hour return predictability from opening order imbalance. This remains relevant to E1's L2/trade research, but its basis-point-scale economic margin is less compelling for the current retail setting than the cross-venue funding hypothesis. It therefore remains a future prospective family rather than Trial 7.

## Evidence strong enough to affect the research design

1. **Start simple; model complexity has to earn its place.** Cakici, Shahzad, Bedowska-Sojka and Zaremba, *Machine Learning and the Cross-Section of Cryptocurrency Returns*, report substantial crypto return predictability but limited incremental benefit from model complexity; a small group of characteristics drives much of the signal. Li et al., *Predicting cryptocurrency returns with machine learning: Evidence from high-dimensional factor modeling* (Pacific-Basin Finance Journal, 2026), compare 12 ML models plus linear baselines and report tree-based models outperforming neural networks. Bysik and Ślepaczuk (2026) directly compare XGBoost, LSTM and iTransformer on roughly 70,000 hourly BTC observations using 27-fold walk-forward validation; XGBoost is descriptively strongest, but bootstrap evidence does not establish formal dominance. Therefore ridge/regularized baselines come first, gradient boosting is the next supervised family only if the information set itself shows usable OOS signal, and neural sequence models are not justified merely by being newer.

2. **Trading costs have to affect the decision rule, not just the final P&L line.** The 2026 Review of Financial Studies paper *Machine Learning and the Implementable Efficient Frontier* argues that cost-agnostic forecasts can over-rely on fast-decaying characteristics and that portfolio construction should be learned/evaluated net of costs. Bysik and Ślepaczuk likewise find naive hourly sign trading loses its apparent edge after only 10 bps of costs, while cost-aware trade filtering sharply reduces turnover. AQR's work on dynamic trading and live implementation emphasizes the same expected-alpha-versus-cost trade-off. TheOldTrader therefore gates trades on expected economic edge and reports turnover and fee drag explicitly.

3. **Crypto momentum evidence is conditional and implementation-sensitive.** Han, Kang and Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions* (revised March 2026), find stronger evidence for time-series momentum than cross-sectional momentum once realistic assumptions are imposed. Zhang and Makgolo (2026) show cross-sectional momentum is state dependent and sensitive to dynamic, survivorship-aware universe construction. This supported Trial 5's simple low-turnover time-series momentum test. Trial 5 subsequently failed its frozen development gate, so its parameterization is locked as a failed trial rather than retuned.

4. **A low-volatility crypto premium is a distinct recent hypothesis.** Pyo and Jang, *Revisiting the low-volatility anomaly in cryptocurrency markets* (Finance Research Letters 97, 2026, 109851), report that lower-realized-volatility cryptocurrencies outperform higher-volatility cryptocurrencies in the post-2017 period, with the strongest reported spread around two-to-three-month volatility formation and one-month holding horizons. Trial 6 prospectively fixed one 90-day formation window and monthly holding period before any TheOldTrader result. Trial 6 then failed its first frozen development gate and is locked against rescue.

5. **Backtest multiplicity must be recorded.** Bailey and López de Prado's Deflated Sharpe Ratio corrects observed Sharpe for selection bias, non-normality and the number of trials. Bailey, Borwein, López de Prado and Zhu's Probability of Backtest Overfitting motivates explicit trial accounting and non-selection on a final holdout. TheOldTrader therefore uses frozen manifests, an explicit serious-trial ledger, walk-forward development folds, embargo where labels overlap, and chronological/forward holdouts that cannot be used to alter the evaluated specification.

6. **Execution is a separate modeling problem.** Man AHL publicly describes ML use in trade execution and smart order-routing, and AQR's live-cost work shows that implementability depends heavily on how trading is executed. Candle data cannot identify queue position, fill probability or adverse selection. TheOldTrader therefore keeps E1 independent of strategy evidence and does not retroactively lower failed-trial costs because an execution experiment later looks favorable.

7. **Crypto data provenance itself can invalidate a backtest.** Coinbase documents a maximum of 300 candles per request and warns historical candles can be incomplete when no ticks occur, so the Coinbase runner paginates, records missing-bar diagnostics and hashes the normalized dataset. Binance's public-data repository documents archive layout/checksums, but open issue #475 (June/July 2026) reports historical monthly SPOT kline discrepancies where daily archives match API/uiKlines. Trial 2 therefore freezes checksum-verified *daily* spot archives before any primary carry P&L is observed.

8. **Cross-venue carry has different data/mechanism requirements from single-venue carry.** Hyperliquid's first-party documentation states that funding is paid hourly and that the funding cashflow uses position size × oracle price × funding rate. Binance's official USD-M funding-history endpoint returns actual funding events with funding time/rate and mark price, while funding intervals can be adjusted rather than assumed immutable forever. Trial 7 therefore never rescales both venues onto one synthetic funding interval: it accrues each official event on its native venue schedule, uses Hyperliquid oracle price and Binance event mark price for funding notional, and fails closed rather than interpolate a missing event/price.

9. **Cross-venue basis and collateral risk cannot be hidden inside “delta neutral.”** Equal BTC units remove first-order BTC direction but do not force Binance and Hyperliquid marks to move identically. A funding spread can therefore be overwhelmed by relative basis movement, venue-specific collateral drawdown or execution friction. Trial 7 reports funding, cross-venue basis P&L and execution friction separately; it also maintains venue-by-venue collateral paths and freezes adverse 5%/10%/25% relative-basis shocks before any result.

## Evidence that motivates separate strategy families

- **Market microstructure / LOB:** Lucchese, Pakkanen and Veraart (2022) find broad short-horizon return predictability from order books with strong representation dependence; Jha et al. (2020) show walk-forward Bitcoin LOB predictability at a two-second horizon. Kim and Hansen (2026) add evidence that quarter-hour opening order imbalance predicts returns over roughly 4–12 hours. None of this implies retail profitability after latency, fees, fill probability and adverse selection. A TheOldTrader microstructure study therefore requires recorded L2/trades and realistic execution simulation, not 15-minute candles.

- **Single-venue-family funding / basis carry:** Schmeling, Schrimpf and Todorov, *Crypto Carry*, published in Management Science in 2026, document large and time-varying crypto futures carry together with crash, margin and liquidation risks. Trial 2 evaluates carry as its own delta-neutral spot/perpetual strategy with realized funding, independently marked spot and perpetual legs, both-leg costs, collateral and gap stress. Carry performance is never pooled with directional-strategy performance.

- **Cross-venue perpetual funding spread:** Lau (2026) motivates a separate question: whether a persistent difference in perpetual funding across venues can be harvested with equal base units while avoiding a spot leg. TheOldTrader does not copy the paper's historical performance or optimize across its eight-asset sample. Trial 7 freezes BTC only, long Binance USD-M / short Hyperliquid, one entry/exit, 15% notional per leg, no threshold/switching/rebalancing/asset selection, 15 bps all-in friction per venue order, and a harder 25 bps/order stress. The published Zenodo package is barred from candidate scoring; only the forward TheOldTrader window can produce Trial 7 evidence.

- **Text / LLM signals:** The evidence is mixed enough that text remains an input-feature study, not an autonomous trader. Ider and Lessmann (2022) find domain-adapted BERT sentiment can improve crypto forecasts. Fiszeder, Orzeszko and Pietrzyk (Journal of Big Data, 2026) find ChatGPT-derived Bitcoin-news sentiment improves in-sample fit but not statistically significant OOS forecasting performance. Sharma and Baruah (2026) find a leakage-safe news-sentiment pipeline slightly *reduces* mean Sharpe versus a technical baseline. Gao, Jiang and Yan (2026) show LLM historical forecasts can exhibit measurable look-ahead contamination through memorized outcomes. Therefore any future TheOldTrader text feature needs point-in-time news timestamps, frozen model/version prompts, post-training-cutoff or contamination controls, and incremental OOS tests. An LLM will not directly choose trades.

- **Heterogeneous ensembles:** Man AHL describes ML as useful for combining numerous weak, varied information sources in noisy financial data. That motivates a future ensemble only after distinct components independently add OOS information. Five variants of the same momentum transform do not count as diversification.

## TheOldTrader-specific inferences

These are inferences from the evidence plus TheOldTrader's frozen cost assumptions, not direct literature findings.

- With 60 bps fee per side + 5 bps slippage per side + spread, TheOldTrader's primary modeled spot round trip is roughly **1.40%** at a 10 bps spread. That is far above many published ML cost assumptions, so successful academic candle forecasts cannot be assumed to transfer.
- Trial 1's BTC robustness replication failed: the forecast/realized-return relationship was negative and the model did not clear the frozen cost hurdle. That is evidence against rescuing the same candle feature set by simply increasing model complexity.
- Trials 5 and 6 then failed two separate low-turnover spot hypotheses under the same harsh cost framework. Those failures are retained rather than optimized away.
- Trial 2 remains worth finishing because its return source and turnover profile are structurally different and its primary specification was frozen before the result.
- Trial 7 is now worth a genuine forward test because its return source is also structurally different, it was independently motivated, the repository already contained a pre-result freeze, and the public venue mechanisms permit a provenance-heavy prospective test. This is **not** evidence that it will pass.
- Trial 7 deliberately uses 15 bps/order as its primary all-in friction even though Hyperliquid's current base perp taker fee is lower, and requires a 25 bps/order stress to remain positive at the final gate. This avoids pretending both venues receive ideal account-tier or maker economics.
- Maker execution could materially change economics, but E1 cannot retroactively alter Trial 7's frozen 15/25-bps cost assumptions. A future execution-aware successor would need a new prospective specification.
- Quarter-hour order imbalance remains a credible microstructure hypothesis but is deferred rather than opportunistically substituted into Trial 7.

## Speculative hypotheses — not treated as evidence

- Cross-asset dispersion may help identify when relative momentum is unreliable in crypto.
- LOB imbalance may add execution timing even if it is too weak to justify standalone directional trading.
- The Hyperliquid/Binance funding differential may compress or reverse during the sealed Trial 7 window; the working paper's historical average is not assumed to persist.
- A cross-venue spread can fail despite positive net funding if venue basis widens or collateral stress becomes binding.
- Text/news could add incremental information around discrete macro/crypto events, but the null and contamination evidence means the burden of proof is high.

## Primary / first-party references

- Cakici et al., *Machine Learning and the Cross-Section of Cryptocurrency Returns*, SSRN 4295427.
- Li et al., *Predicting cryptocurrency returns with machine learning: Evidence from high-dimensional factor modeling*, Pacific-Basin Finance Journal 96 (2026), 103033.
- Bysik & Ślepaczuk, *Machine Learning-Based Bitcoin Trading Under Transaction Costs: Evidence From Walk-Forward Forecasting*, arXiv:2606.00060 / SSRN 6795938 (2026).
- Han, Kang & Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions*, SSRN 4675565, revised 2026-03-26.
- Pyo & Jang, *Revisiting the low-volatility anomaly in cryptocurrency markets*, Finance Research Letters 97 (2026), 109851.
- Zhang & Makgolo, *Cross-Sectional Dispersion and the State Dependence of Cryptocurrency Momentum*, SSRN 6648082 (2026).
- Kim & Hansen, *The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures*, arXiv:2607.09426 (2026).
- Lau, *The Funding Carry and a Cross-Venue Spread on Perpetual Futures: A Significance-Tested Study of Hyperliquid and Centralized Venues*, SSRN 2026; replication package Zenodo 10.5281/zenodo.20938723.
- *Machine Learning and the Implementable Efficient Frontier*, Review of Financial Studies, published 2026-03-15, doi:10.1093/rfs/hhag022.
- Bailey & López de Prado, *The Deflated Sharpe Ratio*, Journal of Portfolio Management 40(5), 2014.
- Bailey et al., *The Probability of Backtest Overfitting*, Journal of Computational Finance 20(4), 2017.
- Gârleanu & Pedersen, *Dynamic Trading with Predictable Returns and Transaction Costs*, Journal of Finance / AQR research page.
- Frazzini, Israel & Moskowitz, *Trading Costs* and *Trading Costs of Asset Pricing Anomalies*, AQR working papers using live institutional execution data.
- Schmeling, Schrimpf & Todorov, *Crypto Carry*, Management Science, published online 2026-05-06.
- Lucchese, Pakkanen & Veraart, *The Short-Term Predictability of Returns in Order Book Markets: a Deep Learning Perspective*, arXiv:2211.13777.
- Jha et al., *Deep Learning for Digital Asset Limit Order Books*, arXiv:2010.01241.
- Ider & Lessmann, *Forecasting Cryptocurrency Returns from Sentiment Signals*, arXiv:2204.05781.
- Fiszeder, Orzeszko & Pietrzyk, *News sentiment analysis using ChatGPT for Bitcoin price dynamics*, Journal of Big Data 13:106 (2026).
- Sharma & Baruah, *Leakage-Safe Financial News Sentiment Trading in United States Equities*, SSRN 6813859 (2026).
- Gao, Jiang & Yan, *Detecting Lookahead Bias in LLM Forecasts*, SSRN 5985277, revised 2026-06-25.
- Coinbase Exchange API, *Get product candles* and *Get product book* documentation.
- Binance USD-M Futures API, funding-rate history and premium-index endpoints; Binance `binance-public-data` repository and open data-quality issue #475.
- Hyperliquid Docs, funding, fees, info endpoint and asset-context documentation.
- Man AHL, *The Rise of Machine Learning* (2016), *An Introduction to Machine Learning* (2019), and public execution/ML materials.
