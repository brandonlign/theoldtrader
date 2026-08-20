#!/usr/bin/env python3
"""Non-economic source audit for Trial 2 markPrice archive families.

Downloads and checksum-verifies the official Binance Vision monthly and daily
BTCUSDT 8h markPrice archive families across the frozen Trial 2 window. Reports
coverage and equality counts only; never reports prices, funding values, returns,
or P&L.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

BASE = "https://data.binance.vision/data/futures/um"
START = datetime(2021, 5, 1, tzinfo=timezone.utc)
END = datetime(2026, 3, 1, tzinfo=timezone.utc)
SYMBOL = "BTCUSDT"
INTERVAL = "8h"
WORKERS = 24


def fetch(url: str, allow_404=False):
    request = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-SourceAudit/1.0"})
    for attempt in range(4):
        try:
            return urllib.request.urlopen(request, timeout=90).read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and allow_404:
                return None
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(0.3 * (2 ** attempt))


def verify(url: str, allow_404=False):
    checksum = fetch(url + ".CHECKSUM", allow_404=allow_404)
    if checksum is None:
        return None
    payload = fetch(url, allow_404=allow_404)
    if payload is None:
        raise RuntimeError(f"checksum exists but archive missing: {url}")
    expected = checksum.decode("utf-8").strip().split()[0].lower()
    observed = hashlib.sha256(payload).hexdigest()
    if observed != expected:
        raise RuntimeError(f"checksum mismatch: {url}")
    return payload


def rows(payload: bytes):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"unexpected archive members: {names}")
        text = archive.read(names[0]).decode("utf-8")
    out = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2:
            continue
        try:
            raw = int(float(row[0]))
            ts = raw // 1000 if raw > 10_000_000_000 else raw
            price_text = row[1].strip()
            if float(price_text) <= 0:
                raise RuntimeError("non-positive mark open")
        except ValueError:
            continue
        out[ts] = price_text
    return out


def days():
    current = START
    while current < END:
        yield current.strftime("%Y-%m-%d")
        current += timedelta(days=1)


def months():
    year, month = START.year, START.month
    while (year, month) < (END.year, END.month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month == 13:
            year += 1
            month = 1


def daily_one(day: str):
    url = f"{BASE}/daily/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{day}.zip"
    payload = verify(url, allow_404=True)
    return day, None if payload is None else rows(payload)


def monthly_one(month: str):
    url = f"{BASE}/monthly/markPriceKlines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{month}.zip"
    payload = verify(url, allow_404=False)
    return month, rows(payload)


daily = {}
missing_daily = []
all_days = list(days())
with ThreadPoolExecutor(max_workers=WORKERS) as pool:
    futures = [pool.submit(daily_one, day) for day in all_days]
    for idx, future in enumerate(as_completed(futures), 1):
        day, data = future.result()
        if data is None:
            missing_daily.append(day)
        else:
            daily.update(data)
        if idx % 250 == 0:
            print(f"daily audit {idx}/{len(all_days)}", flush=True)

monthly = {}
all_months = list(months())
with ThreadPoolExecutor(max_workers=12) as pool:
    futures = [pool.submit(monthly_one, month) for month in all_months]
    for future in as_completed(futures):
        _, data = future.result()
        for ts, value in data.items():
            if ts in monthly and monthly[ts] != value:
                raise RuntimeError(f"conflicting monthly row at {ts}")
            monthly[ts] = value

start_s = int(START.timestamp())
end_s = int(END.timestamp())
expected = list(range(start_s, end_s, 8 * 3600))
daily_exact = {ts: daily[ts] for ts in expected if ts in daily}
monthly_exact = {ts: monthly[ts] for ts in expected if ts in monthly}
missing_daily_boundaries = [ts for ts in expected if ts not in daily_exact]
missing_monthly_boundaries = [ts for ts in expected if ts not in monthly_exact]
missing_union = [ts for ts in expected if ts not in daily_exact and ts not in monthly_exact]
overlap = [ts for ts in expected if ts in daily_exact and ts in monthly_exact]
mismatches = [ts for ts in overlap if daily_exact[ts] != monthly_exact[ts]]

iso_day = lambda ts: datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
result = {
    "forensicOnly": True,
    "economicsCalculated": False,
    "pricesExposed": False,
    "fundingValuesExposed": False,
    "frozenWindow": {"start": START.isoformat(), "end": END.isoformat()},
    "expectedEightHourBoundaries": len(expected),
    "dailyArchiveCalendarDays": len(all_days),
    "dailyArchivesAvailable": len(all_days) - len(missing_daily),
    "dailyArchivesMissing": len(missing_daily),
    "dailyArchiveMissingDates": sorted(missing_daily),
    "dailyExactBoundaryRows": len(daily_exact),
    "dailyMissingBoundaryRows": len(missing_daily_boundaries),
    "dailyMissingBoundaryDates": sorted(set(map(iso_day, missing_daily_boundaries))),
    "monthlyExactBoundaryRows": len(monthly_exact),
    "monthlyMissingBoundaryRows": len(missing_monthly_boundaries),
    "monthlyMissingBoundaryDates": sorted(set(map(iso_day, missing_monthly_boundaries))),
    "unionMissingBoundaryRows": len(missing_union),
    "unionMissingBoundaryDates": sorted(set(map(iso_day, missing_union))),
    "overlapBoundaryRows": len(overlap),
    "overlapExactStringMatches": len(overlap) - len(mismatches),
    "overlapMismatches": len(mismatches),
    "overlapMismatchDates": sorted(set(map(iso_day, mismatches))),
    "deterministicDailyThenMonthlyUnionHasFullCoverage": len(missing_union) == 0,
    "overlapIsExact": len(mismatches) == 0,
}
print(json.dumps(result, indent=2))
if missing_union:
    raise SystemExit(2)
