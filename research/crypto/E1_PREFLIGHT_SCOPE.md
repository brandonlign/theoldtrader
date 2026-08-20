# E1 five-minute load preflight

This preflight is engineering-only. It exists solely to answer whether the frozen three-product Coinbase public microstructure recorder is operationally reasonable to run for seven days.

The five-minute outputs:

- may be used for compressed-byte-rate, process-exit, parse-error, reconnect, and gross message-volume diagnostics;
- may **not** be evaluated for maker fill rate, markout, spread, execution savings, product ranking, time-of-day selection, or any strategy/economic claim;
- may not change the frozen E1 queue/fill/TTL/notional rules;
- may justify only operational changes that do not alter recorded market semantics (for example disk allocation or service supervision).

The scientific E1 result still requires the preregistered 168-hour BTC-USD + ETH-USD + SOL-USD forward recording and its existing coverage/sequence gates.