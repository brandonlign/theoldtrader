# Crypto paper desk v2

This revision is a paper-trading methodology change, not evidence of profitability.

The crypto desk now:

- uses 15-minute candles by default to reduce five-minute churn;
- estimates round-trip friction from configured fees, slippage, and the live spread;
- rejects entries whose directional edge proxy does not clear the modeled cost by a configurable multiple;
- requires a positive slower market regime in addition to fast trend, momentum, RSI, volume, volatility, and breakout checks;
- sizes positions from a fixed account-risk budget and the effective stop distance instead of committing 20% of equity to every entry;
- caps one position at 15% of equity and total crypto exposure at 45% by default;
- applies a six-hour post-exit cooldown before re-entry;
- uses wider cost-aware stop, take-profit, and trailing-stop distances;
- caps displayed signal scores when mandatory gates fail, so a HOLD cannot display fake 100-confidence;
- records portfolio snapshots and aggregate performance statistics for dashboard plots.

The existing D1 ledger is intentionally preserved. Old trades remain visible so pre-v2 and post-v2 behavior can be compared rather than resetting a bad history.
