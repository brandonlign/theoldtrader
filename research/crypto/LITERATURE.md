# MoneyMog Crypto Research Evidence Review — 2026-08-12

This note records the evidence used to choose MoneyMog research directions. It is not a claim that any cited strategy is profitable for MoneyMog. The live paper trader remains unchanged. Published/working-paper results are treated as hypotheses to replicate under MoneyMog's own costs and data, not as transferable alpha.

## Evidence strong enough to affect the research design

1. **Start simple; model complexity has to earn its place.** Cakici, Shahzad, Bedowska-Sojka and Zaremba, *Machine Learning and the Cross-Section of Cryptocurrency Returns*, report substantial crypto return predictability but limited incremental benefit from model complexity; a small group of characteristics drives much of the signal. Li et al., *Predicting cryptocurrency returns with machine learning: Evidence from high-dimensional factor modeling* (Pacific-Basin Finance Journal, 2026), compare 12 ML models plus linear baselines and report tree-based models outperforming neural networks. Bysik and Ślepaczuk (2026) directly compare XGBoost, LSTM and iTransformer on roughly 70,000 hourly BTC observations using 27-fold walk-forward validation; XGBoost is descriptively strongest, but bootstrap evidence does not establish formal dominance. Therefore ridge/regularized baselines come first, gradient boosting is the next supervised family only if the information set itself shows usable OOS signal, and neural sequence models are not justified merely by being newer.

2. **Trading costs have to affect the decision rule, not just the final P&L line.** The 2026 Review of Financial Studies paper *Machine Learning and the Implementable Efficient Frontier* argues that cost-agnostic forecasts can over-rely on fast-decaying characteristics and that portfolio construction should be learned/evaluated net of costs. Bysik and Ślepaczuk likewise find naive hourly sign trading loses its apparent edge after only 10 bps of costs, while cost-aware trade filtering sharply reduces turnover. AQR's work on dynamic trading and live implementation emphasizes the same expected-alpha-versus-cost trade-off. MoneyMog therefore gates trades on expected economic edge and reports turnover and fee drag explicitly.

3. **Crypto momentum evidence is conditional and implementation-sensitive.** Han, Kang and Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions* (revised March 2026), find stronger evidence for time-series momentum than cross-sectional momentum once realistic assumptions are imposed. Zhang and Makgolo (2026) show cross-sectional momentum is state dependent and sensitive to dynamic, survivorship-aware universe construction. This supports a simple time-series trend comparator, but a serious cross-sectional candidate requires a historical liquidity-filtered universe rather than today's survivors.

4. **Backtest multiplicity must be recorded.** Bailey and López de Prado's Deflated Sharpe Ratio corrects observed Sharpe for selection bias, non-normality and the number of trials. Bailey, Borwein, López de Prado and Zhu's Probability of Backtest Overfitting motivates explicit trial accounting and non-selection on a final holdout. MoneyMog therefore uses frozen manifests, an explicit serious-trial ledger, walk-forward development folds, embargo where labels overlap, and a chronological holdout that cannot be used to alter the evaluated specification.

5. **Execution is a separate modeling problem.** Man AHL publicly describes ML use in trade execution and smart order-routing, and AQR's live-cost work shows that implementability depends heavily on how trading is executed. Candle data cannot identify queue position, fill probability or adverse selection. MoneyMog will therefore not claim a maker/limit-order advantage until it has timestamped quote/trade history and a fill simulator; alpha forecasts and execution policy remain separate research components.

6. **Crypto data provenance itself can invalidate a backtest.** Coinbase documents a maximum of 300 candles per request and warns historical candles can be incomplete when no ticks occur, so the Coinbase runner paginates, records missing-bar diagnostics and hashes the normalized dataset. Binance's public-data repository documents archive layout/checksums, but open issue #475 (June/July 2026) reports historical monthly SPOT kline discrepancies where daily archives match API/uiKlines. Trial 2 therefore freezes checksum-verified *daily* spot archives before any carry P&L is observed.

## Evidence that motivates separate strategy families

- **Market microstructure / LOB:** Lucchese, Pakkanen and Veraart (2022) find broad short-horizon return predictability from order books with strong representation dependence; Jha et al. (2020) show walk-forward Bitcoin LOB predictability at a two-second horizon. Recent 2026 work using Hawkes/LOB event streams likewise treats this as a high-frequency microstructure problem. None of that implies retail profitability after latency, taker fees, fill probability and adverse selection. A MoneyMog microstructure study therefore requires recorded L2/trades and realistic execution simulation, not 15-minute candles.

- **Funding / basis carry:** Schmeling, Schrimpf and Todorov, *Crypto Carry* (2023), document crypto futures carry together with crash, margin and liquidation risks. Trial 2 therefore evaluates carry as its own delta-neutral spot/perpetual strategy with realized funding, independently marked spot and perpetual legs, both-leg costs, collateral and gap stress. Carry performance is never pooled with directional-strategy performance.

