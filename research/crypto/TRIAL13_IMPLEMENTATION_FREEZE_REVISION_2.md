# Trial 13 implementation freeze revision 2

Frozen prospectively at 2026-08-20T15:04:44Z, before the first Trial 13 scientific settlement on 2026-08-21 and before any Trial 13 economic result was observed.

Revision 2 retains all revision-1 corrections and adds one data/accounting requirement needed to make the carry test scientifically interpretable rather than directionally confounded.

BlackRock's official IBIT page publishes both the daily **Basket Amount** in USD and **Basket Bitcoin Amount**. Their ratio reconstructs that day's BRRNY benchmark used by IBIT. Trial 13 now requires both fields from the same official as-of date and records:

`BRRNY = Basket Amount / Basket Bitcoin Amount`.

The frozen basis-carry component for each completed BFF week is therefore measured independently of Bitcoin direction as:

`0.02 BTC × (frozen adverse BFF short entry price - official opening BRRNY) - frozen BFF opening/expiration fee reserves`.

Actual IBIT share-price P&L remains the hedge leg in total strategy P&L, so tracking error, fixed-share hedge drift, premiums/discounts and the sponsor fee already embedded in IBIT prices remain real residuals rather than being silently assumed away.

This revision was made before any Trial 13 price, basis, return or P&L observation. It is not a response to an observed result. After the first 2026-08-21 scientific settlement, the benchmark decomposition is locked by the anti-rescue rule.
