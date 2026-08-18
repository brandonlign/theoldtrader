#!/usr/bin/env python3
"""Build Trial 4 daily spot history from Binance's official market-data-only REST API.

Every raw JSON page is preserved and hashed. Development mode cannot request any
row at or after 2026-01-01. Final mode is separate and requires explicit consent.
No current exchangeInfo/survivor list is used: symbols come only from Trial 3's
already-frozen 2022-only universe file.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://data-api.binance.vision/api/v3/klines"
ONE_DAY_MS = 86_400_000
USER_AGENT = "MoneyMog-Research/1.0"


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json_bytes(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--universe", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--raw-dir", required=True)
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
    if development_end != final_start or hard_stop != final_start:
        raise RuntimeError("Trial 4 development/final boundary mismatch")
    if not final_start or not final_end or final_start >= final_end:
        raise RuntimeError("Trial 4 final holdout dates invalid")
    if mode == "development":
        return start, final_start
    if confirm_final != "YES":
        raise RuntimeError("Final Trial 4 acquisition requires --confirm-final YES")
    return start, final_end


def iso_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


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
        time.sleep(min(8.0, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"Failed to download {url}: {last_error}")


def parse_kline_rows(payload: bytes, symbol: str, start_ms: int, end_ms: int):
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid Binance kline JSON for {symbol}: {payload[:200]!r}") from error
    if isinstance(parsed, dict):
        raise RuntimeError(f"Binance API error for {symbol}: {parsed}")
    if not isinstance(parsed, list):
        raise RuntimeError(f"Unexpected Binance response type for {symbol}")

    rows = []
    previous = None
    for raw in parsed:
        if not isinstance(raw, list) or len(raw) < 8:
            raise RuntimeError(f"Malformed Binance kline for {symbol}: {raw}")
        open_ms = int(raw[0])
        if previous is not None and open_ms <= previous:
            raise RuntimeError(f"Non-increasing Binance kline timestamps for {symbol}")
        previous = open_ms
        if open_ms % ONE_DAY_MS != 0:
            raise RuntimeError(f"Non-UTC-midnight daily kline for {symbol}: {iso_ms(open_ms)}")
        if not (start_ms <= open_ms < end_ms):
            continue
        row = {
            "time": open_ms // 1000,
            "open": float(raw[1]),
            "high": float(raw[2]),
            "low": float(raw[3]),
            "close": float(raw[4]),
            "quoteVolume": float(raw[7]),
        }
        if not (row["open"] > 0 and row["high"] > 0 and row["low"] > 0 and row["close"] > 0 and row["quoteVolume"] >= 0):
            raise RuntimeError(f"Invalid Binance daily values for {symbol} at {iso_ms(open_ms)}")
        rows.append(row)
    return parsed, rows


def fetch_symbol(symbol: str, start_ms: int, end_ms: int, raw_dir: Path):
    cursor = start_ms
    page_number = 1
    result = {}
    pages = []
    while cursor < end_ms:
        params = {
            "symbol": symbol,
            "interval": "1d",
            "startTime": cursor,
            "endTime": end_ms - 1,
            "limit": 1000,
        }
        url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
        payload = fetch_bytes(url)
        parsed, rows = parse_kline_rows(payload, symbol, start_ms, end_ms)
        symbol_dir = raw_dir / symbol
        symbol_dir.mkdir(parents=True, exist_ok=True)
        page_path = symbol_dir / f"page-{page_number:03d}.json"
        if page_path.exists():
            raise RuntimeError(f"Refusing to overwrite raw Trial 4 page {page_path}")
        page_path.write_bytes(payload)
        pages.append({
            "symbol": symbol,
            "page": page_number,
            "url": url,
            "sha256": sha256(payload),
            "bytes": len(payload),
            "rowCount": len(rows),
            "firstOpen": iso_ms(int(parsed[0][0])) if parsed else None,
            "lastOpen": iso_ms(int(parsed[-1][0])) if parsed else None,
            "path": str(page_path),
        })
        for row in rows:
            prior = result.get(row["time"])
            if prior is not None and prior != row:
                raise RuntimeError(f"Conflicting duplicate daily row for {symbol} at {row['time']}")
            result[row["time"]] = row
        if not parsed:
            break
        last_open = int(parsed[-1][0])
        next_cursor = last_open + ONE_DAY_MS
        if next_cursor <= cursor:
            raise RuntimeError(f"Trial 4 pagination did not advance for {symbol}")
        cursor = next_cursor
        page_number += 1
        if len(parsed) < 1000:
            break
        time.sleep(0.05)
    return [result[key] for key in sorted(result)], pages


def validate_manifest_and_universe(manifest: dict, universe: dict):
    if manifest.get("experimentId") != "ctrend-v1" or manifest.get("trialNumber") != 4:
        raise RuntimeError("Expected frozen ctrend-v1 Trial 4 manifest")
    if manifest.get("paperOnly") is not True or manifest.get("livePromotionAllowed") is not False:
        raise RuntimeError("Trial 4 safety flags changed")
    if universe.get("experimentId") != "cross-sectional-v1" or universe.get("status") != "UNIVERSE_FORMED_PRE_DEVELOPMENT":
        raise RuntimeError("Trial 4 requires frozen Trial 3 universe")
    if universe.get("postFormationDataInspected") is not False:
        raise RuntimeError("Trial 3 universe firewall marker changed")
    membership = universe.get("membership")
    expected = int((manifest.get("universe") or {}).get("membershipSize", 0))
    if not isinstance(membership, list) or len(membership) != expected or len(set(membership)) != expected:
        raise RuntimeError("Trial 4 frozen universe membership mismatch")
    return membership


def main(argv=None):
    args = parse_args(argv)
    manifest_path = Path(args.manifest)
    universe_path = Path(args.universe)
    out_path = Path(args.out)
    source_path = Path(args.sources)
    raw_dir = Path(args.raw_dir)
    if out_path.exists() or source_path.exists() or raw_dir.exists():
        raise RuntimeError("Trial 4 REST data output already exists; refusing overwrite")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    universe = json.loads(universe_path.read_text(encoding="utf-8"))
    membership = validate_manifest_and_universe(manifest, universe)
    start_iso, end_iso = resolve_acquisition_window(manifest, args.mode, args.confirm_final)
    start_ms = int(datetime.fromisoformat(start_iso.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end_iso.replace("Z", "+00:00")).timestamp() * 1000)

    raw_dir.mkdir(parents=True, exist_ok=False)
    products = {}
    all_pages = []
    coverage = {}
    for index, symbol in enumerate(membership, start=1):
        rows, pages = fetch_symbol(symbol, start_ms, end_ms, raw_dir)
        products[symbol] = rows
        all_pages.extend(pages)
        coverage[symbol] = {
            "bars": len(rows),
            "first": iso_ms(rows[0]["time"] * 1000) if rows else None,
            "last": iso_ms(rows[-1]["time"] * 1000) if rows else None,
            "rawPages": len(pages),
        }
        print(f"Trial 4 REST data: {index}/{len(membership)} {symbol} ({len(rows)} bars)", flush=True)

    final_boundary_sec = int(datetime.fromisoformat(manifest["historicalData"]["finalHoldoutStart"].replace("Z", "+00:00")).timestamp())
    if args.mode == "development":
        for symbol, rows in products.items():
            if any(int(row["time"]) >= final_boundary_sec for row in rows):
                raise RuntimeError(f"Development REST acquisition crossed final holdout for {symbol}")

    membership_sha = sha256(canonical_json_bytes(membership))
    dataset = {
        "experimentId": "ctrend-v1",
        "trialNumber": 4,
        "paperOnly": True,
        "acquisitionMode": args.mode,
        "sourceType": "official Binance market-data-only REST /api/v3/klines",
        "sourceBaseUrl": "https://data-api.binance.vision",
        "universeExperimentId": "cross-sectional-v1",
        "universeMembership": membership,
        "universeMembershipSha256": membership_sha,
        "formationSourceManifestSha256": universe["formationSourceManifestSha256"],
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

    all_pages.sort(key=lambda row: (row["symbol"], row["page"]))
    source_manifest = {
        "experimentId": "ctrend-v1",
        "trialNumber": 4,
        "paperOnly": True,
        "acquisitionMode": args.mode,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceType": "official Binance market-data-only REST /api/v3/klines",
        "sourceBaseUrl": "https://data-api.binance.vision",
        "start": start_iso,
        "endExclusive": end_iso,
        "universeMembership": membership,
        "universeMembershipSha256": membership_sha,
        "formationSourceManifestSha256": universe["formationSourceManifestSha256"],
        "datasetCanonicalJsonSha256": dataset_sha,
        "datasetGzipPath": str(out_path),
        "rawPageDirectory": str(raw_dir),
        "rawPageCount": len(all_pages),
        "rawPages": all_pages,
        "coverage": coverage,
        "noInterpolation": True,
        "finalHoldoutRowsAcquired": 0 if args.mode == "development" else "explicit-final-mode",
    }
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(json.dumps({
        "experimentId": "ctrend-v1",
        "mode": args.mode,
        "dataset": str(out_path),
        "datasetCanonicalJsonSha256": dataset_sha,
        "rawPageCount": len(all_pages),
        "membershipSize": len(membership),
        "start": start_iso,
        "endExclusive": end_iso,
        "finalHoldoutRowsAcquired": 0 if args.mode == "development" else "explicit-final-mode",
    }, indent=2))


if __name__ == "__main__":
    main()
