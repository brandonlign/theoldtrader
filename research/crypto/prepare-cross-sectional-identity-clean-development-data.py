#!/usr/bin/env python3
"""Prepare Trial 14 identity-clean development data without final access.

Trial 14 inherits Trial 3 mechanics byte-for-byte and changes only the universe
identity rule. This adapter verifies the frozen base manifest/source-universe Git
blob identities, materializes a transient Trial-3-compatible universe containing
the already-frozen Trial 14 membership, delegates acquisition to the audited
Trial 3 development-only wrapper, then relabels the resulting canonical dataset
and source manifest as Trial 14 evidence.

No 2026-01-01-or-later price row is requested or retained.
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
    with gzip.GzipFile(filename=str(path), mode="wb", compresslevel=9, mtime=0) as handle:
        handle.write(payload)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: prepare-cross-sectional-identity-clean-development-data.py "
            "<trial14-manifest> <trial14-universe> <out.gz> <sources.json>"
        )

    manifest_path = Path(sys.argv[1])
    universe_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    sources_path = Path(sys.argv[4])
    if out_path.exists() or sources_path.exists():
        raise RuntimeError("Trial 14 development output already exists; refusing overwrite")

    manifest = read_json(manifest_path)
    universe = read_json(universe_path)
    if manifest.get("experimentId") != "cross-sectional-identity-clean-v1" or manifest.get("trialNumber") != 14:
        raise RuntimeError("Expected frozen Trial 14 manifest")
    if manifest.get("status") != "FROZEN_PRE_DEVELOPMENT":
        raise RuntimeError("Trial 14 manifest is not frozen pre-development")
    if universe.get("experimentId") != manifest["experimentId"] or universe.get("trialNumber") != 14:
        raise RuntimeError("Trial 14 universe identity mismatch")
    if universe.get("status") != "UNIVERSE_FROZEN_PRE_DEVELOPMENT":
        raise RuntimeError("Trial 14 universe is not frozen pre-development")
    if universe.get("postFormationTrial14DataInspected") is not False:
        raise RuntimeError("Trial 14 universe firewall marker is not false")
    if universe.get("membership") != manifest.get("frozenMembership"):
        raise RuntimeError("Trial 14 manifest/universe membership mismatch")
    membership = universe.get("membership") or []
    if len(membership) != 30 or len(set(membership)) != 30:
        raise RuntimeError("Trial 14 requires exactly 30 unique frozen members")
    if "LUNAUSDT" in membership or "EOSUSDT" not in membership:
        raise RuntimeError("Trial 14 frozen identity repair is not present")

    base_manifest_path = Path(manifest["baseSpecification"]["path"])
    source_universe_path = Path(manifest["sourceUniverse"]["path"])
    base_manifest_raw = base_manifest_path.read_bytes()
    source_universe_raw = source_universe_path.read_bytes()
    if git_blob_sha1(base_manifest_raw) != manifest["baseSpecification"]["gitBlobSha"]:
        raise RuntimeError("Frozen Trial 3 base manifest blob identity changed")
    if git_blob_sha1(source_universe_raw) != manifest["sourceUniverse"]["gitBlobSha"]:
        raise RuntimeError("Frozen Trial 3 source-universe blob identity changed")

    base_manifest = json.loads(base_manifest_raw)
    source_universe = json.loads(source_universe_raw)
    if base_manifest.get("experimentId") != "cross-sectional-v1" or base_manifest.get("trialNumber") != 3:
        raise RuntimeError("Unexpected Trial 3 base manifest")
    if source_universe.get("formationSourceManifestSha256") != manifest["sourceUniverse"]["formationSourceManifestSha256"]:
        raise RuntimeError("Trial 3 source formation hash differs from Trial 14 freeze")

    exclusions = {row["symbol"] for row in manifest["identityStabilityRule"]["frozenIdentityExceptions"] if row.get("exclude")}
    derived = [row for row in source_universe.get("eligibleRanking", []) if row.get("symbol") not in exclusions][:30]
    derived_membership = [row["symbol"] for row in derived]
    if derived_membership != membership:
        raise RuntimeError("Trial 14 membership is not the first 30 source-ranked identity-clean members")

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

    base_wrapper = Path(__file__).with_name("prepare-cross-sectional-development-data.py")
    with tempfile.TemporaryDirectory(prefix="theoldtrader-trial14-") as tmp:
        tmp_path = Path(tmp)
        core_universe_path = tmp_path / "core-universe.json"
        core_universe_path.write_text(json.dumps(core_universe, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        subprocess.run(
            [
                sys.executable,
                str(base_wrapper),
                str(base_manifest_path),
                str(core_universe_path),
                str(out_path),
                str(sources_path),
            ],
            check=True,
        )

    with gzip.open(out_path, "rt", encoding="utf-8") as handle:
        dataset = json.load(handle)
    sources = read_json(sources_path)

    final_boundary = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
    if dataset.get("endExclusive") != "2026-01-01T00:00:00Z":
        raise RuntimeError("Trial 14 development dataset has wrong end boundary")
    if any(row["time"] >= final_boundary for rows in dataset.get("products", {}).values() for row in rows):
        raise RuntimeError("Trial 14 development acquisition crossed final-holdout boundary")
    if dataset.get("universeMembership") != membership:
        raise RuntimeError("Trial 14 acquired dataset membership mismatch")
    if set(dataset.get("products", {})) != set(membership):
        raise RuntimeError("Trial 14 acquired product set differs from frozen membership")

    core_dataset_sha = sources.get("datasetCanonicalJsonSha256")
    dataset["experimentId"] = manifest["experimentId"]
    dataset["trialNumber"] = 14
    dataset["universeFile"] = str(universe_path)
    dataset["identityCleanSuccessorOf"] = "cross-sectional-v1"
    dataset["identityExcludedSymbols"] = sorted(exclusions)
    raw_dataset = canonical_json_bytes(dataset)
    deterministic_gzip_write(out_path, raw_dataset)
    trial14_dataset_sha = hashlib.sha256(raw_dataset).hexdigest()

    sources["experimentId"] = manifest["experimentId"]
    sources["trialNumber"] = 14
    sources["mode"] = "development"
    sources["finalHoldoutRowsAcquired"] = 0
    sources["coreTrial3CompatibleDatasetCanonicalJsonSha256"] = core_dataset_sha
    sources["datasetCanonicalJsonSha256"] = trial14_dataset_sha
    sources["identityCleanSuccessorOf"] = "cross-sectional-v1"
    sources["identityExcludedSymbols"] = sorted(exclusions)
    sources["trial14Universe"] = str(universe_path)
    sources_path.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(json.dumps({
        "experimentId": manifest["experimentId"],
        "trialNumber": 14,
        "mode": "development",
        "membership": membership,
        "identityExcludedSymbols": sorted(exclusions),
        "datasetCanonicalJsonSha256": trial14_dataset_sha,
        "finalHoldoutRowsAcquired": 0,
        "dataset": str(out_path),
        "sources": str(sources_path),
    }, indent=2))


if __name__ == "__main__":
    main()
