#!/usr/bin/env python3
"""Acquire the frozen Trial 16 confirmation window without interpolation.

Uses the already-audited Trial 2U Binance Vision source-union mechanics, but with
Trial 16's prospectively frozen 2026-03-01..2026-08-01 window.  This script does
not calculate economics.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
MANIFEST = Path("research/crypto/manifests/funding-carry-collateralized-v1.json")
SOURCE_UNION = Path("research/crypto/prepare-carry-data-source-union.py")
ORIGINAL = Path("research/crypto/prepare-carry-data.py")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to import {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    if len(sys.argv) != 5 or sys.argv[3] != "--confirm-final" or sys.argv[4] != "YES":
        raise SystemExit("usage: prepare-carry-collateralized-final.py <out.csv> <sources.json> --confirm-final YES")
    out_path = Path(sys.argv[1])
    source_path = Path(sys.argv[2])
    if out_path.exists() or source_path.exists():
        raise RuntimeError("Trial 16 confirmation output already exists; refusing overwrite")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "funding-carry-collateralized-v1" or manifest.get("trialNumber") != 16:
        raise RuntimeError("Wrong Trial 16 manifest")
    if manifest.get("status") != "FROZEN_PRE_FINAL" or manifest["confirmationWindow"].get("economicRowsObservedAtFreeze") is not False:
        raise RuntimeError("Trial 16 is not frozen pre-final")

    start = manifest["confirmationWindow"]["startInclusive"]
    end = manifest["confirmationWindow"]["endExclusive"]
    if start != "2026-03-01T00:00:00Z" or end != "2026-08-01T00:00:00Z":
        raise RuntimeError("Trial 16 confirmation boundary drift")
    start_ms = int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp() * 1000)

    original = load_module("trial16_original", ORIGINAL)
    union = load_module("trial16_union", SOURCE_UNION)
    tolerance = int(manifest["dataRequirements"]["fundingTimestampNormalization"]["maximumAbsoluteSkewMs"])
    if tolerance != original.FUNDING_SKEW_TOLERANCE_MS:
        raise RuntimeError("Funding timestamp normalization drift")

    days = list(original.day_range(start_ms, end_ms))
    months = list(original.month_range(start_ms, end_ms))
    spot, spot_sources = original.download_many("spot_daily", days, start_ms, end_ms, tolerance)
    perp_exec, perp_sources = original.download_many("perp_monthly", months, start_ms, end_ms, tolerance)
    funding, funding_sources = original.download_many("funding_monthly", months, start_ms, end_ms, tolerance)
    monthly_marks, monthly_sources = union.download_mark_family("monthly", months, start_ms, end_ms)
    daily_marks, daily_sources = union.download_mark_family("daily", days, start_ms, end_ms)

    funding_times = sorted(funding)
    expected_rows = (end_ms - start_ms) // EIGHT_HOURS_MS
    if len(funding_times) != expected_rows or not funding_times:
        raise RuntimeError(f"Trial 16 funding grid row mismatch: {len(funding_times)} != {expected_rows}")
    if funding_times[0] != start_ms or funding_times[-1] != end_ms - EIGHT_HOURS_MS:
        raise RuntimeError("Trial 16 funding grid endpoints mismatch")
    if any(funding_times[i] - funding_times[i-1] != EIGHT_HOURS_MS for i in range(1, len(funding_times))):
        raise RuntimeError("Trial 16 funding grid is not exact 8-hour cadence")

    overlap = set(monthly_marks) & set(daily_marks)
    mismatches = [t for t in overlap if monthly_marks[t] != daily_marks[t]]
    if mismatches:
        raise RuntimeError(f"Trial 16 monthly/daily mark overlap mismatch count={len(mismatches)}")
    marks = dict(monthly_marks)
    for timestamp, value in daily_marks.items():
        marks.setdefault(timestamp, value)

    missing_spot = [t for t in funding_times if t not in spot]
    missing_perp = [t for t in funding_times if t not in perp_exec]
    missing_mark = [t for t in funding_times if t not in marks]
    if missing_spot or missing_perp or missing_mark:
        raise RuntimeError(
            f"Trial 16 exact synchronization failed: spot={len(missing_spot)} perp={len(missing_perp)} mark={len(missing_mark)}"
        )

    synchronized = [(t, funding[t], spot[t], perp_exec[t], marks[t]) for t in funding_times]
    original.write_csv(out_path, synchronized)
    sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
    all_sources = spot_sources + perp_sources + funding_sources + monthly_sources + daily_sources
    metadata = {
        "experimentId": manifest["experimentId"],
        "trialNumber": 16,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "economicResultCalculated": False,
        "confirmationWindow": manifest["confirmationWindow"],
        "coverage": {
            "expectedBoundaryRows": expected_rows,
            "synchronizedRows": len(synchronized),
            "monthlyMarkRows": len(monthly_marks),
            "dailyMarkRows": len(daily_marks),
            "overlapRows": len(overlap),
            "overlapMismatchCount": len(mismatches),
            "unionRows": len(marks),
            "missingSpotRows": len(missing_spot),
            "missingPerpRows": len(missing_perp),
            "missingMarkRows": len(missing_mark),
            "dailyMarkArchivesMissing": sum(1 for item in daily_sources if not item.get("available")),
        },
        "synchronizedSha256": sha,
        "sources": all_sources,
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"experimentId": manifest["experimentId"], "rows": len(synchronized), "sha256": sha, "sourceUnionValid": True, "economicsCalculated": False}, indent=2))


if __name__ == "__main__":
    main()
