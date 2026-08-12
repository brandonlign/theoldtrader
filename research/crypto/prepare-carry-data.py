#!/usr/bin/env python3
"""Build the exact synchronized input for funding-carry-v1 from Binance Vision.

Scientific safeguards:
- checksum every downloaded archive against Binance's adjacent .CHECKSUM file;
- use DAILY spot 8h archives because open Binance public-data issue #475 reports
  cases where monthly spot archives disagree with daily archives/API;
- preserve each raw funding calc_time, but map it to the nearest scheduled 8h UTC
  boundary only when the absolute skew is <= the frozen 60-second tolerance;
- use only the exact 8h kline OPEN at that scheduled boundary, never that bar's
  close/high/low or a forward-filled/interpolated price;
- retain the first funding boundary for entry/marking but do not credit its payment;
- require the normalized BTCUSDT funding stream to be a complete 8-hour grid.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://data.binance.vision/"
SYMBOL = "BTCUSDT"
INTERVAL = "8h"
EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
FUNDING_SKEW_TOLERANCE_MS = 60_000
DEFAULT_MANIFEST = Path("research/crypto/manifests/funding-carry-v1.json")
DEFAULT_OUT = Path("research/crypto/data-cache/funding-carry-v1-synchronized.csv")
DEFAULT_SOURCE_MANIFEST = Path("research/crypto/data-cache/funding-carry-v1-sources.json")
MAX_WORKERS = 16


@dataclass
class SourceFile:
    kind: str
    period: str
    url: str
    checksum_url: str
    expected_sha256: str
    observed_sha256: str
    bytes: int


@dataclass(frozen=True)
class FundingObservation:
    rate: float
    raw_timestamp_ms: int
    scheduled_timestamp_ms: int
    skew_ms: int


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


def scheduled_funding_boundary(raw_timestamp_ms: int, tolerance_ms: int = FUNDING_SKEW_TOLERANCE_MS):
    """Map calc_time to the nearest frozen 8h UTC boundary or reject it.

    Integer arithmetic avoids floating-point rounding. The returned skew preserves
    the raw event timing for provenance; it is never used to move a price forward.
    """
    scheduled = ((raw_timestamp_ms + EIGHT_HOURS_MS // 2) // EIGHT_HOURS_MS) * EIGHT_HOURS_MS
    skew = raw_timestamp_ms - scheduled
    if abs(skew) > tolerance_ms:
        raise RuntimeError(
            "Funding calc_time is too far from the frozen 8h schedule: "
            f"raw={iso_ms(raw_timestamp_ms)}, scheduled={iso_ms(scheduled)}, skew_ms={skew}, "
            f"tolerance_ms={tolerance_ms}"
        )
    return scheduled, skew


def month_range(start_ms: int, end_ms: int):
    current = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = datetime.fromtimestamp((end_ms - 1) / 1000, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        yield current.strftime("%Y-%m")
        current = current.replace(year=current.year + 1, month=1) if current.month == 12 else current.replace(month=current.month + 1)


def day_range(start_ms: int, end_ms: int):
    current = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end = datetime.fromtimestamp((end_ms - 1) / 1000, tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        yield current.strftime("%Y-%m-%d")
        current += timedelta(days=1)


def urls(kind: str, period: str):
    if kind == "spot_daily":
        relative = f"data/spot/daily/klines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{period}.zip"
    elif kind == "mark_monthly":
        relative = f"data/futures/um/monthly/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{period}.zip"
    elif kind == "funding_monthly":
        relative = f"data/futures/um/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-{period}.zip"
    else:
        raise ValueError(kind)
    url = BASE + relative
    return url, url + ".CHECKSUM"


def fetch(url: str, retries: int = 5) -> bytes:
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "MoneyMog-Research/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {error.code} for {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == retries:
                break
        time.sleep(min(8.0, 0.4 * (2**attempt)))
    raise RuntimeError(f"Failed to download {url}: {last_error}")


def expected_checksum(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="strict").strip()
    token = text.split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError(f"Unexpected CHECKSUM payload: {text[:120]}")
    return token


def verified_zip(kind: str, period: str):
    url, checksum_url = urls(kind, period)
    expected = expected_checksum(fetch(checksum_url))
    payload = fetch(url)
    observed = sha256_bytes(payload)
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}: expected {expected}, observed {observed}")
    return payload, SourceFile(kind, period, url, checksum_url, expected, observed, len(payload))


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
            continue
        if start_ms <= timestamp < end_ms:
            if price <= 0:
                raise RuntimeError(f"Non-positive kline open at {timestamp}")
            if timestamp in result and result[timestamp] != price:
                raise RuntimeError(f"Conflicting duplicate kline timestamp {timestamp}")
            result[timestamp] = price
    return result


def parse_funding(payload: bytes, start_ms: int, end_ms: int, tolerance_ms: int):
    rows = list(zip_csv_rows(payload))
    if not rows:
        return {}
    header = [value.strip() for value in rows[0]]
    lower = [value.lower() for value in header]
    try:
        int(float(header[0]))
        has_header = False
    except (ValueError, TypeError):
        has_header = True
    data_rows = rows[1:] if has_header else rows

    if has_header:
        timestamp_candidates = ["calc_time", "fundingtime", "funding_time"]
        rate_candidates = ["last_funding_rate", "fundingrate", "funding_rate"]
        timestamp_index = next((lower.index(name) for name in timestamp_candidates if name in lower), None)
        rate_index = next((lower.index(name) for name in rate_candidates if name in lower), None)
        if timestamp_index is None:
            raise RuntimeError(f"Unrecognized funding timestamp header: {header}")
        if rate_index is None:
            rate_index = len(header) - 1
    else:
        timestamp_index = 0
        rate_index = len(rows[0]) - 1

    result = {}
    for row in data_rows:
        if len(row) <= max(timestamp_index, rate_index):
            continue
        try:
            raw_timestamp = normalize_ms(row[timestamp_index])
            rate = float(row[rate_index])
        except (ValueError, TypeError):
            continue
        scheduled, skew = scheduled_funding_boundary(raw_timestamp, tolerance_ms)
        if not (start_ms <= scheduled < end_ms):
            continue
        observation = FundingObservation(rate, raw_timestamp, scheduled, skew)
        if scheduled in result:
            prior = result[scheduled]
            raise RuntimeError(
                "Multiple raw funding observations map to one scheduled boundary: "
                f"scheduled={iso_ms(scheduled)}, prior_raw={iso_ms(prior.raw_timestamp_ms)}, "
                f"new_raw={iso_ms(raw_timestamp)}"
            )
        result[scheduled] = observation
    return result


def download_period(kind: str, period: str, start_ms: int, end_ms: int, funding_tolerance_ms: int):
    payload, metadata = verified_zip(kind, period)
    if kind == "funding_monthly":
        values = parse_funding(payload, start_ms, end_ms, funding_tolerance_ms)
    else:
        values = parse_kline_opens(payload, start_ms, end_ms)
    return values, metadata


def download_many(kind: str, periods, start_ms: int, end_ms: int, funding_tolerance_ms: int):
    values = {}
    metadata = []
    periods = list(periods)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_period, kind, period, start_ms, end_ms, funding_tolerance_ms): period
            for period in periods
        }
        completed = 0
        for future in as_completed(futures):
            period = futures[future]
            parsed, source = future.result()
            for timestamp, value in parsed.items():
                if timestamp in values:
                    raise RuntimeError(f"Duplicate {kind} value at normalized timestamp {iso_ms(timestamp)}")
                values[timestamp] = value
            metadata.append(asdict(source))
            completed += 1
            if completed % 50 == 0 or completed == len(periods):
                print(f"verified {kind}: {completed}/{len(periods)} archives", file=sys.stderr)
    metadata.sort(key=lambda item: item["period"])
    return values, metadata


def write_csv(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow([
            "timestamp",
            "raw_funding_timestamp",
            "funding_timestamp_skew_ms",
            "spot_price",
            "perp_price",
            "funding_rate",
        ])
        for scheduled, observation, spot, mark in rows:
            writer.writerow([
                iso_ms(scheduled),
                iso_ms(observation.raw_timestamp_ms),
                observation.skew_ms,
                f"{spot:.10f}",
                f"{mark:.10f}",
                f"{observation.rate:.12f}",
            ])


def main():
    manifest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    source_manifest_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SOURCE_MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "funding-carry-v1" or manifest.get("status") != "FROZEN_DATA_ACQUISITION_PENDING":
        raise RuntimeError("Expected frozen funding-carry-v1 manifest")

    timestamp_rule = manifest["dataRequirements"]["fundingTimestampNormalization"]
    funding_tolerance_ms = int(timestamp_rule["maximumAbsoluteSkewMs"])
    if funding_tolerance_ms != FUNDING_SKEW_TOLERANCE_MS:
        raise RuntimeError(
            f"Manifest/code funding tolerance mismatch: manifest={funding_tolerance_ms}, code={FUNDING_SKEW_TOLERANCE_MS}"
        )

    window = manifest["historicalRobustnessWindow"]
    start_ms = int(datetime.fromisoformat(window["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(window["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)

    # Daily spot is deliberate: public-data issue #475 documents monthly spot
    # discrepancies where daily archive values match the Binance API/uiKlines.
    spot, spot_sources = download_many(
        "spot_daily", day_range(start_ms, end_ms), start_ms, end_ms, funding_tolerance_ms
    )
    mark, mark_sources = download_many(
        "mark_monthly", month_range(start_ms, end_ms), start_ms, end_ms, funding_tolerance_ms
    )
    funding, funding_sources = download_many(
        "funding_monthly", month_range(start_ms, end_ms), start_ms, end_ms, funding_tolerance_ms
    )

    funding_times = sorted(funding)
    if len(funding_times) < 2:
        raise RuntimeError("Insufficient funding observations in frozen window")
    irregular = [
        (funding_times[index - 1], funding_times[index])
        for index in range(1, len(funding_times))
        if funding_times[index] - funding_times[index - 1] != EIGHT_HOURS_MS
    ]
    if irregular:
        sample = [(iso_ms(a), iso_ms(b)) for a, b in irregular[:5]]
        raise RuntimeError(f"Normalized funding series is not a complete 8-hour grid; first irregular gaps: {sample}")

    expected_first = start_ms
    expected_last = end_ms - EIGHT_HOURS_MS
    if funding_times[0] != expected_first or funding_times[-1] != expected_last:
        raise RuntimeError(
            "Normalized funding grid does not cover the entire frozen window: "
            f"first={iso_ms(funding_times[0])}, expected_first={iso_ms(expected_first)}, "
            f"last={iso_ms(funding_times[-1])}, expected_last={iso_ms(expected_last)}"
        )

    missing_spot = [timestamp for timestamp in funding_times if timestamp not in spot]
    missing_mark = [timestamp for timestamp in funding_times if timestamp not in mark]
    if missing_spot or missing_mark:
        raise RuntimeError(
            "Exact scheduled-boundary synchronization failed; no interpolation is permitted. "
            f"missing spot={len(missing_spot)}, mark={len(missing_mark)}"
        )

    synchronized = [
        (timestamp, funding[timestamp], spot[timestamp], mark[timestamp])
        for timestamp in funding_times
    ]
    write_csv(out_path, synchronized)
    synchronized_sha = sha256_bytes(out_path.read_bytes())

    skews = [observation.skew_ms for observation in funding.values()]
    abs_skews = [abs(value) for value in skews]
    sources = spot_sources + mark_sources + funding_sources
    source_manifest = {
        "experimentId": manifest["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "officialArchiveBase": BASE,
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "frozenWindow": window,
        "spotSource": "daily Binance Vision 8h klines",
        "perpetualSource": "monthly Binance Vision USD-M 8h markPriceKlines",
        "fundingSource": "monthly Binance Vision USD-M fundingRate",
        "spotMonthlyArchiveAvoidedBecause": "open binance/binance-public-data issue #475 documents monthly SPOT archive discrepancies versus daily/API",
        "fundingTimestampRule": {
            "rawField": "calc_time",
            "scheduledIntervalMs": EIGHT_HOURS_MS,
            "maximumAbsoluteSkewMs": funding_tolerance_ms,
            "mapping": "nearest 8h UTC Unix boundary; reject outside tolerance; preserve raw timestamp and skew",
            "rawObservationCount": len(funding),
            "minimumSkewMs": min(skews),
            "maximumSkewMs": max(skews),
            "maximumAbsoluteObservedSkewMs": max(abs_skews),
        },
        "priceTimestampRule": "exact 8h kline open at normalized scheduled funding boundary; no interpolation or later-bar data",
        "fundingAtEntryCredited": False,
        "synchronizedRows": len(synchronized),
        "firstTimestamp": iso_ms(funding_times[0]),
        "lastTimestamp": iso_ms(funding_times[-1]),
        "firstRawFundingTimestamp": iso_ms(funding[funding_times[0]].raw_timestamp_ms),
        "lastRawFundingTimestamp": iso_ms(funding[funding_times[-1]].raw_timestamp_ms),
        "synchronizedCsv": str(out_path),
        "synchronizedSha256": synchronized_sha,
        "sourceFileCount": len(sources),
        "sourceFiles": sorted(sources, key=lambda item: (item["kind"], item["period"])),
    }
    source_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    source_manifest_path.write_text(json.dumps(source_manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "rows": len(synchronized),
        "first": source_manifest["firstTimestamp"],
        "last": source_manifest["lastTimestamp"],
        "maxAbsFundingTimestampSkewMs": max(abs_skews),
        "sha256": synchronized_sha,
        "csv": str(out_path),
        "sources": str(source_manifest_path),
        "sourceFileCount": len(sources),
    }, indent=2))


if __name__ == "__main__":
    main()
