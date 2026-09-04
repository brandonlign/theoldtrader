#!/usr/bin/env python3
"""Compatibility entrypoint for the already-frozen Trial 3 universe builder.

The frozen builder was committed with two mechanical Python/URL compatibility
issues that are unrelated to the frozen data-selection, ranking, threshold, or
economic rules:

1. its JSON payload used the JavaScript spelling ``false`` instead of Python's
   ``False``;
2. Binance Vision's historical symbol listing now contains at least one Unicode
   symbol name. ``urllib.request.Request`` requires a URL whose path is already
   ASCII-safe, while the frozen builder interpolates the historical symbol into
   the path verbatim.

This entrypoint supplies only those compatibility translations and executes the
frozen builder unchanged. Unicode path segments are percent-encoded without
changing the symbol identity or candidate set.
"""

import builtins
import runpy
import urllib.parse
import urllib.request
from pathlib import Path

builtins.false = False

_original_request = urllib.request.Request


def _ascii_safe_request(url, *args, **kwargs):
    if isinstance(url, str):
        parts = urllib.parse.urlsplit(url)
        encoded_path = urllib.parse.quote(parts.path, safe="/%:@")
        url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, encoded_path, parts.query, parts.fragment))
    return _original_request(url, *args, **kwargs)


urllib.request.Request = _ascii_safe_request
runpy.run_path(
    str(Path(__file__).with_name("form-cross-sectional-universe.py")),
    run_name="__main__",
)
