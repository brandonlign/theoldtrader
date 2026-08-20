# Trial 10 development result — NO-GO

Candidate: Bitnomial dated BTC future / BTC perpetual relative value.

Status: **DEVELOPMENT NO-GO — DO NOT FREEZE ECONOMICS OR START FORWARD COLLECTION**

## Predeclared selection and gate

Before observing the feasibility result, `TRIAL10_RESEARCH_NOTE.md` required:

- select the earliest active 0.01 BTC `BUC` dated future with 60–180 days remaining using expiry only;
- pair it with the 0.01 BTC `PBTCUC` perpetual resolved from first-party funding history;
- require both products to produce at least one two-sided public top-10 book snapshot during a 120-second probe;
- require one whole 0.01 BTC contract to be executable on both BUY and SELL from displayed depth;
- expose no prices, funding rates, dated/perpetual basis, or P&L during the probe.

A product remaining one-sided for the full probe was explicitly a no-go. The rules did not permit switching expiries after observing liquidity.

## Observed probe

GitHub Actions `Trial 10 Term Carry Liquidity Probe` run 32373936491 selected, by the frozen expiry-only rule:

- dated future: `BUCV26`, product_id 6297, final settlement 2026-10-30T15:00:00Z, 71.07 days remaining;
- perpetual: `PBTCUCZ50`, product_id 5614.

Over 120 seconds:

- `BUCV26`: 13 snapshots, two-sided fraction **0.00**, empty-side fraction **1.00**, one-contract BUY/SELL/both executable fractions all **0.00**;
- `PBTCUCZ50`: 13 snapshots, two-sided fraction **1.00**, one-contract BUY/SELL/both executable fractions all **1.00**;
- malformed snapshot fraction was 0 for both products.

No price, funding, basis, or P&L result was used in this decision.

## Decision

Trial 10 fails its predeclared displayed-liquidity gate. It will not be rescued by selecting a different dated expiry, assuming hidden liquidity, substituting last price, widening the execution model, or using the 98% clearing spread credit as a proxy for tradability.

The result reinforces a consistent Bitnomial finding from Trials 9–10: the BTC perpetual has usable displayed liquidity at the tested retail size, while the tested same-stack hedge legs (spot and the predeclared dated future) do not.

Any future same-exchange Bitnomial hedge attempt requires a new trial number and a genuinely different ex-ante instrument-selection rule or evidence that the liquidity regime changed.