# Trial 3 freeze marker — `cross-sectional-v1`

Frozen: 2026-08-12, **before the 2022 liquidity universe was formed and before any 2023+ Trial 3 development/holdout data were inspected**.

Trial number: **3**  
Family: low-turnover cross-sectional spot expected-return selection  
Live promotion: **disabled**

The authoritative specification is `manifests/cross-sectional-v1.json`.

## Pre-development firewall

Trial 3 has a two-stage data firewall:

1. Form a static 30-symbol Binance spot USDT universe from **2022 information only** using the frozen rule.
2. Commit/hash that membership and its formation source manifest.
3. Only after that commit may Trial 3 code acquire 2023–2026 development/final data.

The formation job must enumerate historical Binance Vision symbol prefixes rather than beginning from today's exchange symbol list. This is intended to avoid selecting only coins known in hindsight to survive through the final holdout.

## Frozen formation rule

- candidate quote: USDT;
- deterministic stable/fiat and leveraged-token exclusions from the manifest;
- checksum-verified monthly Binance Vision 1d archives from 2022 only;
- at least 180 valid daily bars in 2022;
- final observed bar on/after 2022-12-30;
- rank by median 2022 daily quote-asset volume;
- lexicographic symbol tie-break;
- select exactly top 30;
- preserve the full eligible ranking and every source archive hash;
- any network/checksum/parse failure for a candidate aborts formation rather than silently changing the universe;
- membership becomes immutable after formation.

## Frozen candidate after membership is formed

- monthly rebalance at the first available UTC daily open;
- features strictly through the prior day only;
- six deliberately small features: 30d momentum, 90d momentum, 30d realized volatility, log median 30d quote volume, 30d Amihud illiquidity, log asset age;
- 5th/95th cross-sectional winsorization + cross-sectional z-score using that rebalance's eligible assets only;
- pooled ridge regression, lambda 10;
- expanding monthly panel; minimum 12 training months;
- one full monthly embargo;
- predict next-month gross log return;
- hold at most top three predicted assets whose predicted gross return exceeds the frozen 140 bps round-trip cost;
- 15% target per selected asset, max 45% total crypto exposure, 25% cash reserve;
- same conservative 60 bps fee/side + 5 bps slippage/side + 10 bps round-trip spread assumption;
- no out-of-universe replacements;
- frozen missing/delisting rule from the manifest;
- development: 2023–2025, with expanding six-month OOS folds after the 12-month minimum history;
- final untouched holdout: 2026-01-01 through 2026-08-01;
- final holdout evaluated once.

Comparators and promotion rules are frozen in the manifest. In particular, changing the universe rule/size, features, lambda, selected-asset count, cost gate, rebalance frequency, dates, or sizing after observing the final holdout requires a **new numbered alpha trial**.

This trial is independent of observed carry replication 2R. No 2R outcome is used as a feature, threshold, or selection rule for Trial 3.
