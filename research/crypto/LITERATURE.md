# MoneyMog Crypto Research Evidence Review — 2026-08-12

This note freezes the evidence base used to choose the first MoneyMog crypto research candidate. It is not a claim that any cited strategy is profitable for MoneyMog. The live paper trader remains unchanged.

## Evidence supported strongly enough to affect v1 design

1. **Simple models deserve priority over deep sequence models.** Cakici, Shahzad, Bedowska-Sojka and Zaremba, *Machine Learning and the Cross-Section of Cryptocurrency Returns* (2022/2023), report substantial crypto return predictability but limited incremental benefit from model complexity; a handful of simple characteristics such as price, past alpha, illiquidity and momentum drive much of the signal. This supports starting with linear/regularized forecasting before XGBoost/LightGBM or neural nets.

2. **Trading costs must enter the economic decision, not merely be subtracted afterward.** The 2026 Review of Financial Studies paper *Machine Learning and the Implementable Efficient Frontier* argues that cost-agnostic return forecasts can over-rely on fleeting characteristics and that learning/portfolio construction should be evaluated on net-of-cost outcomes. MoneyMog therefore gates trades on predicted gross return clearing modeled round-trip friction and reports turnover/fee drag explicitly.

3. **Crypto momentum evidence is conditional and implementation-sensitive.** Han, Kang and Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions* (revised March 2026), find stronger evidence for time-series momentum than cross-sectional momentum once realistic assumptions are introduced. Zhang and Makgolo (2026) further show cross-sectional momentum is state dependent and sensitive to dynamic, survivorship-aware universe construction. This supports retaining a simple time-series trend comparator while postponing a serious cross-sectional candidate until MoneyMog has a dynamic historical universe.

4. **Backtest multiplicity must be recorded.** Bailey and López de Prado's Deflated Sharpe Ratio corrects observed Sharpe for selection bias, non-normality and the number of trials. Bailey, Borwein, López de Prado and Zhu's Probability of Backtest Overfitting motivates explicit trial accounting and non-selection on a final holdout. MoneyMog v1 therefore has a frozen manifest, a global trial count, walk-forward development folds, a 24-hour embargo and a final chronological holdout.

5. **The historical Coinbase candle source has known limitations.** Coinbase documents a maximum of 300 candles per request and warns that historical candles may be incomplete when no ticks occur. The runner paginates requests, records missing-bar diagnostics, caches the exact normalized dataset and records its SHA-256 hash.

## Evidence that motivates later, separate tracks

- **Market microstructure / LOB:** Lucchese, Pakkanen and Veraart (2022) find broad short-horizon return predictability in order-book markets using deep learning, with strong dependence on representation. Jha et al. (2020) show walk-forward Bitcoin LOB predictability at a two-second horizon. These results do *not* imply retail profitability after fees, latency, fill probability and adverse selection. A MoneyMog microstructure study should therefore use recorded L2/trades and a fill/adverse-selection simulator, not candle backtests.

- **Carry / funding / basis:** Schmeling, Schrimpf and Todorov, *Crypto Carry* (BIS-affiliated authors, 2023), document crypto futures carry together with crash/margin/liquidation risk. Carry should be evaluated as a delta-neutral strategy with venue-specific funding, basis, margin and liquidation mechanics and must not be mixed with directional spot performance.

- **Text / NLP:** Ider and Lessmann (2022) find that domain-adapted BERT sentiment can improve crypto return forecasts. This is sufficiently promising for a future feature study, but historical timestamp integrity, source availability and pretrained-model contamination must be controlled. An LLM will never be allowed to directly choose trades without a quantitative, time-stamped feature pipeline.

- **Institutional systematic practice:** Man AHL publicly describes ML as most useful for combining numerous weak information sources, emphasizes noisy financial data, and notes use in execution/smart routing and NLP. This supports heterogeneous ensembles later, but not an ensemble of near-duplicate technical indicators.

## Inferences made for MoneyMog

- With the frozen v2 friction assumption of 60 bps fee per side + 5 bps slippage per side + spread, a short-horizon signal needs unusually large forecastable returns merely to break even. The first supervised candidate therefore targets **24-hour**, not minutes, and trades at most once per UTC day.
- A pooled ridge model is deliberately lower capacity than tree or neural models. If it cannot beat simple controls net of costs, escalating model complexity is not scientifically justified yet.
- Historical candles cannot support honest maker-fill simulation. Maker execution research is deferred until MoneyMog has quote/trade history with enough detail to model queue/fill probability and adverse selection.

## Speculative hypotheses (not treated as evidence)

- Cross-asset dispersion may help identify when relative momentum is unreliable in crypto.
- LOB imbalance may add useful execution timing even if it is too weak to justify standalone directional trading.
- Funding/basis carry may ultimately be more robust for a high-fee retail setting than medium-horizon directional forecasting, but this must be tested separately with realistic margin and venue risk.

## Primary / first-party references

- Cakici et al., *Machine Learning and the Cross-Section of Cryptocurrency Returns*, SSRN 4295427.
- Han, Kang & Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions*, SSRN 4675565, revised 2026-03-26.
- Zhang & Makgolo, *Cross-Sectional Dispersion and the State Dependence of Cryptocurrency Momentum*, SSRN 6648082, 2026.
- *Machine Learning and the Implementable Efficient Frontier*, Review of Financial Studies, published 2026-03-15, doi:10.1093/rfs/hhag022.
- Bailey & López de Prado, *The Deflated Sharpe Ratio*, Journal of Portfolio Management 40(5), 2014.
- Bailey et al., *The Probability of Backtest Overfitting*, Journal of Computational Finance 20(4), 2017.
- Schmeling, Schrimpf & Todorov, *Crypto Carry*, SSRN 4268371, 2023.
- Lucchese, Pakkanen & Veraart, *The Short-Term Predictability of Returns in Order Book Markets: a Deep Learning Perspective*, arXiv:2211.13777.
- Jha et al., *Deep Learning for Digital Asset Limit Order Books*, arXiv:2010.01241.
- Ider & Lessmann, *Forecasting Cryptocurrency Returns from Sentiment Signals*, arXiv:2204.05781.
- Coinbase Exchange API, *Get product candles* and *Get product book* documentation.
- Man AHL, *An Introduction to Machine Learning* (2019) and *The Rise of Machine Learning at Man AHL* (2016).
