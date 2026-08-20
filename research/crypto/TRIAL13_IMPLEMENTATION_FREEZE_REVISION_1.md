# Trial 13 implementation freeze revision 1

Frozen prospectively at 2026-08-20T14:55:49Z, before the first Trial 13 scientific settlement on 2026-08-21 and before any Trial 13 economic result was observed.

Two implementation ambiguities in the initial manifest were corrected before observation:

1. **IBIT sponsor-fee accounting.** Observed IBIT share prices/NAV already reflect the trust's sponsor fee. The 0.25% annual sponsor-fee field remains documented, but it is not deducted a second time from observed share-price P&L. Double-charging it would be dimensionally/economically wrong.
2. **BFF holiday expiries.** CME specifies that Bitcoin Friday Futures terminate on the preceding day that is a business day in both London and the U.S. when the nominal Friday is not such a business day. The literal-Friday wording would therefore make the 26-week protocol impossible at Christmas 2026 and New Year 2027. Trial 13 now follows the official deterministic termination rule, with 2026-12-24 and 2026-12-31 registered prospectively as the two holiday-adjusted dates inside the planned window.

Neither correction uses or responds to strategy prices, basis, returns, P&L, or any Trial 13 outcome. All other economics, sizing, costs, collateral, shocks, checkpoints and anti-rescue rules remain unchanged.

The forward recorder preserves exact official CME and BlackRock responses (gzip-compressed) plus SHA-256 provenance. A separate daily CME settlement recorder is required for margin-path evidence; weekly endpoint marks alone are not sufficient to claim the frozen no-margin-breach gates.
