#!/usr/bin/env python3
"""Generic checksum-verified Binance 8h carry source-union helpers.

This module contains data acquisition only: no strategy signal, position sizing,
P&L, or promotion logic. It is intentionally symbol-parameterized so frozen
trials do not depend on another research branch being present in the checkout.
"""
from __future__ import annotations

import csv
import hashlib
import io
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

BASE = "https://data.binance.vision/"
INTERVAL = "8h"
EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
FUNDING_SKEW_TOLERANCE_MS = 60_000
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

def normalize_ms(raw: str) -> int:
    value = int(float(raw))
    if value >= 10**15:
        value //= 1000
    return value

def iso_ms(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")

def scheduled_funding_boundary(raw_timestamp_ms: int, tolerance_ms: int):
    scheduled = ((raw_timestamp_ms + EIGHT_HOURS_MS // 2) // EIGHT_HOURS_MS) * EIGHT_HOURS_MS
    skew = raw_timestamp_ms - scheduled
    if abs(skew) > tolerance_ms:
        raise RuntimeError(f"Funding timestamp skew {skew} exceeds frozen tolerance {tolerance_ms}")
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

def fetch(url: str, allow_404: bool = False, retries: int = 5):
    last_error = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-Frozen-Research/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if allow_404 and exc.code == 404:
                return None
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt == retries:
                break
        time.sleep(min(8.0, 0.4 * (2 ** attempt)))
    raise RuntimeError(f"Failed to download {url}: {last_error}")

def expected_checksum(payload: bytes) -> str:
    token = payload.decode("utf-8", errors="strict").strip().split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError("Unexpected CHECKSUM payload")
    return token

def source_url(symbol: str, kind: str, period: str):
    if kind == "spot_daily":
        rel = f"data/spot/daily/klines/{symbol}/{INTERVAL}/{symbol}-{INTERVAL}-{period}.zip"
    elif kind == "perp_monthly":
        rel = f"data/futures/um/monthly/klines/{symbol}/{INTERVAL}/{symbol}-{INTERVAL}-{period}.zip"
    elif kind == "funding_monthly":
        rel = f"data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{period}.zip"
    else:
        raise ValueError(kind)
    url = BASE + rel
    return url, url + ".CHECKSUM"

def zip_csv_rows(payload: bytes):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [n for n in archive.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one CSV in archive, found {names}")
        with archive.open(names[0]) as handle:
            import io as _io
            yield from csv.reader(_io.TextIOWrapper(handle, encoding="utf-8", newline=""))

def parse_kline_opens(payload: bytes, start_ms: int, end_ms: int):
    result = {}
    for row in zip_csv_rows(payload):
        if len(row) < 2:
            continue
        try:
            timestamp = normalize_ms(row[0]); price = float(row[1])
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
    header = [x.strip() for x in rows[0]]; lower = [x.lower() for x in header]
    try:
        int(float(header[0])); has_header = False
    except (ValueError, TypeError):
        has_header = True
    data = rows[1:] if has_header else rows
    if has_header:
        ts_candidates = ["calc_time", "fundingtime", "funding_time"]
        rate_candidates = ["last_funding_rate", "fundingrate", "funding_rate"]
        ts_i = next((lower.index(n) for n in ts_candidates if n in lower), None)
        rate_i = next((lower.index(n) for n in rate_candidates if n in lower), None)
        if ts_i is None:
            raise RuntimeError(f"Unrecognized funding timestamp header: {header}")
        if rate_i is None:
            rate_i = len(header) - 1
    else:
        ts_i = 0; rate_i = len(rows[0]) - 1
    result = {}
    for row in data:
        if len(row) <= max(ts_i, rate_i):
            continue
        try:
            raw = normalize_ms(row[ts_i]); rate = float(row[rate_i])
        except (ValueError, TypeError):
            continue
        scheduled, skew = scheduled_funding_boundary(raw, tolerance_ms)
        if not (start_ms <= scheduled < end_ms):
            continue
        if scheduled in result:
            raise RuntimeError(f"Multiple funding rows map to {iso_ms(scheduled)}")
        result[scheduled] = FundingObservation(rate, raw, scheduled, skew)
    return result

def download_period(symbol: str, kind: str, period: str, start_ms: int, end_ms: int, tolerance_ms: int):
    url, checksum_url = source_url(symbol, kind, period)
    checksum_payload = fetch(checksum_url)
    expected = expected_checksum(checksum_payload)
    payload = fetch(url)
    observed = hashlib.sha256(payload).hexdigest()
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}")
    parsed = parse_funding(payload, start_ms, end_ms, tolerance_ms) if kind == "funding_monthly" else parse_kline_opens(payload, start_ms, end_ms)
    return parsed, SourceFile(kind, period, url, checksum_url, expected, observed, len(payload))

def download_many(symbol: str, kind: str, periods, start_ms: int, end_ms: int, tolerance_ms: int):
    periods = list(periods); values = {}; metadata = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(download_period, symbol, kind, p, start_ms, end_ms, tolerance_ms): p for p in periods}
        for future in as_completed(futures):
            parsed, source = future.result()
            for timestamp, value in parsed.items():
                if timestamp in values:
                    raise RuntimeError(f"Duplicate {kind} timestamp {iso_ms(timestamp)}")
                values[timestamp] = value
            metadata.append(asdict(source))
    metadata.sort(key=lambda x: x["period"])
    return values, metadata

def mark_url(symbol: str, granularity: str, period: str):
    return BASE + f"data/futures/um/{granularity}/markPriceKlines/{symbol}/{INTERVAL}/{symbol}-{INTERVAL}-{period}.zip"

def parse_mark_opens(payload: bytes, start_ms: int, end_ms: int):
    result = {}
    for row in zip_csv_rows(payload):
        if len(row) < 2:
            continue
        try:
            timestamp = normalize_ms(row[0]); price = Decimal(row[1])
        except Exception:
            continue
        if start_ms <= timestamp < end_ms:
            if price <= 0:
                raise RuntimeError(f"Non-positive mark at {timestamp}")
            if timestamp in result and result[timestamp] != price:
                raise RuntimeError(f"Conflicting mark duplicate {timestamp}")
            result[timestamp] = price
    return result

def download_mark_archive(symbol: str, granularity: str, period: str, start_ms: int, end_ms: int):
    url = mark_url(symbol, granularity, period)
    checksum_payload = fetch(url + ".CHECKSUM", allow_404=(granularity == "daily"))
    if checksum_payload is None:
        return None, {"kind": f"mark_{granularity}", "period": period, "url": url, "checksum_url": url + ".CHECKSUM", "available": False, "reason": "official_checksum_404"}
    expected = expected_checksum(checksum_payload); payload = fetch(url)
    observed = hashlib.sha256(payload).hexdigest()
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}")
    return parse_mark_opens(payload, start_ms, end_ms), {"kind": f"mark_{granularity}", "period": period, "url": url, "checksum_url": url + ".CHECKSUM", "available": True, "expected_sha256": expected, "observed_sha256": observed, "bytes": len(payload)}

def download_mark_family(symbol: str, granularity: str, periods, start_ms: int, end_ms: int):
    periods = list(periods); values = {}; metadata = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(download_mark_archive, symbol, granularity, p, start_ms, end_ms): p for p in periods}
        for future in as_completed(futures):
            parsed, source = future.result(); metadata.append(source)
            if parsed is not None:
                for timestamp, price in parsed.items():
                    if timestamp in values and values[timestamp] != price:
                        raise RuntimeError(f"Conflicting {granularity} mark at {timestamp}")
                    values[timestamp] = price
    metadata.sort(key=lambda x: x["period"])
    return values, metadata

def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["timestamp", "raw_funding_timestamp", "funding_timestamp_skew_ms", "spot_price", "perp_exec_price", "perp_mark_price", "funding_rate"])
        for scheduled, observation, spot, perp_exec, perp_mark in rows:
            writer.writerow([iso_ms(scheduled), iso_ms(observation.raw_timestamp_ms), observation.skew_ms, f"{spot:.10f}", f"{perp_exec:.10f}", f"{float(perp_mark):.10f}", f"{observation.rate:.12f}"])
