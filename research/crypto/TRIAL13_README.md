# Trial 13 — CME BFF + IBIT forward carry

Research/paper only. No real-money trading path is added.

Authoritative manifest: `research/crypto/manifests/cme-bff-ibit-carry-v1.json`.

The trial holds a fixed BTC-equivalent IBIT hedge and shorts one 0.02-BTC CME Bitcoin Friday Future, rolling deterministically to the next listed BFF. The experiment begins with the 2026-08-21 official settlement and is evaluated prospectively after 4, 13 and 26 completed rolls under frozen primary/stress costs and margin gates.

Evidence commands:

```bash
node --test research/crypto/trial13.test.mjs
node research/crypto/trial13-record.mjs --date=YYYY-MM-DD
node research/crypto/trial13-risk-record.mjs --date=YYYY-MM-DD
node research/crypto/trial13-evaluate.mjs
```

The GitHub workflow `trial13-cme-bff-ibit-forward.yml` schedules official-source acquisition after the New York close, retries delayed Friday publication over the weekend, commits only `research/crypto/evidence/trial13/**`, and refuses to turn research evidence into live trading.

Do not alter Trial 13 economics after the first scientific observation. Any economic change after that boundary requires a new trial identity.
