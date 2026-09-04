#!/usr/bin/env python3
"""Prepare the frozen post-formation dataset for cross-sectional-v1.

The script refuses to fetch any 2023+ Trial 3 data unless the immutable 2022-only
universe file already exists and its formation-source manifest SHA-256 matches.
Only the 30 frozen members are downloaded. Missing historical months are preserved
as missing; available archives must pass their official Binance .CHECKSUM.
"""

from __future__ import annotations

import csv
import gzip
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
from datetime import datetime, timezone
from pathlib import Path

DATA_BASE = "https://data.binance.vision/"
INTERVAL = "1d"
MAX_WORKERS = 16
DEFAULT_MANIFEST = Path("research/crypto/manifests/cross-sectional-v1.json")
DEFAULT_UNIVERSE = Path("research/crypto/universes/cross-sectional-v1-universe.json")
DEFAULT_OUT = Path("research/crypto/data-cache/cross-sectional-v1-daily.json.gz")
DEFAULT_SOURCES = Path("research/crypto/data-cache/cross-sectional-v1-daily-sources.json")


@dataclass
class SourceFile:
    symbol: str
    month: str
    url: str
    checksum_url: str
    expected_sha256: str
    observed_sha256: str
    bytes: int
    bars: int


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json_bytes(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def fetch(url: str, retries: int = 4, allow_404: bool = False):
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-Research/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404 and allow_404:
                return None
            last_error = error
            if error.code not in (418, 429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"HTTP {error.code} for {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == retries:
                break
        time.sleep(min(8.0, 0.4 * (2**attempt)))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def expected_checksum(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="strict").strip()
    token = text.split()[0].lower()
    if len(token) != 64 or any(ch not in "0123456789abcdef" for ch in token):
        raise RuntimeError(f"Unexpected checksum payload: {text[:120]}")
    return token


def normalize_ms(raw: str) -> int:
    value = int(float(raw))
    if value >= 10**15:
        value //= 1000
    return value


def month_keys(start_iso: str, end_iso: str):
    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end_exclusive = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    last = datetime.fromtimestamp((end_exclusive.timestamp() - 1), tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    current = start
    while current <= last:
        yield current.strftime("%Y-%m")
        current = current.replace(year=current.year + 1, month=1) if current.month == 12 else current.replace(month=current.month + 1)


def archive_urls(symbol: str, month: str):
    relative = f"data/spot/monthly/klines/{symbol}/{INTERVAL}/{symbol}-{INTERVAL}-{month}.zip"
    url = DATA_BASE + relative
    return url, url + ".CHECKSUM"


def parse_archive(payload: bytes, start_ms: int, end_ms: int):
    rows = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one CSV in archive, found {names}")
        with archive.open(names[0]) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", newline="")
            reader = csv.reader(text)
            for cells in reader:
                if len(cells) < 8:
                    continue
                try:
                    timestamp = normalize_ms(cells[0])
                    open_price = float(cells[1])
                    high = float(cells[2])
                    low = float(cells[3])
                    close = float(cells[4])
                    base_volume = float(cells[5])
                    quote_volume = float(cells[7])
                except (ValueError, TypeError):
                    continue
                if not (start_ms <= timestamp < end_ms):
                    continue
                if min(open_price, high, low, close) <= 0 or base_volume < 0 or quote_volume < 0:
                    raise RuntimeError(f"Invalid OHLCV at {timestamp}")
                row = {
                    "time": timestamp // 1000,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": base_volume,
                    "quoteVolume": quote_volume,
                }
                if timestamp in rows and rows[timestamp] != row:
                    raise RuntimeError(f"Conflicting duplicate daily bar at {timestamp}")
                rows[timestamp] = row
    return rows


def download_symbol_month(symbol: str, month: str, start_ms: int, end_ms: int):
    url, checksum_url = archive_urls(symbol, month)
    checksum_payload = fetch(checksum_url, allow_404=True)
    if checksum_payload is None:
        return symbol, month, None, None
    expected = expected_checksum(checksum_payload)
    payload = fetch(url, allow_404=True)
    if payload is None:
        raise RuntimeError(f"Checksum exists but archive is missing: {url}")
    observed = sha256(payload)
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}: expected {expected}, observed {observed}")
    bars = parse_archive(payload, start_ms, end_ms)
    source = SourceFile(symbol, month, url, checksum_url, expected, observed, len(payload), len(bars))
    return symbol, month, bars, asdict(source)


def verify_universe(universe_path: Path, manifest: dict):
    universe = json.loads(universe_path.read_text(encoding="utf-8"))
    if universe.get("experimentId") != manifest["experimentId"]:
        raise RuntimeError("Universe experiment ID mismatch")
    if universe.get("status") != "UNIVERSE_FORMED_PRE_DEVELOPMENT":
        raise RuntimeError("Trial 3 universe is not frozen pre-development")
    if universe.get("postFormationDataInspected") is not False:
        raise RuntimeError("Universe file does not preserve the pre-development firewall")
    if universe.get("formationInformationEndExclusive") != "2023-01-01T00:00:00Z":
        raise RuntimeError("Unexpected formation information cutoff")
    membership = universe.get("membership") or []
    if len(membership) != manifest["universeFormation"]["membershipSize"] or len(set(membership)) != len(membership):
        raise RuntimeError("Frozen universe membership size/uniqueness mismatch")

    sources_path = Path(universe["formationSourceManifest"])
    if not sources_path.is_absolute():
        sources_path = Path.cwd() / sources_path
    if not sources_path.exists():
        raise RuntimeError(f"Formation source manifest missing: {sources_path}")
    observed_sha = sha256(sources_path.read_bytes())
    if observed_sha != universe.get("formationSourceManifestSha256"):
        raise RuntimeError("Formation source manifest SHA-256 mismatch")
    return universe, membership, observed_sha


def main():
    manifest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    universe_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_UNIVERSE
    out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_OUT
    sources_path = Path(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_SOURCES
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "cross-sectional-v1" or manifest.get("status") != "FROZEN_UNIVERSE_FORMATION_PENDING":
        raise RuntimeError("Expected frozen cross-sectional-v1 manifest")
    if out_path.exists() or sources_path.exists():
        raise RuntimeError("Trial 3 post-formation data output already exists; refusing overwrite")

    universe, membership, formation_sources_sha = verify_universe(universe_path, manifest)
    start_iso = manifest["historicalData"]["featureLookbackStart"]
    end_iso = manifest["historicalData"]["finalHoldoutEndExclusive"]
    start_ms = int(datetime.fromisoformat(start_iso.replace("Z", "+00:00")).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(end_iso.replace("Z", "+00:00")).timestamp() * 1000)
    if start_ms < int(datetime(2022, 10, 1, tzinfo=timezone.utc).timestamp() * 1000):
        raise RuntimeError("Unexpected pre-frozen feature lookback expansion")
    months = list(month_keys(start_iso, end_iso))

    by_symbol = {symbol: {} for symbol in membership}
    sources = []
    failures = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_symbol_month, symbol, month, start_ms, end_ms): (symbol, month)
            for symbol in membership for month in months
        }
        completed = 0
        for future in as_completed(futures):
            symbol, month = futures[future]
            try:
                _, _, bars, source = future.result()
            except Exception as error:
                failures.append({"symbol": symbol, "month": month, "error": str(error)})
                continue
            completed += 1
            if bars is not None:
                sources.append(source)
                for timestamp, row in bars.items():
                    prior = by_symbol[symbol].get(timestamp)
                    if prior is not None and prior != row:
                        raise RuntimeError(f"Conflicting duplicate {symbol} daily bar at {timestamp}")
                    by_symbol[symbol][timestamp] = row
            if completed % 250 == 0:
                print(f"processed {completed}/{len(futures)} member-month archives", file=sys.stderr)

    if failures:
        raise RuntimeError(f"Trial 3 source failures ({len(failures)}); first: {failures[:10]}")

    products = {}
    coverage = {}
    for symbol in membership:
        ordered = [by_symbol[symbol][timestamp] for timestamp in sorted(by_symbol[symbol])]
        products[symbol] = ordered
        coverage[symbol] = {
            "bars": len(ordered),
            "first": datetime.fromtimestamp(ordered[0]["time"], tz=timezone.utc).isoformat().replace("+00:00", "Z") if ordered else None,
            "last": datetime.fromtimestamp(ordered[-1]["time"], tz=timezone.utc).isoformat().replace("+00:00", "Z") if ordered else None,
        }

    dataset = {
        "experimentId": manifest["experimentId"],
        "paperOnly": True,
        "universeMembership": membership,
        "universeFile": str(universe_path),
        "universeMembershipSha256": sha256(canonical_json_bytes(membership)),
        "formationSourceManifestSha256": formation_sources_sha,
        "start": start_iso,
        "endExclusive": end_iso,
        "frequency": "1d",
        "products": products,
    }
    raw_dataset = canonical_json_bytes(dataset)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wb", compresslevel=9, mtime=0) as handle:
        handle.write(raw_dataset)
    dataset_sha = sha256(raw_dataset)

    sources.sort(key=lambda row: (row["symbol"], row["month"]))
    source_manifest = {
        "experimentId": manifest["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "universeMembership": membership,
        "universeMembershipSha256": dataset["universeMembershipSha256"],
        "formationSourceManifestSha256": formation_sources_sha,
        "datasetCanonicalJsonSha256": dataset_sha,
        "datasetGzipPath": str(out_path),
        "sourceArchiveCount": len(sources),
        "coverage": coverage,
        "sourceFiles": sources,
        "noInterpolation": True,
    }
    sources_path.parent.mkdir(parents=True, exist_ok=True)
    sources_path.write_text(json.dumps(source_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "dataset": str(out_path),
        "datasetCanonicalJsonSha256": dataset_sha,
        "sources": str(sources_path),
        "formationSourceManifestSha256": formation_sources_sha,
        "membership": membership,
        "coverage": coverage,
    }, indent=2))


if __name__ == "__main__":
    main()
