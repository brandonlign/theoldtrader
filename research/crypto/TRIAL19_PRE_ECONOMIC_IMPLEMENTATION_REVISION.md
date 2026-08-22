# Trial 19 pre-economic implementation revision

The first operational preflight failed before any ADAUSDT or DOGEUSDT derivative acquisition because the frozen branch referenced shared carry acquisition modules that were not present in that checkout. The causal Trial 19 synthetic evaluator test itself passed before this failure.

Before any Trial 19 funding, perpetual execution, mark, basis, or carry result was acquired or observed, the source builder was made self-contained by adding `research/crypto/lib/carry_source_union.py` and routing the frozen builder through that module.

This revision changes no Trial 19 asset, date, signal lookback, entry or exit threshold, hysteresis, minimum state duration, sizing, collateral, transaction cost, source requirement, margin stress, development gate, final gate, or accounting rule. The helper preserves the frozen checksum verification, exact 8-hour synchronization, funding timestamp tolerance, monthly/daily mark-source union, overlap-agreement requirement, and no-interpolation rule.
