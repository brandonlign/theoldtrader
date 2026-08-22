#!/usr/bin/env python3
"""Build Trial 2U synchronized carry input from checksum-verified source union.

Economics are inherited unchanged from frozen Trial 2. This builder changes only
mark-price provenance: monthly and daily Binance Vision 8h markPriceKlines are
loaded independently for the full window; exact overlap disagreement or union
coverage failure aborts. No interpolation or nearest-price substitution exists.
"""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

BASE = "https://data.binance.vision/"
SYMBOL = "BTCUSDT"
INTERVAL = "8h"
EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
MAX_WORKERS = 16
ECONOMICS_MANIFEST = Path("research/crypto/manifests/funding-carry-v1.json")
REPLICATION_MANIFEST = Path("research/crypto/manifests/funding-carry-v1U-source-union.json")
DEFAULT_OUT = Path("research/crypto/data-cache/funding-carry-v1U-source-union-synchronized.csv")
DEFAULT_SOURCES = Path("research/crypto/data-cache/funding-carry-v1U-source-union-sources.json")


def load_original_module():
    path = "research/crypto/prepare-carry-data.py"
    spec = importlib.util.spec_from_file_location("trial2_prepare", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load frozen Trial 2 data builder")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def git_blob_sha1(payload: bytes) -> str:
    return hashlib.sha1(f"blob {len(payload)}\0".encode() + payload).hexdigest()


def fetch(url: str, allow_404: bool = False, retries: int = 5) -> bytes | None:
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-Trial2U/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if allow_404 and error.code == 404:
                return None
            last_error = error
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {error.code} for {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == retries:
                break
        time.sleep(min(8.0, 0.4 * (2**attempt)))
    raise RuntimeError(f"Failed to download {url}: {last_error}")


def mark_url(granularity: str, period: str) -> str:
    if granularity not in {"monthly", "daily"}:
        raise ValueError(granularity)
    return BASE + f"data/futures/um/{granularity}/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{period}.zip"


def expected_checksum(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="strict").strip()
    token = text.split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError(f"Unexpected CHECKSUM payload: {text[:120]}")
    return token


def parse_mark_opens(payload: bytes, start_ms: int, end_ms: int) -> dict[int, Decimal]:
    result: dict[int, Decimal] = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one file in mark archive, found {names}")
        with archive.open(names[0]) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", newline="")
            for row in csv.reader(text):
                if len(row) < 2:
                    continue
                try:
                    timestamp = int(float(row[0]))
                    if timestamp >= 10**15:
                        timestamp //= 1000
                    price = Decimal(row[1])
                except Exception:
                    continue
                if start_ms <= timestamp < end_ms:
                    if price <= 0:
                        raise RuntimeError(f"Non-positive mark price at {timestamp}")
                    if timestamp in result and result[timestamp] != price:
                        raise RuntimeError(f"Conflicting duplicate mark timestamp {timestamp}")
                    result[timestamp] = price
    return result


def download_mark_archive(granularity: str, period: str, start_ms: int, end_ms: int):
    url = mark_url(granularity, period)
    checksum_payload = fetch(url + ".CHECKSUM", allow_404=(granularity == "daily"))
    if checksum_payload is None:
        return None, {
            "kind": f"mark_{granularity}",
            "period": period,
            "url": url,
            "checksum_url": url + ".CHECKSUM",
            "available": False,
            "reason": "official_checksum_404",
        }
    expected = expected_checksum(checksum_payload)
    payload = fetch(url, allow_404=False)
    assert payload is not None
    observed = hashlib.sha256(payload).hexdigest()
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}: expected {expected}, observed {observed}")
    return parse_mark_opens(payload, start_ms, end_ms), {
        "kind": f"mark_{granularity}",
        "period": period,
        "url": url,
        "checksum_url": url + ".CHECKSUM",
        "available": True,
        "expected_sha256": expected,
        "observed_sha256": observed,
        "bytes": len(payload),
    }


def download_mark_family(granularity: str, periods: list[str], start_ms: int, end_ms: int):
    values: dict[int, Decimal] = {}
    metadata = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_mark_archive, granularity, period, start_ms, end_ms): period
            for period in periods
        }
        completed = 0
        for future in as_completed(futures):
            parsed, source = future.result()
            metadata.append(source)
            if parsed is not None:
                for timestamp, price in parsed.items():
                    if timestamp in values and values[timestamp] != price:
                        raise RuntimeError(f"Conflicting {granularity} mark value at {timestamp}")
                    values[timestamp] = price
            completed += 1
            if completed % 100 == 0 or completed == len(periods):
                print(f"verified mark_{granularity}: {completed}/{len(periods)} archives", file=sys.stderr)
    metadata.sort(key=lambda item: item["period"])
    return values, metadata


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    source_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SOURCES
    mod = load_original_module()

    economics_bytes = ECONOMICS_MANIFEST.read_bytes()
    economics = json.loads(economics_bytes)
    replication = json.loads(REPLICATION_MANIFEST.read_text(encoding="utf-8"))
    if replication.get("status") != "FROZEN_SOURCE_REPLICATION_UNOBSERVED":
        raise RuntimeError("Trial 2U replication manifest is not frozen/unobserved")
    observed_blob = git_blob_sha1(economics_bytes)
    expected_blob = replication["economicsManifestBlobShaAtFreeze"]
    if observed_blob != expected_blob:
        raise RuntimeError(f"Frozen Trial 2 economics manifest drift: expected {expected_blob}, observed {observed_blob}")
    if economics.get("experimentId") != "funding-carry-v1" or economics.get("status") != "FROZEN_DATA_ACQUISITION_PENDING":
        raise RuntimeError("Unexpected frozen Trial 2 economics manifest identity/status")

    window = economics["historicalRobustnessWindow"]
    start_ms = int(datetime.fromisoformat(window["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(window["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    tolerance = int(economics["dataRequirements"]["fundingTimestampNormalization"]["maximumAbsoluteSkewMs"])
    if tolerance != mod.FUNDING_SKEW_TOLERANCE_MS:
        raise RuntimeError("Funding timestamp tolerance drift")

    days = list(mod.day_range(start_ms, end_ms))
    months = list(mod.month_range(start_ms, end_ms))
    spot, spot_sources = mod.download_many("spot_daily", days, start_ms, end_ms, tolerance)
    perp_exec, perp_sources = mod.download_many("perp_monthly", months, start_ms, end_ms, tolerance)
    funding, funding_sources = mod.download_many("funding_monthly", months, start_ms, end_ms, tolerance)
    monthly_marks, monthly_mark_sources = download_mark_family("monthly", months, start_ms, end_ms)
    daily_marks, daily_mark_sources = download_mark_family("daily", days, start_ms, end_ms)

    funding_times = sorted(funding)
    expected_rows = (end_ms - start_ms) // EIGHT_HOURS_MS
    if len(funding_times) != expected_rows or not funding_times:
        raise RuntimeError(f"Funding grid row count mismatch: observed={len(funding_times)}, expected={expected_rows}")
    if funding_times[0] != start_ms or funding_times[-1] != end_ms - EIGHT_HOURS_MS:
        raise RuntimeError("Funding grid endpoints do not match frozen window")
    irregular = [
        (funding_times[index - 1], funding_times[index])
        for index in range(1, len(funding_times))
        if funding_times[index] - funding_times[index - 1] != EIGHT_HOURS_MS
    ]
    if irregular:
        raise RuntimeError(f"Funding grid is irregular; first={irregular[0]}")

    overlap = set(monthly_marks) & set(daily_marks)
    mark_mismatches = sorted(timestamp for timestamp in overlap if monthly_marks[timestamp] != daily_marks[timestamp])
    if mark_mismatches:
        raise RuntimeError(
            "Monthly/daily mark sources disagree; source-union replication aborts. "
            f"mismatch_count={len(mark_mismatches)}, first={mod.iso_ms(mark_mismatches[0])}"
        )

    mark_union = dict(monthly_marks)
    for timestamp, price in daily_marks.items():
        mark_union.setdefault(timestamp, price)

    missing_spot = [timestamp for timestamp in funding_times if timestamp not in spot]
    missing_perp = [timestamp for timestamp in funding_times if timestamp not in perp_exec]
    missing_mark = [timestamp for timestamp in funding_times if timestamp not in mark_union]
    if missing_spot or missing_perp or missing_mark:
        raise RuntimeError(
            "Exact source-union synchronization failed; no interpolation permitted. "
            f"missing spot={len(missing_spot)}, perp_exec={len(missing_perp)}, mark_union={len(missing_mark)}"
        )

    synchronized = [
        (timestamp, funding[timestamp], spot[timestamp], perp_exec[timestamp], mark_union[timestamp])
        for timestamp in funding_times
    ]
    mod.write_csv(out_path, synchronized)
    synchronized_sha = hashlib.sha256(out_path.read_bytes()).hexdigest()

    daily_available = sum(1 for item in daily_mark_sources if item.get("available"))
    daily_missing = [item["period"] for item in daily_mark_sources if not item.get("available")]
    monthly_only = sorted(set(monthly_marks) - set(daily_marks))
    daily_only = sorted(set(daily_marks) - set(monthly_marks))
    all_sources = spot_sources + perp_sources + funding_sources + monthly_mark_sources + daily_mark_sources
    source_manifest = {
        "experimentId": replication["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "frozenAt": replication["frozenAt"],
        "economicsManifestBlobSha": observed_blob,
        "frozenWindow": window,
        "sourceRule": replication["markPriceSourceRule"],
        "coverage": {
            "expectedBoundaryRows": expected_rows,
            "synchronizedRows": len(synchronized),
            "monthlyMarkRows": len(monthly_marks),
            "dailyMarkRows": len(daily_marks),
            "overlapRows": len(overlap),
            "overlapMismatchCount": len(mark_mismatches),
            "monthlyOnlyRows": len(monthly_only),
            "dailyOnlyRows": len(daily_only),
            "unionRows": len(mark_union),
            "missingUnionRows": len(missing_mark),
            "dailyArchivesAvailable": daily_available,
            "dailyArchivesMissing": len(daily_missing),
            "dailyMissingPeriods": daily_missing,
        },
        "synchronizedSha256": synchronized_sha,
        "sources": all_sources,
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "experimentId": replication["experimentId"],
        "economicsCalculated": False,
        "synchronizedRows": len(synchronized),
        "synchronizedSha256": synchronized_sha,
        "overlapMismatchCount": len(mark_mismatches),
        "missingUnionRows": len(missing_mark),
        "monthlyOnlyRows": len(monthly_only),
        "dailyOnlyRows": len(daily_only),
        "dailyArchivesMissing": len(daily_missing),
        "sourceUnionValid": True,
    }, indent=2))


if __name__ == "__main__":
    main()
