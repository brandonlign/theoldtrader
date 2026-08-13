#!/usr/bin/env python3
"""Prepare Trial 3 development data without acquiring the final holdout.

The frozen candidate dates are unchanged.  This wrapper strengthens the holdout
firewall by running the already-authored checksum/archive builder against a
transient manifest whose acquisition end is the frozen development end
(2026-01-01).  No 2026-01-01-or-later Trial 3 price row is requested during
ordinary development evaluation.  The final holdout remains reserved for the
separate one-shot final workflow.
"""

from __future__ import annotations

import json
import runpy
import sys
import tempfile
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: prepare-cross-sectional-development-data.py "
            "<manifest> <universe> <out.gz> <sources.json>"
        )

    manifest_path = Path(sys.argv[1])
    universe_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    sources_path = Path(sys.argv[4])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "cross-sectional-v1" or manifest.get("trialNumber") != 3:
        raise RuntimeError("Expected frozen cross-sectional-v1 Trial 3 manifest")

    historical = manifest.get("historicalData") or {}
    development_end = historical.get("developmentEndExclusive")
    final_start = historical.get("finalHoldoutStart")
    final_end = historical.get("finalHoldoutEndExclusive")
    if development_end != final_start:
        raise RuntimeError("Frozen development end must equal frozen final-holdout start")
    if not development_end or not final_end or development_end >= final_end:
        raise RuntimeError("Invalid frozen Trial 3 development/final date ordering")

    acquisition_manifest = json.loads(json.dumps(manifest))
    acquisition_manifest["historicalData"]["finalHoldoutEndExclusive"] = development_end
    acquisition_manifest["developmentAcquisitionOnly"] = True
    acquisition_manifest["originalFinalHoldoutEndExclusive"] = final_end

    builder = Path(__file__).with_name("prepare-cross-sectional-data.py")
    with tempfile.TemporaryDirectory(prefix="moneymog-trial3-dev-") as tmp:
        transient = Path(tmp) / "cross-sectional-v1-development-acquisition.json"
        transient.write_text(json.dumps(acquisition_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        original_argv = sys.argv[:]
        try:
            sys.argv = [str(builder), str(transient), str(universe_path), str(out_path), str(sources_path)]
            runpy.run_path(str(builder), run_name="__main__")
        finally:
            sys.argv = original_argv

    dataset_sources = json.loads(sources_path.read_text(encoding="utf-8"))
    coverage = dataset_sources.get("coverage") or {}
    forbidden = int(__import__("datetime").datetime.fromisoformat(development_end.replace("Z", "+00:00")).timestamp())
    for symbol, stats in coverage.items():
        last = stats.get("last")
        if last is None:
            continue
        last_sec = int(__import__("datetime").datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp())
        if last_sec >= forbidden:
            raise RuntimeError(f"Development acquisition crossed the final-holdout boundary for {symbol}: {last}")

    print(json.dumps({
        "experimentId": manifest["experimentId"],
        "developmentEndExclusive": development_end,
        "finalHoldoutStart": final_start,
        "finalHoldoutEndExclusive": final_end,
        "finalHoldoutRowsAcquired": 0,
        "dataset": str(out_path),
        "sources": str(sources_path),
    }, indent=2))


if __name__ == "__main__":
    main()
