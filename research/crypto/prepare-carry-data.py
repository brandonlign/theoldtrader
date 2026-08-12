#!/usr/bin/env python3
"""Build the exact synchronized input for funding-carry-v1 from Binance Vision.

No interpolation is allowed. Prices are the 8h kline OPEN at each realized funding
payment timestamp, so the row never uses information from after that timestamp.
The first synchronized funding row is retained for entry/marking but its payment is
not earned by the evaluator.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://data.binance.vision/"
SYMBOL = "BTCUSDT"
INTERVAL = "8h"
DEFAULT_MANIFEST = Path("research/crypto/manifests/funding-carry-v1.json")
DEFAULT_OUT = Path("research/crypto/data-cache/funding-carry-v1-synchronized.csv")
DEFAULT_SOURCE_MANIFEST = Path("research/crypto/data-cache/funding-carry-v1-sources.json")


@dataclass
class SourceFile:
    kind: str
    month: str
    url: str
    checksum_url: str
    expected_sha256: str
    observed_sha256: str
    bytes: int


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def normalize_ms(raw: str) -> int:
    value = int(float(raw))
    # Binance spot archive timestamps from 2025 onward are microseconds.
    if value >= 10**15:
        value //= 1000
    return value


def iso_ms(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def month_range(start_ms: int, end_ms: int):
    current = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = datetime.fromtimestamp((end_ms - 1) / 1000, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        yield current.strftime("%Y-%m")
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)


def urls(kind: str, month: str):
    if kind == "spot":
        relative = f"data/spot/monthly/klines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{month}.zip"
    elif kind == "mark":
        relative = f"data/futures/um/monthly/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{month}.zip"
    elif kind == "funding":
        relative = f"data/futures/um/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-{month}.zip"
    else:
        raise ValueError(kind)
    url = BASE + relative
    return url, url + ".CHECKSUM"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "MoneyMog-Research/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} for {url}") from error


def expected_checksum(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="strict").strip()
    token = text.split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError(f"Unexpected CHECKSUM payload: {text[:120]}")
    return token


def verified_zip(kind: str, month: str):
    url, checksum_url = urls(kind, month)
    checksum_payload = fetch(checksum_url)
    expected = expected_checksum(checksum_payload)
    payload = fetch(url)
    observed = sha256_bytes(payload)
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}: expected {expected}, observed {observed}")
    metadata = SourceFile(kind, month, url, checksum_url, expected, observed, len(payload))
    return payload, metadata


def zip_csv_rows(payload: bytes):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one file in archive, found {names}")
        with archive.open(names[0]) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", newline="")
            yield from csv.reader(text)


def parse_kline_opens(payload: bytes, start_ms: int, end_ms: int):
    result = {}
    for row in zip_csv_rows(payload):
        if len(row) < 2:
            continue
        try:
            timestamp = normalize_ms(row[0])
            price = float(row[1])
        except (ValueError, TypeError):
            # Header row, if present.
            continue
        if start_ms <= timestamp < end_ms:
            if price <= 0:
                raise RuntimeError(f"Non-positive kline open at {timestamp}")
            if timestamp in result and result[timestamp] != price:
                raise RuntimeError(f"Conflicting duplicate kline timestamp {timestamp}")
            result[timestamp] = price
    return result


def parse_funding(payload: bytes, start_ms: int, end_ms: int):
    rows = list(zip_csv_rows(payload))
    if not rows:
        return {}

    header = [value.strip() for value in rows[0]]
    lower = [value.lower() for value in header]
    has_header = any(not value.replace(".", "", 1).replace("-", "", 1).isdigit() for value in header[:1])
    data_rows = rows[1:] if has_header else rows

    if has_header:
        timestamp_candidates = ["calc_time", "fundingtime", "funding_time"]
        rate_candidates = ["last_funding_rate", "fundingrate", "funding_rate"]
        timestamp_index = next((lower.index(name) for name in timestamp_candidates if name in lower), None)
        rate_index = next((lower.index(name) for name in rate_candidates if name in lower), None)
        if timestamp_index is None:
            raise RuntimeError(f"Unrecognized funding timestamp header: {header}")
        if rate_index is None:
            # Binance Vision fundingRate archives commonly place the rate last.
            rate_index = len(header) - 1
    else:
        timestamp_index = 0
        rate_index = len(rows[0]) - 1

    result = {}
    for row in data_rows:
        if len(row) <= max(timestamp_index, rate_index):
            continue
        try:
            timestamp = normalize_ms(row[timestamp_index])
            rate = float(row[rate_index])
        except (ValueError, TypeError):
            continue
        if start_ms <= timestamp < end_ms:
            if timestamp in result and result[timestamp] != rate:
                raise RuntimeError(f"Conflicting duplicate funding timestamp {timestamp}")
            result[timestamp] = rate
    return result


def write_csv(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["timestamp", "spot_price", "perp_price", "funding_rate"])
        for timestamp, spot, mark, rate in rows:
            writer.writerow([iso_ms(timestamp), f"{spot:.10f}", f"{mark:.10f}", f"{rate:.12f}"])


def main():
    manifest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    source_manifest_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SOURCE_MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "funding-carry-v1" or manifest.get("status") != "FROZEN_DATA_ACQUISITION_PENDING":
        raise RuntimeError("Expected frozen funding-carry-v1 manifest")

    window = manifest["historicalRobustnessWindow"]
    start_ms = int(datetime.fromisoformat(window["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(window["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)

    spot = {}
    mark = {}
    funding = {}
    sources = []
    for month in month_range(start_ms, end_ms):
        for kind in ("spot", "mark", "funding"):
            payload, metadata = verified_zip(kind, month)
            sources.append(asdict(metadata))
            if kind == "spot":
                spot.update(parse_kline_opens(payload, start_ms, end_ms))
            elif kind == "mark":
                mark.update(parse_kline_opens(payload, start_ms, end_ms))
            else:
                funding.update(parse_funding(payload, start_ms, end_ms))
        print(f"verified {month}", file=sys.stderr)

    funding_times = sorted(funding)
    if len(funding_times) < 2:
        raise RuntimeError("Insufficient funding observations in frozen window")
    eight_hours_ms = 8 * 60 * 60 * 1000
    irregular = [
        (funding_times[index - 1], funding_times[index])
        for index in range(1, len(funding_times))
        if funding_times[index] - funding_times[index - 1] != eight_hours_ms
    ]
    if irregular:
        sample = [(iso_ms(a), iso_ms(b)) for a, b in irregular[:5]]
        raise RuntimeError(f"Funding series is not a complete 8-hour grid; first irregular gaps: {sample}")

    missing_spot = [timestamp for timestamp in funding_times if timestamp not in spot]
    missing_mark = [timestamp for timestamp in funding_times if timestamp not in mark]
    if missing_spot or missing_mark:
        raise RuntimeError(
            "Exact synchronization failed; no interpolation is permitted. "
            f"missing spot={len(missing_spot)}, mark={len(missing_mark)}"
        )

    synchronized = [(timestamp, spot[timestamp], mark[timestamp], funding[timestamp]) for timestamp in funding_times]
    write_csv(out_path, synchronized)
    synchronized_bytes = out_path.read_bytes()
    synchronized_sha = sha256_bytes(synchronized_bytes)

    source_manifest = {
        "experimentId": manifest["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "officialArchiveBase": BASE,
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "frozenWindow": window,
        "priceTimestampRule": "exact 8h kline open at realized funding timestamp; no interpolation",
        "fundingAtEntryCredited": False,
        "synchronizedRows": len(synchronized),
        "firstTimestamp": iso_ms(funding_times[0]),
        "lastTimestamp": iso_ms(funding_times[-1]),
        "synchronizedCsv": str(out_path),
        "synchronizedSha256": synchronized_sha,
        "sourceFiles": sources,
    }
    source_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    source_manifest_path.write_text(json.dumps(source_manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "rows": len(synchronized),
        "first": source_manifest["firstTimestamp"],
        "last": source_manifest["lastTimestamp"],
        "sha256": synchronized_sha,
        "csv": str(out_path),
        "sources": str(source_manifest_path),
    }, indent=2))


if __name__ == "__main__":
    main()
