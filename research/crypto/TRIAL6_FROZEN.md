# Trial 6 freeze — `lowvol-v1`

Frozen: 2026-08-18 before any Trial 6 development result.

## Hypothesis

A recent peer-reviewed 2026 crypto study reports a post-2017 low-volatility premium, strongest with roughly two-to-three-month volatility formation and one-month holding periods. Trial 6 tests the simplest version that fits TheOldTrader's existing BTC/ETH/SOL Coinbase spot universe without introducing a broad survivorship-biased altcoin universe.

This is a new economic hypothesis, not a Trial 5 momentum rescue. It uses no momentum signal, return forecast, neural network, ridge model, cross-sectional return characteristic, funding rate, or order-book alpha.

## Frozen candidate

- Venue/data: public Coinbase daily candles.
- Fixed assets: BTC-USD, ETH-USD, SOL-USD.
- Decision cadence: monthly, on the first UTC daily candle of the calendar month.
- Signal cutoff: only closes strictly before the decision candle.
- Formation window: exact prior 90 daily log returns; no interpolation.
- Ranking: lowest annualized sample volatility wins; exact ties break lexicographically by product id.
- Portfolio: hold exactly the selected asset at a maximum 15% post-friction marked exposure; at least 85% remains cash.
- No leverage, no shorting, no momentum filter, no volatility threshold, no ML.
- Friction: 60 bps fee + 5 bps slippage + 5 bps historical spread proxy per traded dollar, or 70 bps each direction / 140 bps complete entry-exit round trip.
- Every monthly resize/reselection dollar pays the frozen friction.

## Development firewall

Development is fixed to 2022-01-01 through 2026-01-01. Calendar-year folds are 2022, 2023, 2024, and 2025. Enough pre-2022 data are acquired solely to construct the first exact 90-day signal.

The candidate is compared against:

1. cash;
2. 15% BTC buy-and-hold;
3. matched-exposure 15% total equal-weight BTC/ETH/SOL buy-and-hold (5% each);
4. the live-risk-cap 45% total equal-weight buy-and-hold (15% each).

Development passes only if every frozen check passes:

- positive full-window net return after costs;
- positive net return in at least 3 of 4 calendar-year folds;
- annualized Sharpe above the matched-exposure equal-weight comparator;
- maximum drawdown no worse than the matched-exposure equal-weight comparator;
- every monthly decision has complete exact 90-day history for the fixed three-asset universe;
- transaction cost equals 70 bps times every dollar of turnover.

A failure is permanent for `lowvol-v1`. Changing 90 days to another formation window, selecting a different number of assets, adding a volatility threshold, changing exposure, adding momentum, or altering the gate requires a new trial number.

## Holdout rule

The 2026-01-01 through 2026-08-01 period predates this freeze and is diagnostic-only. It is sealed unless development first passes and can never authorize promotion or parameter changes.

A genuine promotion proposal requires at least 180 days beginning no earlier than 2026-08-19, plus the frozen prospective criteria in the manifest. Promotion is never automatic.

## Safety

Trial 6 is research/paper only. It does not modify the frozen live/paper v2 strategy and cannot place real orders.
