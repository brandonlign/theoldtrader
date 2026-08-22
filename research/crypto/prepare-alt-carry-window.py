#!/usr/bin/env python3
"""Acquire one frozen Trial 17 ETH/SOL carry window without economics."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
BASE_BUILDER = Path("research/crypto/prepare-carry-data.py")
UNION_BUILDER = Path("research/crypto/prepare-carry-data-source-union.py")
FINAL_GATE = Path("research/crypto/results/alt-carry-basket-v1-development/gate.json")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to import {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    if len(sys.argv) < 6:
        raise SystemExit("usage: prepare-alt-carry-window.py <manifest> <development|final> <symbol> <out.csv> <sources.json> [--confirm-final YES]")
    manifest_path = Path(sys.argv[1]); mode = sys.argv[2]; symbol = sys.argv[3]
    out_path = Path(sys.argv[4]); source_path = Path(sys.argv[5])
    if mode not in {"development", "final"}:
        raise RuntimeError("mode must be development or final")
    if out_path.exists() or source_path.exists():
        raise RuntimeError("Trial 17 output already exists; refusing overwrite")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "alt-carry-basket-v1" or manifest.get("trialNumber") != 17 or manifest.get("status") != "FROZEN_PRE_DEVELOPMENT":
        raise RuntimeError("Expected frozen pre-development Trial 17 manifest")
    if symbol not in manifest["assetSelection"]["symbols"]:
        raise RuntimeError(f"Symbol {symbol} is outside frozen Trial 17 asset set")

    if mode == "development":
        window = manifest["developmentWindow"]
        if "--confirm-final" in sys.argv:
            raise RuntimeError("Final confirmation flag is forbidden in development mode")
    else:
        if len(sys.argv) != 8 or sys.argv[6] != "--confirm-final" or sys.argv[7] != "YES":
            raise RuntimeError("Final acquisition requires exact --confirm-final YES")
        if not FINAL_GATE.exists():
            raise RuntimeError("Trial 17 final gate marker is absent")
        gate = json.loads(FINAL_GATE.read_text(encoding="utf-8"))
        if gate.get("experimentId") != manifest["experimentId"] or gate.get("developmentGatePass") is not True:
            raise RuntimeError("Trial 17 development did not authorize final access")
        window = manifest["finalHoldout"]

    start = window["startInclusive"]; end = window["endExclusive"]
    start_ms = int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp() * 1000)
    tolerance = int(manifest["dataRequirements"]["fundingTimestampNormalizationMaximumAbsoluteSkewMs"])
    if tolerance != 60_000:
        raise RuntimeError("Trial 17 funding timestamp tolerance drift")

    original = load_module(f"trial17_base_{symbol.lower()}", BASE_BUILDER)
    union = load_module(f"trial17_union_{symbol.lower()}", UNION_BUILDER)
    original.SYMBOL = symbol
    union.SYMBOL = symbol

    days = list(original.day_range(start_ms, end_ms)); months = list(original.month_range(start_ms, end_ms))
    spot, spot_sources = original.download_many("spot_daily", days, start_ms, end_ms, tolerance)
    perp, perp_sources = original.download_many("perp_monthly", months, start_ms, end_ms, tolerance)
    funding, funding_sources = original.download_many("funding_monthly", months, start_ms, end_ms, tolerance)
    monthly_marks, monthly_sources = union.download_mark_family("monthly", months, start_ms, end_ms)
    daily_marks, daily_sources = union.download_mark_family("daily", days, start_ms, end_ms)

    times = sorted(funding); expected_rows = (end_ms - start_ms) // EIGHT_HOURS_MS
    if len(times) != expected_rows or not times or times[0] != start_ms or times[-1] != end_ms - EIGHT_HOURS_MS:
        raise RuntimeError(f"{symbol} funding grid does not exactly cover frozen {mode} window")
    if any(times[i] - times[i-1] != EIGHT_HOURS_MS for i in range(1, len(times))):
        raise RuntimeError(f"{symbol} funding grid is not exact 8-hour cadence")

    overlap = set(monthly_marks) & set(daily_marks)
    mismatch = [t for t in overlap if monthly_marks[t] != daily_marks[t]]
    if mismatch:
        raise RuntimeError(f"{symbol} monthly/daily mark overlap mismatch count={len(mismatch)}")
    marks = dict(monthly_marks)
    for timestamp, value in daily_marks.items(): marks.setdefault(timestamp, value)
    missing_spot = [t for t in times if t not in spot]
    missing_perp = [t for t in times if t not in perp]
    missing_mark = [t for t in times if t not in marks]
    if missing_spot or missing_perp or missing_mark:
        raise RuntimeError(f"{symbol} exact synchronization failed spot={len(missing_spot)} perp={len(missing_perp)} mark={len(missing_mark)}")

    synchronized = [(t, funding[t], spot[t], perp[t], marks[t]) for t in times]
    original.write_csv(out_path, synchronized)
    sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
    sources = spot_sources + perp_sources + funding_sources + monthly_sources + daily_sources
    metadata = {
        "experimentId": manifest["experimentId"], "trialNumber": 17, "mode": mode, "symbol": symbol,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "economicResultCalculated": False,
        "window": {"startInclusive": start, "endExclusive": end},
        "coverage": {
            "expectedBoundaryRows": expected_rows, "synchronizedRows": len(synchronized),
            "monthlyMarkRows": len(monthly_marks), "dailyMarkRows": len(daily_marks),
            "overlapRows": len(overlap), "overlapMismatchCount": len(mismatch), "unionRows": len(marks),
            "missingSpotRows": len(missing_spot), "missingPerpRows": len(missing_perp), "missingMarkRows": len(missing_mark),
            "dailyMarkArchivesMissing": sum(1 for item in daily_sources if not item.get("available"))
        },
        "synchronizedSha256": sha,
        "sources": sources
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"experimentId": manifest["experimentId"], "mode": mode, "symbol": symbol, "rows": len(synchronized), "sha256": sha, "economicsCalculated": False}, indent=2))


if __name__ == "__main__": main()
