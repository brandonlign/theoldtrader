#!/usr/bin/env python3
"""Prepare Trial 3 development data without acquiring the final holdout.

The frozen candidate dates and feature definitions are unchanged. This wrapper
runs the already-authored checksum/archive builder against a transient manifest
whose acquisition end is the frozen development end (2026-01-01), then attaches
a checksum-verified first-observed Binance daily-bar timestamp for every frozen
member so the frozen ``asset_age_log_days`` feature is measured from the asset's
actual observed Binance history rather than from the 2022-10 feature-lookback
cache boundary.

No 2026-01-01-or-later Trial 3 price row is requested during development.
"""

from __future__ import annotations

import gzip
import json
import runpy
import sys
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

S3_LIST_ENDPOINT = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
PREFIX_ROOT = "data/spot/monthly/klines"
S3_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}


def deterministic_gzip_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # GzipFile(filename=path, ...) embeds the destination basename in the gzip
    # header, so identical payloads written to differently named files are not
    # byte-identical.  Use an explicit file object and an empty header filename
    # to keep the artifact deterministic without changing the decompressed data.
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as handle:
            handle.write(payload)


def list_first_archive(symbol: str, fetch) -> tuple[str, bytes, str]:
    prefix = f"{PREFIX_ROOT}/{symbol}/1d/"
    query = urllib.parse.urlencode({
        "list-type": "2",
        "prefix": prefix,
        "max-keys": "1000",
    })
    url = f"{S3_LIST_ENDPOINT}?{query}"
    payload = fetch(url)
    root = ET.fromstring(payload)
    keys = []
    for node in root.findall("s3:Contents/s3:Key", S3_NS):
        key = node.text or ""
        if key.startswith(prefix) and key.endswith(".zip"):
            keys.append(key)
    if not keys:
        raise RuntimeError(f"No historical daily archive found for frozen member {symbol}")
    return sorted(keys)[0], payload, url


