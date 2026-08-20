# Trial 9 development result — NO-GO

Decision time: 2026-08-20 UTC

Candidate: `bitnomial-internal-carry-v1` (Trial 9)

Status: **DEVELOPMENT NO-GO — DO NOT FREEZE OR START FORWARD COLLECTION**

## Predeclared gate

Before the bounded liquidity probe was observed, `TRIAL9_DEVELOPMENT_GATES.md` required both Bitnomial `BTCUSD` spot and the BTC perpetual to produce at least one two-sided book during a clean 120-second probe. A product that remained one-sided for the entire probe was explicitly defined as a development no-go, not grounds to substitute last price, hidden liquidity, or a wider execution model.

## Observed non-economic probe

GitHub Actions `Trial 9 Liquidity Probe` run 32334420242 sampled the public Bitnomial book feed for 120 seconds without exposing prices, funding, basis, or P&L.

- `BTCUSD` spot: 13 snapshots; two-sided fraction **0.00**; empty-side fraction **1.00**.
- `BTCUSD` 0.01 BTC: BUY executable fraction **0.00**, SELL executable fraction **0.00**, both executable **0.00**.
- `BTCUSD` 0.02 BTC: BUY executable fraction **0.00**, SELL executable fraction **0.00**, both executable **0.00**.
- `PBTCUCZ50` perpetual: 13 snapshots; two-sided fraction **1.00**; both 0.01 and 0.02 BTC executable on both sides in **1.00** of snapshots.
- No malformed snapshots were accepted.

The earlier public-connectivity run independently saw the same asymmetry: the perpetual was two-sided while BTCUSD spot remained one-sided throughout the 20-second timeout.

## Decision

Trial 9 fails its predeclared displayed-liquidity gate. It will not be frozen, forward-recorded, promoted, or rescued by changing execution assumptions. The low published Bitnomial spot fee is irrelevant if the public displayed spot book does not support the minimum executable hedge.

Any future Bitnomial spot/perpetual attempt would require a new trial number and genuinely new evidence that the spot market's displayed liquidity regime has changed; it may not reinterpret this Trial 9 result.

## Research implication

The Bitnomial perpetual itself appears operationally usable at the tested retail sizes. The failed component is the same-exchange spot hedge. Follow-up research should therefore prioritize either:

1. a different hedge instrument/venue whose execution is independently observable and legally accessible, with all-in costs modeled; or
2. the separate dated-future/perpetual relative-value concept, recognizing that margin efficiency is not alpha and term-basis risk must be modeled explicitly.

This is a negative result and is retained as such.