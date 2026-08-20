# Trial 10 candidate note — Bitnomial dated-future / perpetual BTC relative value

Status: **development concept only; not frozen; no candidate result observed**

Candidate family: same-exchange BTC futures-term-structure / perpetual-funding relative value.

Proposed economic position for feasibility research:

- long one active 0.01 BTC Bitnomial `BUC` dated Bitcoin USD Centi future;
- short one 0.01 BTC Bitnomial `PBTCUC` perpetual future;
- equal BTC units; same exchange/clearing stack;
- no directional BTC target, no asset selection, no switching, no rebalancing.

Why investigate:

- both legs use the same 0.01 BTC contract size;
- Bitnomial Clearing currently publishes a 98% inter-commodity spread credit for `1 BUC vs. 1 PBTCUC`;
- the BTC perpetual public book passed the Trial 9 development liquidity probe at 0.01 and 0.02 BTC while Bitnomial spot failed, so replacing the failed spot leg with an actually listed dated future is operationally motivated rather than outcome-selected from Trial 8 economics.

Why this is **not** assumed profitable:

- spread margin credit is capital efficiency, not alpha;
- the dated future/perpetual basis can move materially before convergence/expiry;
- perpetual funding can be negative;
- a dated contract introduces expiry/roll mechanics and term-basis risk absent from Trial 8;
- any apparent historical spread can be consumed by fees, bid/ask, depth, or margin stress.

Before any Trial 10 freeze, require a non-economic public source/liquidity qualification that identifies an active BUC contract with sufficient remaining maturity and demonstrates two-sided displayed depth for both that dated future and PBTCUC at one whole contract. Do not inspect or rank funding/basis/P&L during feasibility qualification.

If source/liquidity qualification fails, Trial 10 is a development no-go. If it passes, the full economic specification must be frozen prospectively under a separate branch/manifest before any scored observation.