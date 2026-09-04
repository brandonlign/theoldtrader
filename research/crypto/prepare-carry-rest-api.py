#!/usr/bin/env python3
"""Build funding-carry-v1R-api from official Binance public REST endpoints.

This is an exact-family, non-promotion replication of frozen funding-carry-v1.
It preserves every raw JSON response page and SHA-256, uses explicit timestamp
pagination, performs no interpolation, and emits the same synchronized CSV schema
as the primary Binance Vision archive pipeline.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
USER_AGENT = "TheOldTrader-Research/1.0"
DEFAULT_MANIFEST = Path("research/crypto/manifests/funding-carry-v1R-api.json")
DEFAULT_OUT = Path("research/crypto/data-cache/funding-carry-v1R-api-synchronized.csv")
DEFAULT_SOURCES = Path("research/crypto/data-cache/funding-carry-v1R-api-sources.json")
DEFAULT_RAW_DIR = Path("research/crypto/data-cache/funding-carry-v1R-api-pages")

ENDPOINTS = {
    "spot": "https://api.binance.com/api/v3/klines",
    "perp_exec": "https://fapi.binance.com/fapi/v1/klines",
    "perp_mark": "https://fapi.binance.com/fapi/v1/markPriceKlines",
    "funding": "https://fapi.binance.com/fapi/v1/fundingRate",
}


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def iso_ms(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_bytes(url: str, retries: int = 5) -> bytes:
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (418, 429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {error.code} for {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == retries:
                break
        time.sleep(min(8.0, 0.5 * (2**attempt)))
    raise RuntimeError(f"Failed to download {url}: {last_error}")


def fetch_json_page(kind: str, page_number: int, params: dict, raw_dir: Path, source_pages: list):
    query = urllib.parse.urlencode(params)
    url = f"{ENDPOINTS[kind]}?{query}"
    payload = fetch_bytes(url)
    digest = sha256(payload)
    raw_dir.mkdir(parents=True, exist_ok=True)
    page_path = raw_dir / f"{kind}-{page_number:03d}.json"
    if page_path.exists():
        raise RuntimeError(f"Refusing to overwrite raw REST page {page_path}")
    page_path.write_bytes(payload)
    source_pages.append({
        "kind": kind,
        "page": page_number,
        "url": url,
        "sha256": digest,
        "bytes": len(payload),
        "path": str(page_path),
    })
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid JSON from {url}: {payload[:200]!r}") from error
    if isinstance(parsed, dict) and ("code" in parsed or "msg" in parsed):
        raise RuntimeError(f"Binance API error from {url}: {parsed}")
    return parsed


def fetch_klines(kind: str, start_ms: int, end_ms: int, raw_dir: Path, source_pages: list):
    result = {}
    cursor = start_ms
    page = 1
    while cursor < end_ms:
        rows = fetch_json_page(kind, page, {
            "symbol": "BTCUSDT",
            "interval": "8h",
            "startTime": cursor,
            "endTime": end_ms - 1,
            "limit": 1000,
        }, raw_dir, source_pages)
        if not isinstance(rows, list):
            raise RuntimeError(f"Unexpected {kind} response type")
        if not rows:
            break
        previous_open = None
        for row in rows:
            if not isinstance(row, list) or len(row) < 2:
                raise RuntimeError(f"Malformed {kind} kline row: {row}")
            open_time = int(row[0])
            open_price = float(row[1])
            if previous_open is not None and open_time <= previous_open:
                raise RuntimeError(f"Non-increasing {kind} timestamps within page {page}")
            previous_open = open_time
            if start_ms <= open_time < end_ms:
                if open_price <= 0:
                    raise RuntimeError(f"Non-positive {kind} open at {iso_ms(open_time)}")
                if open_time in result and result[open_time] != open_price:
                    raise RuntimeError(f"Conflicting duplicate {kind} open at {iso_ms(open_time)}")
                result[open_time] = open_price
        last_open = int(rows[-1][0])
        next_cursor = last_open + EIGHT_HOURS_MS
        if next_cursor <= cursor:
            raise RuntimeError(f"Pagination did not advance for {kind}")
        cursor = next_cursor
        page += 1
        if len(rows) < 1000:
            break
        time.sleep(0.05)
    return result


def nearest_boundary(raw_ms: int, tolerance_ms: int):
    scheduled = ((raw_ms + EIGHT_HOURS_MS // 2) // EIGHT_HOURS_MS) * EIGHT_HOURS_MS
    skew = raw_ms - scheduled
    if abs(skew) > tolerance_ms:
        raise RuntimeError(
            f"Funding time outside frozen tolerance: raw={iso_ms(raw_ms)} scheduled={iso_ms(scheduled)} skew_ms={skew}"
        )
    return scheduled, skew


def fetch_funding(start_ms: int, end_ms: int, tolerance_ms: int, raw_dir: Path, source_pages: list):
    result = {}
    cursor = start_ms
    page = 1
    while cursor < end_ms:
        rows = fetch_json_page("funding", page, {
            "symbol": "BTCUSDT",
            "startTime": cursor,
            "endTime": end_ms - 1,
            "limit": 1000,
        }, raw_dir, source_pages)
        if not isinstance(rows, list):
            raise RuntimeError("Unexpected funding response type")
        if not rows:
            break
        previous_raw = None
        for row in rows:
            raw_time = int(row["fundingTime"])
            rate = float(row["fundingRate"])
            if previous_raw is not None and raw_time <= previous_raw:
                raise RuntimeError(f"Non-increasing funding timestamps within page {page}")
            previous_raw = raw_time
            scheduled, skew = nearest_boundary(raw_time, tolerance_ms)
            if not (start_ms <= scheduled < end_ms):
                continue
            observation = {
                "rate": rate,
                "raw_timestamp_ms": raw_time,
                "scheduled_timestamp_ms": scheduled,
                "skew_ms": skew,
            }
            if scheduled in result:
                prior = result[scheduled]
                if prior != observation:
                    raise RuntimeError(
                        f"Two REST funding observations map to {iso_ms(scheduled)}: "
                        f"{iso_ms(prior['raw_timestamp_ms'])} and {iso_ms(raw_time)}"
                    )
            else:
                result[scheduled] = observation
        last_raw = int(rows[-1]["fundingTime"])
        next_cursor = last_raw + 1
        if next_cursor <= cursor:
            raise RuntimeError("Funding pagination did not advance")
        cursor = next_cursor
        page += 1
        if len(rows) < 1000:
            break
        time.sleep(0.05)
    return result


def write_csv(path: Path, scheduled_times, funding, spot, perp_exec, perp_mark):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise RuntimeError(f"Refusing to overwrite synchronized REST replication {path}")
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow([
            "timestamp",
            "raw_funding_timestamp",
            "funding_timestamp_skew_ms",
            "spot_price",
            "perp_exec_price",
            "perp_mark_price",
            "funding_rate",
        ])
        for timestamp in scheduled_times:
            observation = funding[timestamp]
            writer.writerow([
                iso_ms(timestamp),
                iso_ms(observation["raw_timestamp_ms"]),
                observation["skew_ms"],
                f"{spot[timestamp]:.10f}",
                f"{perp_exec[timestamp]:.10f}",
                f"{perp_mark[timestamp]:.10f}",
                f"{observation['rate']:.12f}",
            ])


def main():
    manifest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    source_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SOURCES
    raw_dir = Path(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_RAW_DIR

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "funding-carry-v1R-api" or manifest.get("replicationOf") != "funding-carry-v1":
        raise RuntimeError("Expected frozen funding-carry-v1R-api manifest")
    if manifest.get("status") != "FROZEN_BEFORE_FIRST_API_REPLICATION_EVALUATION" or manifest.get("promotionEligible") is not False:
        raise RuntimeError("REST replication manifest must be frozen and non-promotion-eligible")
    if out_path.exists() or source_path.exists() or raw_dir.exists():
        raise RuntimeError("REST replication output already exists; refusing overwrite")

    window = manifest["historicalRobustnessWindow"]
    start_ms = int(datetime.fromisoformat(window["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(window["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)
    expected_rows = (end_ms - start_ms) // EIGHT_HOURS_MS
    tolerance_ms = int(manifest["dataRequirements"]["fundingTimestampNormalization"]["maximumAbsoluteSkewMs"])
    if expected_rows != 5295:
        raise RuntimeError(f"Unexpected frozen REST replication row count {expected_rows}")

    source_pages = []
    spot = fetch_klines("spot", start_ms, end_ms, raw_dir, source_pages)
    perp_exec = fetch_klines("perp_exec", start_ms, end_ms, raw_dir, source_pages)
    perp_mark = fetch_klines("perp_mark", start_ms, end_ms, raw_dir, source_pages)
    funding = fetch_funding(start_ms, end_ms, tolerance_ms, raw_dir, source_pages)

    scheduled_times = [start_ms + index * EIGHT_HOURS_MS for index in range(expected_rows)]
    missing = {
        "funding": [timestamp for timestamp in scheduled_times if timestamp not in funding],
        "spot": [timestamp for timestamp in scheduled_times if timestamp not in spot],
        "perp_exec": [timestamp for timestamp in scheduled_times if timestamp not in perp_exec],
        "perp_mark": [timestamp for timestamp in scheduled_times if timestamp not in perp_mark],
    }
    if any(missing.values()):
        details = {key: [iso_ms(value) for value in values[:10]] for key, values in missing.items() if values}
        raise RuntimeError(f"REST replication exact-grid failure; no interpolation allowed: {details}")

    if len(funding) != expected_rows:
        raise RuntimeError(f"Funding normalization produced {len(funding)} rows; expected {expected_rows}")
    write_csv(out_path, scheduled_times, funding, spot, perp_exec, perp_mark)
    synchronized_sha = sha256(out_path.read_bytes())
    skews = [abs(funding[timestamp]["skew_ms"]) for timestamp in scheduled_times]

    source_manifest = {
        "experimentId": manifest["experimentId"],
        "replicationOf": manifest["replicationOf"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "paperOnly": True,
        "promotionEligible": False,
        "frozenWindow": window,
        "expectedRows": expected_rows,
        "synchronizedRows": len(scheduled_times),
        "synchronizedCsv": str(out_path),
        "synchronizedSha256": synchronized_sha,
        "maximumAbsoluteObservedFundingSkewMs": max(skews),
        "fundingSkewToleranceMs": tolerance_ms,
        "rawPageDirectory": str(raw_dir),
        "rawPageCount": len(source_pages),
        "rawPages": source_pages,
        "noInterpolation": True,
        "sourceType": "official Binance public REST endpoints",
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(source_manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "rows": expected_rows,
        "synchronizedSha256": synchronized_sha,
        "rawPageCount": len(source_pages),
        "maxFundingSkewMs": max(skews),
        "csv": str(out_path),
        "sources": str(source_path),
        "rawDir": str(raw_dir),
    }, indent=2))


if __name__ == "__main__":
    main()
