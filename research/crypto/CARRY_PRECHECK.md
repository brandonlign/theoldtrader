# Funding-carry v1 scale precheck — not a backtest

Date: 2026-08-12  
Experiment: `funding-carry-v1`  
Classification: **PRE-EVALUATION SCALE CHECK ONLY**

This note must never be reported as Trial 2 return, Sharpe, profitability, or historical validation. No synchronized spot/perpetual/funding input has been evaluated by `carry-evaluate.js`, and no Trial 2 P&L has been observed.

## Why this calculation is allowed

Before Trial 2 was fully frozen, the whole-sample summary statistics of the public Torch-Trade BTCUSDT funding dataset had already been viewed. The Trial 2 manifest therefore already classifies any result from this historical interval as development/robustness rather than pristine validation. This note does not inspect a carry result or choose a subperiod; it only turns the already-visible whole-sample funding-rate summary into an order-of-magnitude capital-allocation check.

Public dataset-card facts used:

- interval: 8 hours;
- rows: 5,295;
- window: 2021-05-01 through 2026-02-28;
- reported mean funding rate: `0.00007416` per 8-hour observation;
- reported annualized mean funding rate: about 8.12%;
- reported completeness: 100%.

## Constant-notional approximation

The simple cumulative **rate** implied by the published mean and row count is:

`0.00007416 × 5,295 = 0.3926772`, or about **39.27% of perpetual notional** across the full sample.

If perpetual notional were held constant at Trial 2's frozen 15% of account equity, that would correspond to an approximate gross account contribution of:

`39.26772% × 15% = 5.89016%` over roughly 4.83 years.

The frozen Trial 2 friction is deliberately severe and applies the TheOldTrader assumption to both legs:

- 60 bps fee per side;
- 5 bps slippage per side;
- 10 bps round-trip spread per leg;
- therefore about 140 bps round trip per leg;
- two 15%-notional legs imply an approximate account-level open+close friction of `2 × 15% × 1.40% = 0.42%`.

Under the **constant-notional thought experiment only**, gross funding minus this static two-leg friction is therefore about **5.47% of starting account value over the full ~4.83-year sample**, or roughly **1.13% per year on a simple non-compounded account basis** before everything listed below.

## Why this is not Trial 2 P&L

The actual frozen candidate holds **equal BTC units**, not constant USD notional. Perpetual notional therefore changes with BTC price, so actual dollar funding is `BTC units × contemporaneous perpetual price × realized funding rate`; multiplying the average funding rate by a constant 15% notional is only a scale approximation.

The approximation also omits or simplifies:

- entry and exit spot/perpetual basis;
- path-dependent futures unrealized P&L and margin usage;
- maintenance-margin / liquidation stress;
- exact contemporaneous perpetual notional for each funding payment;
- spot/perpetual execution prices;
- any missing or timestamp-misaligned official source data;
- counterparty/venue risk;
- collateral opportunity cost;
- taxes or financing costs.

Accordingly, positive funding-rate carry in this note **cannot rescue** Trial 2 if the synchronized both-leg backtest later fails. Likewise, it cannot justify leverage or a larger allocation after the result. Any leverage/allocation change is a new trial.

## Research implication

The scale check makes Trial 2 worth completing because the historical funding stream is large enough to clear the deliberately conservative static entry/exit friction in a constant-notional thought experiment. However, at the frozen 15% spot / 15% perpetual size, the plausible account-level return contribution is not obviously large. Trial 2 is therefore being tested primarily as a potentially lower-turnover, market-neutral return source, not as a high-return replacement for the directional strategy.
