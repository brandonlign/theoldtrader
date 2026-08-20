#!/usr/bin/env python3
"""Non-economic source audit for Trial 2 mark-price archives.

This script does not calculate strategy returns, funding economics, or P&L. It asks
only whether checksum-verified Binance Vision monthly and daily BTCUSDT 8h
markPriceKlines are mutually consistent where both exist and whether their union
covers every frozen Trial 2 8-hour boundary.
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from decimal import Decimal

BASE = "https://data.binance.vision/"
SYMBOL = "BTCUSDT"
INTERVAL = "8h"
START = datetime(2021, 5, 1, tzinfo=timezone.utc)
END = datetime(2026, 3, 1, tzinfo=timezone.utc)
EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
MAX_WORKERS = 20


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def normalize_ms(raw: str) -> int:
    value = int(float(raw))
    if value >= 10**15:
        value //= 1000
    return value


def fetch(url: str, allow_missing: bool = False) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-SourceAudit/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        if allow_missing and exc.code == 404:
            return None
        raise


def verified_zip(url: str, allow_missing: bool = False) -> bytes | None:
    checksum = fetch(url + ".CHECKSUM", allow_missing=allow_missing)
    if checksum is None:
        return None
    token = checksum.decode("utf-8", errors="strict").strip().split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError(f"Invalid checksum payload for {url}")
    payload = fetch(url, allow_missing=False)
    assert payload is not None
    observed = hashlib.sha256(payload).hexdigest()
    if observed != token:
        raise RuntimeError(f"Checksum mismatch for {url}")
    return payload


def parse_opens(payload: bytes) -> dict[int, Decimal]:
    out: dict[int, Decimal] = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one CSV in archive, got {names}")
        with archive.open(names[0]) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", newline="")
            for row in csv.reader(text):
                if len(row) < 2:
                    continue
                try:
                    timestamp = normalize_ms(row[0])
                    price = Decimal(row[1])
                except Exception:
                    continue
                if ms(START) <= timestamp < ms(END):
                    if timestamp in out and out[timestamp] != price:
                        raise RuntimeError(f"Conflicting duplicate timestamp {timestamp}")
                    out[timestamp] = price
    return out


def months():
    current = START.replace(day=1)
    last = (END - timedelta(milliseconds=1)).replace(day=1)
    while current <= last:
        yield current.strftime("%Y-%m")
        current = current.replace(year=current.year + 1, month=1) if current.month == 12 else current.replace(month=current.month + 1)


def days():
    current = START
    while current < END:
        yield current.strftime("%Y-%m-%d")
        current += timedelta(days=1)


def month_url(period: str) -> str:
    return BASE + f"data/futures/um/monthly/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{period}.zip"


def day_url(period: str) -> str:
    return BASE + f"data/futures/um/daily/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{period}.zip"


def load_one(kind: str, period: str):
    url = month_url(period) if kind == "monthly" else day_url(period)
    payload = verified_zip(url, allow_missing=(kind == "daily"))
    if payload is None:
        return kind, period, None
    return kind, period, parse_opens(payload)


def load_many(kind: str, periods: list[str]):
    rows: dict[int, Decimal] = {}
    available: list[str] = []
    missing: list[str] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(load_one, kind, period) for period in periods]
        completed = 0
        for future in as_completed(futures):
            _, period, parsed = future.result()
            if parsed is None:
                missing.append(period)
            else:
                available.append(period)
                for timestamp, price in parsed.items():
                    if timestamp in rows and rows[timestamp] != price:
                        raise RuntimeError(f"Conflicting {kind} duplicate timestamp {timestamp}")
                    rows[timestamp] = price
            completed += 1
            if completed % 100 == 0 or completed == len(periods):
                print(f"{kind}: {completed}/{len(periods)} archives checked", file=sys.stderr)
    return rows, sorted(available), sorted(missing)


def iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    monthly, monthly_available, monthly_missing = load_many("monthly", list(months()))
    if monthly_missing:
        raise RuntimeError(f"Required monthly archive missing: {monthly_missing[:5]}")
    daily, daily_available, daily_missing = load_many("daily", list(days()))

    expected = list(range(ms(START), ms(END), EIGHT_HOURS_MS))
    expected_set = set(expected)
    monthly = {k: v for k, v in monthly.items() if k in expected_set}
    daily = {k: v for k, v in daily.items() if k in expected_set}

    overlap = sorted(set(monthly) & set(daily))
    mismatches = [timestamp for timestamp in overlap if monthly[timestamp] != daily[timestamp]]
    union = set(monthly) | set(daily)
    missing_union = [timestamp for timestamp in expected if timestamp not in union]
    monthly_only = sorted(set(monthly) - set(daily))
    daily_only = sorted(set(daily) - set(monthly))

    result = {
        "sourceAuditOnly": True,
        "economicsCalculated": False,
        "candidateValuesExposed": False,
        "pricesExposed": False,
        "frozenWindow": {"start": START.isoformat(), "endExclusive": END.isoformat()},
        "expectedBoundaryRows": len(expected),
        "monthlyArchivesAvailable": len(monthly_available),
        "monthlyRows": len(monthly),
        "dailyArchivesAvailable": len(daily_available),
        "dailyArchivesMissing": len(daily_missing),
        "dailyMissingArchiveSample": daily_missing[:20],
        "dailyRows": len(daily),
        "overlapRows": len(overlap),
        "overlapMismatchCount": len(mismatches),
        "overlapMismatchTimestampSample": [iso(t) for t in mismatches[:20]],
        "monthlyOnlyRows": len(monthly_only),
        "monthlyOnlyTimestampSample": [iso(t) for t in monthly_only[:20]],
        "dailyOnlyRows": len(daily_only),
        "dailyOnlyTimestampSample": [iso(t) for t in daily_only[:20]],
        "unionRows": len(union),
        "missingUnionRows": len(missing_union),
        "missingUnionTimestampSample": [iso(t) for t in missing_union[:20]],
        "sourceUnionPass": len(mismatches) == 0 and len(missing_union) == 0,
    }
    print(json.dumps(result, indent=2))
    if not result["sourceUnionPass"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
