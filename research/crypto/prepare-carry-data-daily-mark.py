#!/usr/bin/env python3
"""Build Trial 2D synchronized carry input using daily markPrice archives uniformly.

This is a source-only replication of frozen funding-carry-v1. The frozen base
manifest supplies every economic rule. The only source difference is that the
perpetual mark-price series comes from checksum-verified DAILY Binance Vision
8h markPriceKlines for the full window rather than MONTHLY archives.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

BASE_SCRIPT = Path("research/crypto/prepare-carry-data.py")
BASE_MANIFEST = Path("research/crypto/manifests/funding-carry-v1.json")
REPLICATION_MANIFEST = Path("research/crypto/manifests/funding-carry-v1D-daily-mark.json")
DEFAULT_OUT = Path("research/crypto/data-cache/funding-carry-v1D-daily-mark-synchronized.csv")
DEFAULT_SOURCES = Path("research/crypto/data-cache/funding-carry-v1D-daily-mark-sources.json")


def git_blob_sha1(payload: bytes) -> str:
    header = f"blob {len(payload)}\0".encode("ascii")
    return hashlib.sha1(header + payload).hexdigest()


def load_base_module():
    spec = importlib.util.spec_from_file_location("trial2_base_prepare", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load frozen Trial 2 data builder")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    source_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SOURCES

    replication = json.loads(REPLICATION_MANIFEST.read_text(encoding="utf-8"))
    base_bytes = BASE_MANIFEST.read_bytes()
    base = json.loads(base_bytes)
    expected_blob = replication["baseManifest"]["gitBlobSha"]
    observed_blob = git_blob_sha1(base_bytes)
    if observed_blob != expected_blob:
        raise RuntimeError(f"Frozen base manifest blob mismatch: expected {expected_blob}, observed {observed_blob}")
    if replication.get("experimentId") != "funding-carry-v1D-daily-mark":
        raise RuntimeError("Unexpected Trial 2D replication manifest")
    if replication.get("status") != "FROZEN_SOURCE_REPLICATION_BEFORE_ANY_TRIAL2D_ECONOMICS":
        raise RuntimeError("Trial 2D replication is not in the frozen pre-economics state")
    if base.get("experimentId") != "funding-carry-v1" or base.get("status") != "FROZEN_DATA_ACQUISITION_PENDING":
        raise RuntimeError("Unexpected frozen Trial 2 base manifest")

    mod = load_base_module()
    original_urls = mod.urls

    def replication_urls(kind: str, period: str):
        if kind == "mark_daily":
            relative = f"data/futures/um/daily/markPriceKlines/{mod.SYMBOL}/{mod.INTERVAL}/{mod.SYMBOL}-{mod.INTERVAL}-{period}.zip"
            url = mod.BASE + relative
            return url, url + ".CHECKSUM"
        return original_urls(kind, period)

    # Reuse the frozen Trial 2 checksum, parsing, timestamp-normalization and
    # concurrency implementation. Only URL resolution for mark_daily is added.
    mod.urls = replication_urls

    window = base["historicalRobustnessWindow"]
    start_ms = int(datetime.fromisoformat(window["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(window["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    tolerance = int(base["dataRequirements"]["fundingTimestampNormalization"]["maximumAbsoluteSkewMs"])
    if tolerance != mod.FUNDING_SKEW_TOLERANCE_MS:
        raise RuntimeError("Trial 2D/base funding tolerance mismatch")

    days = list(mod.day_range(start_ms, end_ms))
    months = list(mod.month_range(start_ms, end_ms))
    spot, spot_sources = mod.download_many("spot_daily", days, start_ms, end_ms, tolerance)
    perp_exec, perp_exec_sources = mod.download_many("perp_monthly", months, start_ms, end_ms, tolerance)
    perp_mark, mark_sources = mod.download_many("mark_daily", days, start_ms, end_ms, tolerance)
    funding, funding_sources = mod.download_many("funding_monthly", months, start_ms, end_ms, tolerance)

    funding_times = sorted(funding)
    if len(funding_times) < 2:
        raise RuntimeError("Insufficient Trial 2D funding observations")
    irregular = [
        (funding_times[i - 1], funding_times[i])
        for i in range(1, len(funding_times))
        if funding_times[i] - funding_times[i - 1] != mod.EIGHT_HOURS_MS
    ]
    if irregular:
        sample = [(mod.iso_ms(a), mod.iso_ms(b)) for a, b in irregular[:5]]
        raise RuntimeError(f"Trial 2D funding grid irregular: {sample}")

    expected_first = start_ms
    expected_last = end_ms - mod.EIGHT_HOURS_MS
    expected_rows = (end_ms - start_ms) // mod.EIGHT_HOURS_MS
    if funding_times[0] != expected_first or funding_times[-1] != expected_last or len(funding_times) != expected_rows:
        raise RuntimeError(
            "Trial 2D funding grid does not cover full frozen window: "
            f"rows={len(funding_times)} expected={expected_rows} "
            f"first={mod.iso_ms(funding_times[0])} last={mod.iso_ms(funding_times[-1])}"
        )

    missing_spot = [t for t in funding_times if t not in spot]
    missing_exec = [t for t in funding_times if t not in perp_exec]
    missing_mark = [t for t in funding_times if t not in perp_mark]
    if missing_spot or missing_exec or missing_mark:
        raise RuntimeError(
            "Trial 2D exact scheduled-boundary synchronization failed; no interpolation permitted. "
            f"missing spot={len(missing_spot)}, perp_exec={len(missing_exec)}, daily_mark={len(missing_mark)}"
        )

    rows = [(t, funding[t], spot[t], perp_exec[t], perp_mark[t]) for t in funding_times]
    mod.write_csv(out_path, rows)
    synchronized_sha = mod.sha256_bytes(out_path.read_bytes())
    skews = [obs.skew_ms for obs in funding.values()]

    sources = spot_sources + perp_exec_sources + mark_sources + funding_sources
    source_manifest = {
        "experimentId": replication["experimentId"],
        "replicationOf": replication["replicationOf"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "baseManifestGitBlobSha": observed_blob,
        "replicationManifestSha256": mod.sha256_bytes(REPLICATION_MANIFEST.read_bytes()),
        "officialArchiveBase": mod.BASE,
        "symbol": mod.SYMBOL,
        "interval": mod.INTERVAL,
        "frozenWindow": window,
        "sourceDifference": "DAILY Binance Vision USD-M 8h markPriceKlines used uniformly for every day in the entire window",
        "spotSource": "daily Binance Vision 8h spot klines (unchanged from Trial 2)",
        "perpetualExecutionSource": "monthly Binance Vision USD-M standard 8h klines (unchanged from Trial 2)",
        "perpetualMarkSource": "daily Binance Vision USD-M 8h markPriceKlines (Trial 2D source replication)",
        "fundingSource": "monthly Binance Vision USD-M fundingRate (unchanged from Trial 2)",
        "noInterpolation": True,
        "sourceArchiveCounts": {
            "spotDaily": len(spot_sources),
            "perpetualExecutionMonthly": len(perp_exec_sources),
            "perpetualMarkDaily": len(mark_sources),
            "fundingMonthly": len(funding_sources),
        },
        "synchronizedRows": len(rows),
        "synchronizedCsvSha256": synchronized_sha,
        "fundingTimestampSkew": {
            "maximumAbsoluteMs": max(abs(v) for v in skews),
            "minimumMs": min(skews),
            "maximumMs": max(skews),
        },
        "allArchivesChecksumVerified": all(item["expected_sha256"] == item["observed_sha256"] for item in sources),
        "sources": sources,
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "experimentId": replication["experimentId"],
        "sourceOnly": True,
        "economicsCalculated": False,
        "synchronizedRows": len(rows),
        "dailyMarkArchives": len(mark_sources),
        "allArchivesChecksumVerified": source_manifest["allArchivesChecksumVerified"],
        "synchronizedCsvSha256": synchronized_sha,
    }, indent=2))


if __name__ == "__main__":
    main()
