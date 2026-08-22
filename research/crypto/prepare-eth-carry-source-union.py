#!/usr/bin/env python3
"""Build Trial 17 ETH carry input from checksum-verified Binance Vision sources.

Frozen before any Trial 17 ETH carry economics. This reuses the already-audited
Trial 2/2U acquisition/parsing helpers, changing only the predeclared symbol and
window. Monthly and daily mark-price archives are independently checksum-verified;
overlap disagreement or any missing 8-hour boundary fails closed. No interpolation.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SYMBOL = "ETHUSDT"
EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
MANIFEST = Path("research/crypto/manifests/funding-carry-eth-v1.json")


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare-eth-carry-source-union.py <out.csv> <sources.json>")
    out = Path(sys.argv[1])
    sources_out = Path(sys.argv[2])
    if out.exists() or sources_out.exists():
        raise RuntimeError("Trial 17 output already exists; refusing overwrite")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "funding-carry-eth-v1" or manifest.get("trialNumber") != 17:
        raise RuntimeError("Wrong Trial 17 manifest")
    if manifest.get("status") != "FROZEN_PRE_EVALUATION":
        raise RuntimeError("Trial 17 manifest is not frozen pre-evaluation")
    if manifest["evaluationWindow"].get("ethCarryEconomicsObservedAtFreeze") is not False:
        raise RuntimeError("Trial 17 ETH economics were not sealed at freeze")
    if manifest["candidate"].get("symbol") != SYMBOL or manifest["dataRequirements"].get("symbol") != SYMBOL:
        raise RuntimeError("Trial 17 ETH symbol drift")

    start_iso = manifest["evaluationWindow"]["startInclusive"]
    end_iso = manifest["evaluationWindow"]["endExclusive"]
    start_ms = int(datetime.fromisoformat(start_iso.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end_iso.replace("Z", "+00:00")).timestamp() * 1000)
    tolerance = int(manifest["dataRequirements"]["fundingTimestampNormalization"]["maximumAbsoluteSkewMs"])

    core = load("trial17_core_acquisition", "research/crypto/prepare-carry-data.py")
    union = load("trial17_union_acquisition", "research/crypto/prepare-carry-data-source-union.py")
    core.SYMBOL = SYMBOL
    union.SYMBOL = SYMBOL
    if tolerance != core.FUNDING_SKEW_TOLERANCE_MS:
        raise RuntimeError("Trial 17 funding timestamp tolerance drift")

    days = list(core.day_range(start_ms, end_ms))
    months = list(core.month_range(start_ms, end_ms))
    spot, spot_sources = core.download_many("spot_daily", days, start_ms, end_ms, tolerance)
    perp_exec, perp_sources = core.download_many("perp_monthly", months, start_ms, end_ms, tolerance)
    funding, funding_sources = core.download_many("funding_monthly", months, start_ms, end_ms, tolerance)
    monthly_marks, monthly_sources = union.download_mark_family("monthly", months, start_ms, end_ms)
    daily_marks, daily_sources = union.download_mark_family("daily", days, start_ms, end_ms)

    funding_times = sorted(funding)
    expected_rows = (end_ms - start_ms) // EIGHT_HOURS_MS
    if len(funding_times) != expected_rows:
        raise RuntimeError(f"ETH funding row count mismatch: observed={len(funding_times)}, expected={expected_rows}")
    if not funding_times or funding_times[0] != start_ms or funding_times[-1] != end_ms - EIGHT_HOURS_MS:
        raise RuntimeError("ETH funding grid endpoints do not match frozen window")
    for previous, current in zip(funding_times, funding_times[1:]):
        if current - previous != EIGHT_HOURS_MS:
            raise RuntimeError("ETH funding grid is not an exact 8-hour sequence")

    overlap = set(monthly_marks) & set(daily_marks)
    mismatches = sorted(t for t in overlap if monthly_marks[t] != daily_marks[t])
    if mismatches:
        raise RuntimeError(f"ETH monthly/daily mark overlap mismatch count={len(mismatches)}")
    mark_union = dict(monthly_marks)
    for timestamp, value in daily_marks.items():
        mark_union.setdefault(timestamp, value)

    missing_spot = [t for t in funding_times if t not in spot]
    missing_perp = [t for t in funding_times if t not in perp_exec]
    missing_mark = [t for t in funding_times if t not in mark_union]
    if missing_spot or missing_perp or missing_mark:
        raise RuntimeError(
            "Trial 17 exact synchronization failed: "
            f"spot={len(missing_spot)} perp={len(missing_perp)} mark={len(missing_mark)}"
        )

    synchronized = [(t, funding[t], spot[t], perp_exec[t], mark_union[t]) for t in funding_times]
    out.parent.mkdir(parents=True, exist_ok=True)
    core.write_csv(out, synchronized)
    input_sha = hashlib.sha256(out.read_bytes()).hexdigest()

    source_rows = []
    for source in spot_sources + perp_sources + funding_sources:
        source_rows.append(source.__dict__ if hasattr(source, "__dict__") else source)
    source_rows += monthly_sources + daily_sources
    source_manifest = {
        "experimentId": "funding-carry-eth-v1",
        "trialNumber": 17,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "frozenAt": manifest["frozenAt"],
        "symbol": SYMBOL,
        "window": {"startInclusive": start_iso, "endExclusive": end_iso},
        "inputSha256": input_sha,
        "coverage": {
            "expectedBoundaryRows": expected_rows,
            "synchronizedRows": len(synchronized),
            "monthlyMarkRows": len(monthly_marks),
            "dailyMarkRows": len(daily_marks),
            "overlapRows": len(overlap),
            "overlapMismatchCount": len(mismatches),
            "missingSpotRows": len(missing_spot),
            "missingPerpRows": len(missing_perp),
            "missingMarkRows": len(missing_mark),
            "dailyMarkArchivesMissing": sum(1 for item in daily_sources if not item.get("available")),
            "unionRows": len(mark_union)
        },
        "sourceFiles": source_rows,
        "rules": {
            "checksumsRequired": True,
            "noInterpolation": True,
            "monthlyDailyMarkOverlapMustAgreeExactly": True
        }
    }
    sources_out.parent.mkdir(parents=True, exist_ok=True)
    sources_out.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "TRIAL17_ETH_SOURCE_UNION_PASS",
        "symbol": SYMBOL,
        "inputSha256": input_sha,
        "coverage": source_manifest["coverage"]
    }, indent=2))


if __name__ == "__main__":
    main()
