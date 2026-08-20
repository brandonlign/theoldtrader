# Trial 9 development feasibility gates

Status: **development only / not frozen / no candidate P&L observed**

These gates decide whether `bitnomial-internal-carry-v1` is worth freezing as a forward strategy candidate. They are not promotion gates and cannot be loosened after viewing the bounded public liquidity probe.

## 1. Source/protocol gate

Required before freeze:

- public Bitnomial funding history for `BTCUC` resolves one unambiguous perpetual product ID;
- the resolved product is machine-identified as the 0.01 BTC `PBTCUC*` perpetual;
- exactly one active `BTCUSD` spot product is machine-identified;
- the public WebSocket protocol delivers book snapshots for both products;
- the recorder and the development connectivity checker use the same subscribe/decode/two-sided-book rules;
- raw-response semantic reconstruction is implemented for product specs, product data, funding history, and both book snapshots.

A schema mismatch is an engineering issue only if the first-party documentation/live payload establishes an unambiguous correction before freeze. Missing or ambiguous product identity is a no-go.

## 2. Displayed-liquidity gate

The primary execution model uses only the public top-10 displayed book. It never assumes hidden or deeper liquidity.

The bounded development liquidity probe is intentionally non-economic: it prints no prices, funding rates, basis or P&L. It tests fixed BTC quantities only.

Before freeze, all of the following must hold in at least one clean 120-second probe:

- both `BTCUSD` spot and the BTC perpetual produce at least one two-sided book snapshot;
- for the **0.01 BTC minimum candidate size**, both products show enough displayed top-10 depth to execute both BUY and SELL in at least one two-sided snapshot;
- no crossed/malformed book is accepted as executable;
- a product that remains one-sided for the entire probe is a development no-go, not a reason to substitute last price or widen the execution model.

A single short probe can establish an immediate no-go but cannot by itself establish 24/7 liquidity robustness. If the minimum-size gate passes, freeze eligibility additionally requires repeated clean probes across materially different UTC hours or an equivalent longer pre-freeze availability audit. The 0.02 BTC probe is diagnostic for target-size headroom; failure at 0.02 does not override the frozen whole-contract sizing rule and does not permit fractional perpetual contracts.

## 3. Cost gate

Known public venue costs:

- Bitnomial Spot Complex: 2 bps per side, stated by Bitnomial as inclusive of Exchange and Clearinghouse fees;
- Bitcoin/Crypto Complex derivatives: $0.10 per contract per side for non-participants, stated as inclusive of Exchange and Clearinghouse fees.

Unresolved item: the applicable end-customer FCM/intermediary commission schedule is not publicly verified for the intended direct route.

Therefore:

- primary economics may be labeled **known Exchange+Clearinghouse cost only**, never fully all-in;
- the frozen stress case must deduct the predeclared intermediary reserve in addition to adverse execution stress;
- even a 90-day economic pass cannot become `PROMOTION_ELIGIBLE_RESEARCH_ONLY` until the actual applicable intermediary schedule is independently verified or a separately frozen conservative all-in cost rule is justified before the forward start.

## 4. Capital/risk gate

- Spot is fully cash-funded. No spot financing, margin borrowing, borrowing credit or cash yield is assumed.
- Perpetual collateral reserve is separate from the spot purchase.
- Whole perpetual contracts only, 0.01 BTC each.
- Equal BTC units on spot and perpetual legs.
- Target notional remains 20% of starting equity per leg with a 25% actual-notional cap.
- No rebalancing, compounding, funding threshold, direction switching or asset selection.
- Displayed depth failure blocks economics.
- Positive funding alone is insufficient: it must exceed basis movement plus all modeled execution/fee costs.

## 5. Evidence-speed gate

If Trial 9 becomes freeze-eligible:

- 7 days: viability screen only; cannot promote or retune Trial 9;
- 30 days: strongest result `PROMISING_FORWARD_30D_ONLY`;
- 90 days: first possible promotion-eligible research classification, subject to fee verification and all frozen consistency/risk gates.

A failed 7-day or 30-day frozen result is recorded as failure. A changed economic specification requires a new trial number.
