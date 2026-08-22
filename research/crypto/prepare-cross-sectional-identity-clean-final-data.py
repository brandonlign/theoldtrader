#!/usr/bin/env python3
"""Acquire the one-shot identity-clean 2026 cross-sectional holdout.

This adapter is infrastructure only. It does not change any strategy rule. It
requires an explicit final confirmation before reading the manifest or making a
network request, mechanically derives the frozen identity-clean universe from
Trial 14, delegates acquisition to the frozen Trial 3 final-data wrapper, and
then relabels the canonical evidence for the identity-clean universe.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def git_blob_sha1(payload: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload).hexdigest()


def canonical_json_bytes(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def deterministic_gzip_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as handle:
            handle.write(payload)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    if len(sys.argv) != 7 or sys.argv[5] != "--confirm-final" or sys.argv[6] != "YES":
        raise SystemExit(
            "usage: prepare-cross-sectional-identity-clean-final-data.py "
            "<trial14-manifest> <trial14-universe> <out.gz> <sources.json> --confirm-final YES"
        )

    manifest_path = Path(sys.argv[1])
    universe_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    sources_path = Path(sys.argv[4])
    if out_path.exists() or sources_path.exists():
        raise RuntimeError("Identity-clean final output already exists; refusing overwrite")

    manifest = read_json(manifest_path)
    universe = read_json(universe_path)
    if manifest.get("experimentId") != "cross-sectional-identity-clean-v1" or manifest.get("trialNumber") != 14:
        raise RuntimeError("Expected frozen Trial 14 identity-clean manifest")
    if universe.get("experimentId") != manifest["experimentId"] or universe.get("trialNumber") != 14:
        raise RuntimeError("Identity-clean universe mismatch")
    membership = universe.get("membership") or []
    if membership != manifest.get("frozenMembership") or len(membership) != 30 or len(set(membership)) != 30:
        raise RuntimeError("Identity-clean membership is not frozen 30-member membership")
    if "LUNAUSDT" in membership or "EOSUSDT" not in membership:
        raise RuntimeError("Identity-clean repair missing")

    base_manifest_path = Path(manifest["baseSpecification"]["path"])
    source_universe_path = Path(manifest["sourceUniverse"]["path"])
    base_manifest_raw = base_manifest_path.read_bytes()
    source_universe_raw = source_universe_path.read_bytes()
    if git_blob_sha1(base_manifest_raw) != manifest["baseSpecification"]["gitBlobSha"]:
        raise RuntimeError("Frozen Trial 3 base manifest blob changed")
    if git_blob_sha1(source_universe_raw) != manifest["sourceUniverse"]["gitBlobSha"]:
        raise RuntimeError("Frozen Trial 3 source universe blob changed")

    source_universe = json.loads(source_universe_raw)
    exclusions = {
        row["symbol"]
        for row in manifest["identityStabilityRule"]["frozenIdentityExceptions"]
        if row.get("exclude")
    }
    derived = [row for row in source_universe.get("eligibleRanking", []) if row.get("symbol") not in exclusions][:30]
    if [row["symbol"] for row in derived] != membership:
        raise RuntimeError("Identity-clean membership no longer derives mechanically from frozen source ranking")

    core_universe = {
        "eligibleRanking": derived,
        "experimentId": "cross-sectional-v1",
        "formationInformationEndExclusive": source_universe["formationInformationEndExclusive"],
        "formationSourceManifest": source_universe["formationSourceManifest"],
        "formationSourceManifestSha256": source_universe["formationSourceManifestSha256"],
        "formedAt": universe["formedAt"],
        "membership": membership,
        "membershipSize": 30,
        "postFormationDataInspected": False,
        "ruleSummary": source_universe["ruleSummary"],
        "status": "UNIVERSE_FORMED_PRE_DEVELOPMENT",
    }

    final_wrapper = Path(__file__).with_name("prepare-cross-sectional-final-data.py")
    with tempfile.TemporaryDirectory(prefix="theoldtrader-identity-clean-final-") as tmp:
        core_universe_path = Path(tmp) / "core-universe.json"
        core_universe_path.write_text(json.dumps(core_universe, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        subprocess.run(
            [
                sys.executable,
                str(final_wrapper),
                str(base_manifest_path),
                str(core_universe_path),
                str(out_path),
                str(sources_path),
                "--confirm-final",
                "YES",
            ],
            check=True,
        )

    with gzip.open(out_path, "rt", encoding="utf-8") as handle:
        dataset = json.load(handle)
    sources = read_json(sources_path)

    final_start = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
    final_end = int(datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp())
    if dataset.get("endExclusive") != "2026-08-01T00:00:00Z":
        raise RuntimeError("Identity-clean final dataset has wrong end boundary")
    if dataset.get("universeMembership") != membership or set(dataset.get("products", {})) != set(membership):
        raise RuntimeError("Identity-clean final dataset membership mismatch")
    if any(row["time"] >= final_end for rows in dataset.get("products", {}).values() for row in rows):
        raise RuntimeError("Identity-clean final acquisition crossed frozen 2026-08-01 boundary")
    final_rows = [row for rows in dataset.get("products", {}).values() for row in rows if final_start <= row["time"] < final_end]
    if not final_rows:
        raise RuntimeError("Identity-clean final acquisition returned no sealed holdout rows")

    core_dataset_sha = sources.get("datasetCanonicalJsonSha256")
    dataset["experimentId"] = "cross-sectional-identity-clean-v1"
    dataset["trialNumber"] = 14
    dataset["universeFile"] = str(universe_path)
    dataset["identityCleanSuccessorOf"] = "cross-sectional-v1"
    dataset["identityExcludedSymbols"] = sorted(exclusions)
    raw_dataset = canonical_json_bytes(dataset)
    deterministic_gzip_write(out_path, raw_dataset)
    identity_clean_sha = hashlib.sha256(raw_dataset).hexdigest()

    sources["experimentId"] = "cross-sectional-identity-clean-v1"
    sources["trialNumber"] = 14
    sources["mode"] = "final"
    sources["finalHoldoutStart"] = "2026-01-01T00:00:00Z"
    sources["finalHoldoutEndExclusive"] = "2026-08-01T00:00:00Z"
    sources["coreTrial3CompatibleDatasetCanonicalJsonSha256"] = core_dataset_sha
    sources["datasetCanonicalJsonSha256"] = identity_clean_sha
    sources["identityExcludedSymbols"] = sorted(exclusions)
    sources["finalHoldoutMemberDayRows"] = len(final_rows)
    sources_path.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(json.dumps({
        "experimentId": "cross-sectional-identity-clean-v1",
        "mode": "final",
        "datasetCanonicalJsonSha256": identity_clean_sha,
        "finalHoldoutMemberDayRows": len(final_rows),
        "membership": membership,
    }, indent=2))


if __name__ == "__main__":
    main()