def attach_first_observations(out_path: Path, sources_path: Path, builder_globals: dict) -> None:
    fetch = builder_globals["fetch"]
    expected_checksum = builder_globals["expected_checksum"]
    parse_archive = builder_globals["parse_archive"]
    sha256 = builder_globals["sha256"]
    canonical_json_bytes = builder_globals["canonical_json_bytes"]
    data_base = builder_globals["DATA_BASE"]

    with gzip.open(out_path, "rb") as handle:
        dataset = json.loads(handle.read().decode("utf-8"))
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    membership = dataset.get("universeMembership") or []
    if len(membership) != 30 or len(set(membership)) != 30:
        raise RuntimeError("Expected immutable 30-member Trial 3 universe before age metadata acquisition")

    first_observed = {}
    first_sources = []
    feature_start_ms = int(datetime.fromisoformat(dataset["start"].replace("Z", "+00:00")).timestamp() * 1000)

    for symbol in membership:
        key, listing_payload, listing_url = list_first_archive(symbol, fetch)
        archive_url = data_base + key
        checksum_url = archive_url + ".CHECKSUM"
        checksum_payload = fetch(checksum_url)
        expected = expected_checksum(checksum_payload)
        archive_payload = fetch(archive_url)
        observed = sha256(archive_payload)
        if observed != expected:
            raise RuntimeError(
                f"First-observation checksum mismatch for {symbol}: expected {expected}, observed {observed}"
            )
        rows = parse_archive(archive_payload, 0, feature_start_ms)
        if not rows:
            rows = parse_archive(archive_payload, 0, 2**63 - 1)
        if not rows:
            raise RuntimeError(f"Earliest daily archive contained no valid bars for {symbol}: {archive_url}")
        first_ms = min(rows)
        first_sec = first_ms // 1000
        first_observed[symbol] = first_sec
        first_sources.append({
            "symbol": symbol,
            "firstObservedTime": first_sec,
            "firstObservedIso": datetime.fromtimestamp(first_sec, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "listingUrl": listing_url,
            "listingSha256": sha256(listing_payload),
            "archiveUrl": archive_url,
            "checksumUrl": checksum_url,
            "expectedSha256": expected,
            "observedSha256": observed,
            "archiveBytes": len(archive_payload),
        })

    if set(first_observed) != set(membership):
        raise RuntimeError("First-observation metadata does not cover every frozen member")
    development_start = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp())
    if any(value >= development_start for value in first_observed.values()):
        raise RuntimeError("A frozen member lacks a pre-development first-observed Binance daily bar")

    dataset["firstObservedTimeBySymbol"] = first_observed
    dataset["assetAgeSource"] = "checksum-verified earliest Binance Vision monthly 1d archive per frozen member"
    raw_dataset = canonical_json_bytes(dataset)
    deterministic_gzip_write(out_path, raw_dataset)
    dataset_sha = sha256(raw_dataset)

    first_sources.sort(key=lambda row: row["symbol"])
    sources["datasetCanonicalJsonSha256"] = dataset_sha
    sources["firstObservedTimeBySymbol"] = first_observed
    sources["firstObservationSourceCount"] = len(first_sources)
    sources["firstObservationSources"] = first_sources
    sources["assetAgeSource"] = dataset["assetAgeSource"]
    sources_path.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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
    with tempfile.TemporaryDirectory(prefix="theoldtrader-trial3-dev-") as tmp:
        transient = Path(tmp) / "cross-sectional-v1-development-acquisition.json"
        transient.write_text(json.dumps(acquisition_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        original_argv = sys.argv[:]
        original_gzip_open = gzip.open

        # The frozen base builder used gzip.open(..., mtime=0), but gzip.open does
        # not expose mtime. Preserve the intended deterministic gzip semantics
        # mechanically while executing the frozen builder unchanged.
        def gzip_open_compat(filename, mode="rb", compresslevel=9, encoding=None, errors=None, newline=None, **kwargs):
            mtime = kwargs.pop("mtime", None)
            if kwargs:
                raise TypeError(f"Unexpected gzip.open arguments: {sorted(kwargs)}")
            if mtime is not None and "b" in mode:
                # Match deterministic_gzip_write: omit the output basename from
                # the gzip header so the same payload always yields the same bytes.
                raw = open(filename, mode.replace("b", "") + "b")
                try:
                    handle = gzip.GzipFile(filename="", mode=mode, fileobj=raw, compresslevel=compresslevel, mtime=mtime)
                except Exception:
                    raw.close()
                    raise
                # Closing GzipFile does not close a caller-supplied fileobj, so
                # wrap close to release both resources when the builder exits its
                # context manager.
                original_close = handle.close

                def close_both():
                    try:
                        original_close()
                    finally:
                        raw.close()

                handle.close = close_both
                return handle
            return original_gzip_open(
                filename, mode, compresslevel=compresslevel,
                encoding=encoding, errors=errors, newline=newline,
            )

        try:
            gzip.open = gzip_open_compat
            sys.argv = [str(builder), str(transient), str(universe_path), str(out_path), str(sources_path)]
            builder_globals = runpy.run_path(str(builder), run_name="__main__")
        finally:
            gzip.open = original_gzip_open
            sys.argv = original_argv

    attach_first_observations(out_path, sources_path, builder_globals)

    dataset_sources = json.loads(sources_path.read_text(encoding="utf-8"))
    coverage = dataset_sources.get("coverage") or {}
    forbidden = int(datetime.fromisoformat(development_end.replace("Z", "+00:00")).timestamp())
    for symbol, stats in coverage.items():
        last = stats.get("last")
        if last is None:
            continue
        last_sec = int(datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp())
        if last_sec >= forbidden:
            raise RuntimeError(f"Development acquisition crossed the final-holdout boundary for {symbol}: {last}")

    if dataset_sources.get("firstObservationSourceCount") != 30:
        raise RuntimeError("Trial 3 asset-age provenance is incomplete")

    print(json.dumps({
        "experimentId": manifest["experimentId"],
        "developmentEndExclusive": development_end,
        "finalHoldoutStart": final_start,
        "finalHoldoutEndExclusive": final_end,
        "finalHoldoutRowsAcquired": 0,
        "assetAgeMembersVerified": 30,
        "dataset": str(out_path),
        "sources": str(sources_path),
    }, indent=2))


if __name__ == "__main__":
    main()
