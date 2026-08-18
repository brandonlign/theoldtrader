#!/usr/bin/env python3
"""Prepare checksum-verified Trial 4 daily data with a hard holdout firewall.

Trial 4 reuses only Trial 3's immutable 2022-only universe membership. This script
loads the already-tested Binance Vision archive helpers from the Trial 3 builder,
but writes a Trial 4-specific dataset and never changes universe membership.

Development mode physically stops acquisition at 2026-01-01. Final mode is a
separate explicit one-shot path and requires --confirm-final YES.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import runpy
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

MAX_WORKERS = 16


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json_bytes(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--trial3-manifest", required=True)
    parser.add_argument("--universe", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--mode", choices=("development", "final"), default="development")
    parser.add_argument("--confirm-final", default="NO")
    return parser.parse_args(argv)


def resolve_acquisition_window(manifest: dict, mode: str, confirm_final: str = "NO"):
    historical = manifest.get("historicalData") or {}
    start = historical.get("indicatorLookbackStart")
    final_start = historical.get("finalHoldoutStart")
    final_end = historical.get("finalHoldoutEndExclusive")
    development_end = historical.get("developmentEndExclusive")
    hard_stop = historical.get("developmentAcquisitionHardStop")
    if start != "2022-01-01T00:00:00Z":
        raise RuntimeError("Trial 4 indicator lookback start changed")
    if not final_start or development_end != final_start or hard_stop != final_start:
        raise RuntimeError("Trial 4 development/final boundary is inconsistent")
    if not final_end or final_start >= final_end:
        raise RuntimeError("Trial 4 final holdout dates are invalid")
    if mode == "development":
        return start, final_start
    if confirm_final != "YES":
        raise RuntimeError("Final Trial 4 acquisition requires --confirm-final YES")
    return start, final_end


def validate_manifests(ctrend: dict, trial3: dict):
    if ctrend.get("experimentId") != "ctrend-v1" or ctrend.get("trialNumber") != 4:
        raise RuntimeError("Expected frozen ctrend-v1 Trial 4 manifest")
    if ctrend.get("paperOnly") is not True or ctrend.get("livePromotionAllowed") is not False:
        raise RuntimeError("Trial 4 paper-only safety flags changed")
    if (ctrend.get("universe") or {}).get("source") != "research/crypto/universes/cross-sectional-v1-universe.json":
        raise RuntimeError("Trial 4 frozen universe dependency changed")
    if trial3.get("experimentId") != "cross-sectional-v1" or trial3.get("trialNumber") != 3:
        raise RuntimeError("Expected frozen Trial 3 universe manifest")
    if (trial3.get("universeFormation") or {}).get("membershipSize") != (ctrend.get("universe") or {}).get("membershipSize"):
        raise RuntimeError("Trial 3/4 frozen membership-size mismatch")


def main(argv=None):
    args = parse_args(argv)
    manifest_path = Path(args.manifest)
    trial3_manifest_path = Path(args.trial3_manifest)
    universe_path = Path(args.universe)
    out_path = Path(args.out)
    sources_path = Path(args.sources)
    if out_path.exists() or sources_path.exists():
        raise RuntimeError("Trial 4 data output already exists; refusing overwrite")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    trial3_manifest = json.loads(trial3_manifest_path.read_text(encoding="utf-8"))
    validate_manifests(manifest, trial3_manifest)
    start_iso, end_iso = resolve_acquisition_window(manifest, args.mode, args.confirm_final)

    helper_path = Path(__file__).with_name("prepare-cross-sectional-data.py")
    helpers = runpy.run_path(str(helper_path), run_name="moneymog_trial3_data_helpers")
    verify_universe = helpers["verify_universe"]
    month_keys = helpers["month_keys"]
    download_symbol_month = helpers["download_symbol_month"]

    universe, membership, formation_sources_sha = verify_universe(universe_path, trial3_manifest)
    expected_size = int(manifest["universe"]["membershipSize"])
    if len(membership) != expected_size or len(set(membership)) != expected_size:
        raise RuntimeError("Trial 4 frozen membership size/uniqueness mismatch")

    start_ms = int(datetime.fromisoformat(start_iso.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end_iso.replace("Z", "+00:00")).timestamp() * 1000)
    months = list(month_keys(start_iso, end_iso))
    by_symbol = {symbol: {} for symbol in membership}
    sources = []
    failures = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_symbol_month, symbol, month, start_ms, end_ms): (symbol, month)
            for symbol in membership for month in months
        }
        completed = 0
        for future in as_completed(futures):
            symbol, month = futures[future]
            try:
                _, _, bars, source = future.result()
            except Exception as error:
                failures.append({"symbol": symbol, "month": month, "error": str(error)})
                continue
            completed += 1
            if bars is not None:
                sources.append(source)
                for timestamp, row in bars.items():
                    prior = by_symbol[symbol].get(timestamp)
                    if prior is not None and prior != row:
                        raise RuntimeError(f"Conflicting duplicate {symbol} daily bar at {timestamp}")
                    by_symbol[symbol][timestamp] = row
            if completed and completed % 250 == 0:
                print(f"processed {completed}/{len(futures)} Trial 4 member-month archives", flush=True)

    if failures:
        raise RuntimeError(f"Trial 4 source failures ({len(failures)}); first: {failures[:10]}")

    products = {}
    coverage = {}
    forbidden_sec = int(datetime.fromisoformat(manifest["historicalData"]["finalHoldoutStart"].replace("Z", "+00:00")).timestamp())
    for symbol in membership:
        ordered = [by_symbol[symbol][timestamp] for timestamp in sorted(by_symbol[symbol])]
        if args.mode == "development" and any(int(row["time"]) >= forbidden_sec for row in ordered):
            raise RuntimeError(f"Development acquisition crossed the final-holdout boundary for {symbol}")
        products[symbol] = ordered
        coverage[symbol] = {
            "bars": len(ordered),
            "first": datetime.fromtimestamp(ordered[0]["time"], tz=timezone.utc).isoformat().replace("+00:00", "Z") if ordered else None,
            "last": datetime.fromtimestamp(ordered[-1]["time"], tz=timezone.utc).isoformat().replace("+00:00", "Z") if ordered else None,
        }

    membership_sha = sha256(canonical_json_bytes(membership))
    dataset = {
        "experimentId": "ctrend-v1",
        "trialNumber": 4,
        "paperOnly": True,
        "acquisitionMode": args.mode,
        "universeExperimentId": "cross-sectional-v1",
        "universeMembership": membership,
        "universeFile": str(universe_path),
        "universeMembershipSha256": membership_sha,
        "formationSourceManifestSha256": formation_sources_sha,
        "start": start_iso,
        "endExclusive": end_iso,
        "frequency": "1d",
        "products": products,
    }
    raw_dataset = canonical_json_bytes(dataset)
    dataset_sha = sha256(raw_dataset)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(filename=str(out_path), mode="wb", compresslevel=9, mtime=0) as handle:
        handle.write(raw_dataset)

    sources.sort(key=lambda row: (row["symbol"], row["month"]))
    source_manifest = {
        "experimentId": "ctrend-v1",
        "trialNumber": 4,
        "paperOnly": True,
        "acquisitionMode": args.mode,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "start": start_iso,
        "endExclusive": end_iso,
        "universeMembership": membership,
        "universeMembershipSha256": membership_sha,
        "formationSourceManifestSha256": formation_sources_sha,
        "datasetCanonicalJsonSha256": dataset_sha,
        "datasetGzipPath": str(out_path),
        "sourceArchiveCount": len(sources),
        "coverage": coverage,
        "sourceFiles": sources,
        "noInterpolation": True,
        "finalHoldoutRowsAcquired": 0 if args.mode == "development" else "explicit-final-mode",
    }
    sources_path.parent.mkdir(parents=True, exist_ok=True)
    sources_path.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(json.dumps({
        "experimentId": "ctrend-v1",
        "mode": args.mode,
        "dataset": str(out_path),
        "datasetCanonicalJsonSha256": dataset_sha,
        "sources": str(sources_path),
        "membershipSize": len(membership),
        "start": start_iso,
        "endExclusive": end_iso,
        "finalHoldoutRowsAcquired": 0 if args.mode == "development" else "explicit-final-mode",
    }, indent=2))


if __name__ == "__main__":
    main()
