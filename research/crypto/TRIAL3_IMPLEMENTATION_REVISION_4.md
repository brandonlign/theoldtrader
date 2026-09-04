# Trial 3 implementation revision 4 — Unicode historical-symbol URL transport

Date: 2026-08-20  
Experiment: `cross-sectional-v1`  
Scientific state when corrected: **no Trial 3 universe, development return, or final return had been observed**.

## Failure observed

The frozen universe builder successfully enumerated 660 USDT candidate prefixes and processed 659 of them, then failed before universe formation because Binance Vision's current historical-prefix listing contains a Unicode symbol, `币安人生USDT`. The candidate's archive URL was interpolated verbatim into `urllib.request.Request`, whose HTTP path must be ASCII-safe. Python raised an ASCII codec error before it could issue the request.

This was a transport failure, not a missing-data decision or an economic result. No universe file was produced and no post-2022 Trial 3 data were accessed.

## Correction

The compatibility entrypoint now percent-encodes URL path segments before constructing `urllib.request.Request`. The Unicode symbol identity, historical prefix enumeration, 2022-only formation window, stable/fiat/leveraged-token exclusions, minimum-bar rule, liquidity measure, lexicographic tie-break, and 30-member target are unchanged.

A symbol with no 2022 archive therefore reaches the already-frozen HTTP-404/missing-month handling instead of aborting the entire universe. A symbol with a valid 2022 archive is evaluated under the same checksum and ranking rules as every ASCII-named candidate.

## Scientific interpretation

This is a pre-result source-transport compatibility correction. It does not remove the Unicode candidate, substitute a survivor, alter ranking, inspect post-formation performance, or change any strategy parameter. Any outcome-driven universe change after formation requires a new trial identity.
