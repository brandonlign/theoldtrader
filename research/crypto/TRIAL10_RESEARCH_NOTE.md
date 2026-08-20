# Trial 10 candidate — Bitnomial dated-future / perpetual BTC relative value

Status: **development feasibility only; not frozen; no candidate economics observed**

Candidate family: same-exchange BTC term-structure / perpetual-funding relative value.

Proposed economic position, if feasibility passes:

- long one Bitnomial Bitcoin USD Centi (`BUC`) dated future;
- short one Bitnomial Bitcoin USD Centi perpetual (`PBTCUC`);
- equal 0.01 BTC contract units on both legs;
- no direction switching, asset selection, rebalancing, or leverage optimization.

Rationale for investigation:

- Bitnomial's product notation defines `BUC` as 0.01 BTC and `PBTCUC` as the 0.01 BTC perpetual;
- Bitnomial Clearing currently publishes a **98% inter-commodity spread credit for 1 BUC vs 1 PBTCUC**;
- Trial 9's development probe showed the perpetual book was consistently two-sided/executable while Bitnomial spot was the failed leg, so a listed dated future is the closest same-stack hedge worth qualifying.

The 98% spread credit is **not treated as alpha**. It only affects capital efficiency. Any eventual Trial 10 economics must separately model perpetual funding, dated/perpetual basis movement, expiry/roll mechanics, execution depth, fees/commissions, and margin stress.

## Pre-economic feasibility rule

Before any Trial 10 freeze:

1. resolve the BTC perpetual from first-party funding history and verify 0.01 BTC `PBTCUC*` identity;
2. identify one active 0.01 BTC `BUC` dated future using first-party product specs only;
3. require the selected dated future to have at least 60 and at most 180 calendar days remaining, selecting the earliest qualifying expiry without looking at price/basis/funding;
4. observe public Bitnomial top-10 book snapshots for both legs for 120 seconds;
5. require at least one two-sided snapshot for each leg and executable displayed depth on both BUY and SELL for one whole 0.01 BTC contract;
6. print/store no prices, basis, funding rates, or P&L during feasibility qualification.

A product that remains one-sided or lacks one-contract depth for the full probe is a development no-go. Do not substitute last price, assume hidden liquidity, or widen the quantity rule after seeing the probe.

Passing this probe only earns permission to design/freeze a prospective Trial 10 economic protocol. It is not evidence that the strategy is profitable.