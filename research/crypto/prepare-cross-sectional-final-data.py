#!/usr/bin/env python3
"""Prepare the one-shot Trial 3 full/final dataset with frozen age provenance.

This wrapper is code only until the separately protected final workflow is
explicitly dispatched. It preserves the original frozen acquisition dates,
provides the deterministic-gzip compatibility required by the base builder, and
attaches the same checksum-verified first-observed Binance timestamps used by the
development path so ``asset_age_log_days`` has one identical definition in both
stages.

Final-holdout acquisition is itself protected: merely invoking the script is not
sufficient. The caller must pass ``--confirm-final YES`` before any manifest is
read or any network acquisition can begin.
"""

from __future__ import annotations

import gzip
import importlib.util
import json
import runpy
import sys
from pathlib import Path


def load_dev_helpers():
    path = Path(__file__).with_name("prepare-cross-sectional-development-data.py")
    spec = importlib.util.spec_from_file_location("trial3_development_data_helpers", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    if len(sys.argv) != 7 or sys.argv[5] != "--confirm-final" or sys.argv[6] != "YES":
        raise SystemExit(
            "usage: prepare-cross-sectional-final-data.py "
            "<manifest> <universe> <out.gz> <sources.json> --confirm-final YES"
        )

    manifest_path = Path(sys.argv[1])
    universe_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    sources_path = Path(sys.argv[4])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "cross-sectional-v1" or manifest.get("trialNumber") != 3:
        raise RuntimeError("Expected frozen cross-sectional-v1 Trial 3 manifest")
    if manifest.get("historicalData", {}).get("finalHoldoutStart") != "2026-01-01T00:00:00Z":
        raise RuntimeError("Unexpected Trial 3 final-holdout start")
    if manifest.get("historicalData", {}).get("finalHoldoutEndExclusive") != "2026-08-01T00:00:00Z":
        raise RuntimeError("Unexpected Trial 3 final-holdout end")

    helpers = load_dev_helpers()
    builder = Path(__file__).with_name("prepare-cross-sectional-data.py")
    original_argv = sys.argv[:]
    original_gzip_open = gzip.open

    def gzip_open_compat(filename, mode="rb", compresslevel=9, encoding=None, errors=None, newline=None, **kwargs):
        mtime = kwargs.pop("mtime", None)
        if kwargs:
            raise TypeError(f"Unexpected gzip.open arguments: {sorted(kwargs)}")
        if mtime is not None and "b" in mode:
            return gzip.GzipFile(filename=filename, mode=mode, compresslevel=compresslevel, mtime=mtime)
        return original_gzip_open(
            filename, mode, compresslevel=compresslevel,
            encoding=encoding, errors=errors, newline=newline,
        )

    try:
        gzip.open = gzip_open_compat
        sys.argv = [str(builder), str(manifest_path), str(universe_path), str(out_path), str(sources_path)]
        builder_globals = runpy.run_path(str(builder), run_name="__main__")
    finally:
        gzip.open = original_gzip_open
        sys.argv = original_argv

    helpers.attach_first_observations(out_path, sources_path, builder_globals)
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    if sources.get("firstObservationSourceCount") != 30:
        raise RuntimeError("Trial 3 final asset-age provenance is incomplete")

    print(json.dumps({
        "experimentId": "cross-sectional-v1",
        "mode": "final",
        "finalHoldoutStart": "2026-01-01T00:00:00Z",
        "finalHoldoutEndExclusive": "2026-08-01T00:00:00Z",
        "assetAgeMembersVerified": 30,
        "dataset": str(out_path),
        "sources": str(sources_path),
    }, indent=2))


if __name__ == "__main__":
    main()