- **Text / LLM signals:** The evidence is mixed enough that text remains an input-feature study, not an autonomous trader. Ider and Lessmann (2022) find domain-adapted BERT sentiment can improve crypto forecasts. Fiszeder, Orzeszko and Pietrzyk (Journal of Big Data, 2026) find ChatGPT-derived Bitcoin-news sentiment improves in-sample fit but not statistically significant OOS forecasting performance. Sharma and Baruah (2026) find a leakage-safe news-sentiment pipeline slightly *reduces* mean Sharpe versus a technical baseline. Gao, Jiang and Yan (2026) show LLM historical forecasts can exhibit measurable look-ahead contamination through memorized outcomes. Therefore any future MoneyMog text feature needs point-in-time news timestamps, frozen model/version prompts, post-training-cutoff or contamination controls, and incremental OOS tests. An LLM will not directly choose trades.

- **Heterogeneous ensembles:** Man AHL describes ML as useful for combining numerous weak, varied information sources in noisy financial data. That motivates a future ensemble only after distinct components independently add OOS information (for example trend + cross-sectional + liquidity/microstructure + text). Five variants of the same momentum transform do not count as diversification.

## MoneyMog-specific inferences

These are inferences from the evidence plus MoneyMog's frozen cost assumptions, not direct literature findings.

- With 60 bps fee per side + 5 bps slippage per side + spread, MoneyMog's primary modeled round trip is roughly **1.40%** at a 10 bps spread. That is far above the 10 bps cost experiment in Bysik and Ślepaczuk, so their profitable selected XGBoost configurations cannot be assumed to transfer to MoneyMog.
- The first supervised candidate therefore targets 24-hour expected return and trades at most once per UTC day. Its BTC robustness replication subsequently failed: the forecast/realized-return relationship was negative and the model did not clear the frozen cost hurdle in the holdout. That is evidence against rescuing the same candle feature set by simply increasing model complexity.
- Funding/basis carry is a more defensible *next research family* because it is economically different and low-turnover, not because gross funding rates prove profitability. Both-leg basis P&L, fees and margin risk still decide the result.
- Maker execution could materially change economics, but historical candles cannot validate it honestly. It remains gated on richer quote/trade data.

## Speculative hypotheses — not treated as evidence

- Cross-asset dispersion may help identify when relative momentum is unreliable in crypto.
- LOB imbalance may add execution timing even if it is too weak to justify standalone directional trading.
- Funding/basis carry may survive a high-fee retail setting better than medium-horizon directional forecasting, but this remains unproven until the frozen carry evaluator sees synchronized spot/perpetual/funding data.
- Text/news could add incremental information around discrete macro/crypto events, but the null and contamination evidence means the burden of proof is high.

## Primary / first-party references

- Cakici et al., *Machine Learning and the Cross-Section of Cryptocurrency Returns*, SSRN 4295427.
- Li et al., *Predicting cryptocurrency returns with machine learning: Evidence from high-dimensional factor modeling*, Pacific-Basin Finance Journal 96 (2026), 103033.
- Bysik & Ślepaczuk, *Machine Learning-Based Bitcoin Trading Under Transaction Costs: Evidence From Walk-Forward Forecasting*, arXiv:2606.00060 / SSRN 6795938 (2026).
- Han, Kang & Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions*, SSRN 4675565, revised 2026-03-26.
- Zhang & Makgolo, *Cross-Sectional Dispersion and the State Dependence of Cryptocurrency Momentum*, SSRN 6648082 (2026).
- *Machine Learning and the Implementable Efficient Frontier*, Review of Financial Studies, published 2026-03-15, doi:10.1093/rfs/hhag022.
- Bailey & López de Prado, *The Deflated Sharpe Ratio*, Journal of Portfolio Management 40(5), 2014.
- Bailey et al., *The Probability of Backtest Overfitting*, Journal of Computational Finance 20(4), 2017.
- Gârleanu & Pedersen, *Dynamic Trading with Predictable Returns and Transaction Costs*, Journal of Finance / AQR research page.
- Frazzini, Israel & Moskowitz, *Trading Costs* and *Trading Costs of Asset Pricing Anomalies*, AQR working papers using live institutional execution data.
- Schmeling, Schrimpf & Todorov, *Crypto Carry*, SSRN 4268371 (2023).
- Lucchese, Pakkanen & Veraart, *The Short-Term Predictability of Returns in Order Book Markets: a Deep Learning Perspective*, arXiv:2211.13777.
- Jha et al., *Deep Learning for Digital Asset Limit Order Books*, arXiv:2010.01241.
- Ider & Lessmann, *Forecasting Cryptocurrency Returns from Sentiment Signals*, arXiv:2204.05781.
- Fiszeder, Orzeszko & Pietrzyk, *News sentiment analysis using ChatGPT for Bitcoin price dynamics*, Journal of Big Data 13:106 (2026).
- Sharma & Baruah, *Leakage-Safe Financial News Sentiment Trading in United States Equities*, SSRN 6813859 (2026).
- Gao, Jiang & Yan, *Detecting Lookahead Bias in LLM Forecasts*, SSRN 5985277, revised 2026-06-25.
- Coinbase Exchange API, *Get product candles* and *Get product book* documentation.
- Binance `binance-public-data` repository and open data-quality issue #475.
- Man AHL, *The Rise of Machine Learning* (2016), *An Introduction to Machine Learning* (2019), and public execution/ML materials.
