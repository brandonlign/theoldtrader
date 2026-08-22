# funding-carry-v1R-api — result observed

**Observation status:** first full official-REST replication result was observed on 2026-08-12 after the frozen data gate passed.  
**Promotion eligibility:** none.  
**Replication of:** `funding-carry-v1`.  
**Primary checksum-archive Trial 2:** still unobserved / blocked by GitHub Actions billing.

## Scientific freeze after observation

The full REST replication used the already-frozen:

- 2021-05-01T00:00:00Z through 2026-03-01T00:00:00Z window;
- exactly 5,295 scheduled 8-hour boundaries;
- 15% starting-equity BTC spot purchase;
- short of exactly the same BTC units in BTCUSDT perpetual;
- 20% starting-equity futures collateral reserve;
- no rebalancing, funding threshold, funding-sign filter, entry-date selection, or leverage optimization;
- 60 bps fee/side + 5 bps slippage/side + 10 bps round-trip spread on both spot and perpetual legs;
- standard perpetual contract open as the entry/exit execution reference;
- mark-price open for funding notional, unrealized futures P&L, maintenance margin, and gap stress;
- funding at the entry boundary excluded;
- raw funding timestamp mapped to the nearest scheduled 8-hour boundary only within the frozen ±60-second tolerance;
- zero interpolation or forward-fill;
- +25%/+50%/+100% perpetual-mark gap stress and the frozen 5% maintenance-margin research assumption.

The local official-REST acquisition found a complete intersection: no scheduled spot, contract, mark, or normalized funding boundary was missing. Every raw REST response page was hashed and the synchronized CSV was hashed before economics were calculated.

## Result preservation / canonical reproduction status

The exact first-result metrics and local evidence bundle were produced in the originating research session. GitHub Actions is still unable to execute because the account's Actions billing/spending-limit block prevents checkout. Therefore this marker deliberately does **not** pretend that the repository's canonical evaluator/workflow has reproduced the local result yet.

When compute is restored, the repository must reproduce this replication from the frozen `funding-carry-v1R-api.json`, `prepare-carry-rest-api.py`, and `carry-evaluate-replication.js` specification. Any discrepancy is a provenance/implementation investigation; it is **not** permission to tune the economic candidate.

From this point onward, no economic or data-selection rule of 2R may be changed under the same replication ID. Reporting/serialization fixes may be made only if they do not alter fills, funding cash flows, prices, costs, sizing, margin logic, or the selected historical observations, and must be logged transparently.
