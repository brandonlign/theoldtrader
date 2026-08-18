# Funding-carry v1 data-source audit — 2026-08-12

Experiment: `funding-carry-v1`  
Classification: **PRE-EVALUATION DATA AUDIT; NO CARRY P&L OBSERVED**

This note records data-quality facts discovered before Trial 2's synchronized official Binance input was evaluated. It does not change the strategy, allocation, costs, dates, funding rates, or anti-rescue rule.

## Primary versus secondary sources

Trial 2's primary source remains checksum-verified Binance Vision archives built by `prepare-carry-data.py`:

- **spot:** daily BTCUSDT 8h spot klines;
- **perpetual execution reference:** monthly USD-M BTCUSDT standard 8h contract klines;
- **perpetual valuation reference:** monthly USD-M BTCUSDT 8h markPriceKlines;
- **funding:** monthly USD-M BTCUSDT fundingRate archives.

Secondary Torch-Trade datasets sourced from Binance Data Collection are used only as independent coverage/plausibility checks. They are not allowed to replace a missing official Trial 2 observation through interpolation or forward-fill.

## Funding-series check

The Torch-Trade BTCUSDT 8h funding dataset reports:

- 5,295 observations;
- May 1, 2021 through February 28, 2026;
- 100% reported completeness;
- 8-hour frequency.

The frozen Trial 2 window from 2021-05-01T00:00:00Z through 2026-03-01T00:00:00Z contains exactly `1,765 days × 3 = 5,295` scheduled 8-hour boundaries. This is an independent count-level consistency check only; the official archive still has to pass checksum and exact synchronization.

The secondary preview also shows funding timestamps a few milliseconds around scheduled boundaries (for example `00:00:00.002` / `08:00:00.006`). Because funding archives use `calc_time` while kline data use exact `open_time`, Trial 2 now preserves raw funding time and maps it to the nearest scheduled 8-hour UTC boundary only if absolute skew is <=60 seconds. Any larger skew or collision aborts evaluation.

## Standard perpetual OHLCV check

The secondary BTCUSDT perpetual 1-minute OHLCV dataset reports 2,541,592 rows and approximately 100% completeness, with only seven isolated month-boundary 00:00 bars missing because of packaging. This supports the expectation that standard contract history is broadly available, but **does not authorize filling even a single missing Trial 2 scheduled 8-hour boundary**.

Trial 2 therefore downloads the official standard USD-M contract 8h archive directly and requires every scheduled funding boundary to have an exact contract open.

## Premium-index / basis dataset check

The secondary BTCUSDT perpetual basis/premium-index dataset is materially less complete:

- 2,531,443 rows;
- 99.60% completeness;
- 10,156 missing one-minute bars;
- known gaps include a full day on 2021-07-01, a roughly 96-hour interval on 2021-07-24 through 2021-07-27, full days on 2022-10-02 and 2023-02-24, plus smaller gaps.

The dataset card recommends forward-filling for ML use. **TheOldTrader explicitly rejects that recommendation for Trial 2.** A carry backtest with an open position cannot silently fabricate a missing basis/mark observation, especially during exchange-wide infrastructure events when derivative risk may be unusually high.

This is another reason not to use a precomputed basis series as Trial 2's valuation input. Trial 2 instead synchronizes independently downloaded spot, standard contract, markPrice and funding archives and aborts if any required scheduled mark is unavailable.

## Perpetual execution versus mark-price separation

A pre-result audit found that the first implementation used one `perp_price` column for both historical execution and valuation. This is scientifically undesirable because mark price is a valuation/risk reference rather than the actual contract transaction-price series.

Before any carry P&L was observed, Trial 2 was therefore frozen to use:

- standard USD-M contract 8h open as the perpetual **entry/exit execution-price proxy**, with the already-frozen spread/slippage model applied around it;
- USD-M markPrice 8h open for **unrealized P&L, funding notional, maintenance margin and stress**.

The synchronized CSV now carries both `perp_exec_price` and `perp_mark_price`, and `carry-evaluate.js` independently requires both.

## Sizing consistency correction

The original prose contained two constraints that cannot both be exact when spot and futures prices differ: “15% perpetual notional” and “short equal BTC units.” Before any Trial 2 result was observed, the equal-unit hedge was made authoritative:

1. spend 15% of starting equity on the spot leg at the modeled spot entry fill;
2. take the resulting BTC units;
3. short exactly those BTC units of the perpetual;
4. accept the resulting perpetual USD notional implied by the actual contract entry price;
5. never rebalance.

This is not leverage optimization; it removes an internal contradiction and preserves first-order BTC delta neutrality.

## Evaluation consequence

Trial 2 may run only when the official synchronized data pass all of the following before P&L is interpreted:

- all source ZIPs match official `.CHECKSUM` hashes;
- exactly 5,295 normalized scheduled funding rows cover the frozen window;
- raw funding timestamp skew is preserved and within the frozen tolerance;
- exact spot, standard contract and mark-price opens exist at every scheduled boundary;
- no interpolation/forward-fill occurs;
- the synchronized CSV is hashed;
- the independent evaluator rechecks the full 8-hour grid and timestamp provenance.

If any condition fails, the experiment is **data-inconclusive**, not a strategy failure and not permission to loosen the data rules.
