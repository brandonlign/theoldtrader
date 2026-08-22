# TheOldTrader crypto research — post-2R observation handoff

Date: 2026-08-12  
Branch: `research/crypto-oos-v1`  
Draft PR: #8

This addendum is newer than the carry section of `STATUS.md` and exists specifically so no later session mistakes the now-observed REST replication for an unobserved/mutable experiment.

## Safety state

- Frozen TheOldTrader crypto v2 execution code remains unchanged.
- No real-money order path exists in this research branch.
- PR changes remain restricted to research, tests, and research workflows.

## Trial 1 primary — unchanged

`crypto-oos-v1` Coinbase final holdout remains untouched. Ordinary push CI is validation-only. The final Coinbase evaluation is manual-only and overwrite-protected. GitHub Actions is still blocked before checkout by the account billing/spending-limit issue.

## Trial 1R — unchanged failure

`binance-btc-replication-v1` remains the failed directional robustness diagnostic. Do not rescue it by changing the hurdle, features, lambda, horizon, or v2 thresholds after the observed result.

## Trial 2 primary — still unobserved

`funding-carry-v1` is still the primary checksum-archive robustness protocol and has **not** been evaluated. Its frozen economics/data rules are unchanged:

- 15% starting-equity spot purchase;
- short exactly the same BTC units in the USD-M perpetual;
- 20% starting-equity futures collateral reserve;
- no rebalancing / funding threshold / sign filter / entry-date selection / leverage tuning;
- same frozen costs on both legs;
- standard contract open for perpetual entry/exit execution reference;
- markPrice open for funding notional, unrealized futures P&L, margin and stress;
- raw funding timestamp preserved and mapped to the nearest 8-hour UTC boundary only within ±60 seconds;
- exact 2021-05-01→2026-03-01 / 5,295 scheduled observations;
- no interpolation/forward-fill;
- entry-boundary funding excluded;
- frozen maintenance-margin and +25%/+50%/+100% mark-gap stress rules.

The primary checksum-archive workflow is manual-only and cannot run while Actions billing is blocked.

## Trial 2R — RESULT OBSERVED; LOCKED

`funding-carry-v1R-api` was frozen **before** its full download as an exact-family official Binance REST replication of Trial 2. It differs only in data delivery mechanism, not economics.

The full official REST acquisition subsequently passed the frozen hard data gate:

- exactly **5,295** scheduled 8-hour boundaries;
- missing spot observations: **0**;
- missing standard perpetual-contract observations: **0**;
- missing mark-price observations: **0**;
- missing normalized funding observations: **0**;
- no interpolation/forward-fill;
- every raw REST response page hashed;
- synchronized CSV hashed before the economic calculation.

The first complete 2R economic result was then observed in the originating session. **From that moment forward, 2R's dates, hedge units, allocation, costs, funding timing, margin rules, timestamp normalization, mark-vs-contract roles, data-gap rule, and source-selection rule are immutable.** Do not tune or rerun a changed version under `2R`.

The exact first-result metrics and evidence bundle were produced in the originating session. `results/funding-carry-v1R-api/OBSERVED.md` marks the anti-rescue boundary. The local frozen bundle includes the synchronized 5,295-row CSV, raw-page source/hash manifest, result summary, daily diagnostics, risk summary, comparison metrics, and equity/drawdown/funding/basis/margin/exposure plots.

2R is **never promotion eligible**. It cannot replace the primary checksum-archive Trial 2, and the primary would itself still be historical robustness/development evidence rather than pristine validation. Any eventual strategy promotion would additionally require a later untouched forward or independently sealed evaluation.

## Canonical 2R reproduction pending

The originating session evaluated the exact frozen REST sample outside GitHub Actions because Actions cannot start. The repository now contains:

- `manifests/funding-carry-v1R-api.json`
- `prepare-carry-rest-api.py`
- `carry-evaluate-replication.js`
- `carry-report-replication.js`
- `.github/workflows/crypto-carry-rest-replication.yml`

Once Actions is restored, that **manual one-shot** workflow must re-fetch/hash the official pages, require the exact grid, run the authoritative JS economics, regenerate the report bundle, and commit the canonical reproduction. It refuses overwrite.

If the canonical reproduction disagrees with the originating frozen evidence, investigate data serialization/provenance/implementation. **Do not tune the economic candidate to force agreement or improve the result.**

## E1 execution — still unobserved

`coinbase-maker-execution-v1` remains a frozen forward-data execution experiment. No scientific Coinbase maker recording has been observed. It still requires three independent BTC/ETH/SOL public feeds, >=168h/product, hash/coverage/sequence integrity, conservative queue simulation, independent raw-feed audit, full-book same-size taker VWAP, and all-three-product validation.

## Current decision boundary

No research result authorizes modification or promotion of live v2. The next legitimate work is:

1. canonical reproduction of already-observed 2R once compute is available;
2. primary checksum-archive Trial 2 without changing its frozen rules;
3. primary Coinbase Trial 1 final holdout without changing Trial 1;
4. forward E1 execution recording under the already-frozen protocol;
5. only then, if evidence motivates it, a **new numbered** strategy/execution successor frozen before evaluation.
