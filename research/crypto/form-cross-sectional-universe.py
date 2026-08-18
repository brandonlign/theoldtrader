#!/usr/bin/env python3
"""Form the immutable 2022-only universe for cross-sectional-v1.

This stage is deliberately isolated from all 2023+ Trial 3 data. It enumerates
historical Binance Vision symbol prefixes rather than current exchangeInfo, then
uses checksum-verified 2022 monthly 1d archives to rank eligible USDT pairs by
median daily quote-asset volume. It never downloads post-2022 price data.
"""

from __future__ import annotations

import hashlib
import io
import json
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

S3_LIST_ENDPOINT = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
DATA_BASE = "https://data.binance.vision/"
PREFIX = "data/spot/monthly/klines/"
INTERVAL = "1d"
FORMATION_YEAR = 2022
MAX_WORKERS = 16
DEFAULT_MANIFEST = Path("research/crypto/manifests/cross-sectional-v1.json")
DEFAULT_UNIVERSE = Path("research/crypto/universes/cross-sectional-v1-universe.json")
DEFAULT_SOURCES = Path("research/crypto/universes/cross-sectional-v1-formation-sources.json")
S3_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}


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


def list_historical_symbols():
    symbols = []
    continuation = None
    while True:
        params = {
            "list-type": "2",
            "delimiter": "/",
            "prefix": PREFIX,
            "max-keys": "1000",
        }
        if continuation:
            params["continuation-token"] = continuation
        url = f"{S3_LIST_ENDPOINT}?{urllib.parse.urlencode(params)}"
        payload = fetch(url)
        root = ET.fromstring(payload)
        for node in root.findall("s3:CommonPrefixes/s3:Prefix", S3_NS):
            text = node.text or ""
            if not text.startswith(PREFIX) or not text.endswith("/"):
                continue
            symbol = text[len(PREFIX):-1]
            if symbol:
                symbols.append(symbol)
        truncated = (root.findtext("s3:IsTruncated", default="false", namespaces=S3_NS) or "false").lower() == "true"
        if not truncated:
            break
        continuation = root.findtext("s3:NextContinuationToken", namespaces=S3_NS)
        if not continuation:
            raise RuntimeError("S3 listing says truncated but has no continuation token")
    return sorted(set(symbols))


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


def parse_daily_zip(payload: bytes):
    result = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise RuntimeError(f"Expected one CSV in archive, found {names}")
        with archive.open(names[0]) as handle:
            for raw_line in handle:
                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                cells = line.split(",")
                if len(cells) < 8:
                    continue
                try:
                    timestamp = normalize_ms(cells[0])
                    close = float(cells[4])
                    quote_volume = float(cells[7])
                except (ValueError, TypeError):
                    continue
                dt = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
                if dt.year != FORMATION_YEAR:
                    continue
                if close <= 0 or quote_volume < 0:
                    continue
                prior = result.get(timestamp)
                value = {"timestamp": timestamp, "close": close, "quote_volume": quote_volume}
                if prior is not None and prior != value:
                    raise RuntimeError(f"Conflicting duplicate daily bar at {timestamp}")
                result[timestamp] = value
    return result


def month_url(symbol: str, month: int):
    ym = f"{FORMATION_YEAR}-{month:02d}"
    relative = f"data/spot/monthly/klines/{symbol}/{INTERVAL}/{symbol}-{INTERVAL}-{ym}.zip"
    url = DATA_BASE + relative
    return ym, url, url + ".CHECKSUM"


def download_month(symbol: str, month: int):
    ym, url, checksum_url = month_url(symbol, month)
    checksum_payload = fetch(checksum_url, allow_404=True)
    if checksum_payload is None:
        return None, None
    expected = expected_checksum(checksum_payload)
    payload = fetch(url, allow_404=True)
    if payload is None:
        raise RuntimeError(f"Checksum exists but archive is missing: {url}")
    observed = sha256(payload)
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {url}: expected {expected}, observed {observed}")
    bars = parse_daily_zip(payload)
    metadata = SourceFile(symbol, ym, url, checksum_url, expected, observed, len(payload), len(bars))
    return bars, metadata


def evaluate_symbol(symbol: str):
    bars = {}
    sources = []
    for month in range(1, 13):
        month_bars, source = download_month(symbol, month)
        if source is None:
            continue
        sources.append(asdict(source))
        for timestamp, row in month_bars.items():
            if timestamp in bars and bars[timestamp] != row:
                raise RuntimeError(f"Conflicting cross-month duplicate for {symbol} at {timestamp}")
            bars[timestamp] = row
    ordered = [bars[key] for key in sorted(bars)]
    return ordered, sources


def eligible_symbol(symbol: str, manifest: dict):
    formation = manifest["universeFormation"]
    quote = formation["quoteAsset"]
    if not symbol.endswith(quote) or len(symbol) <= len(quote):
        return False, None
    base = symbol[:-len(quote)]
    if base in set(formation["excludeBaseAssets"]):
        return False, base
    if any(base.endswith(suffix) for suffix in formation["excludeBaseSuffixes"]):
        return False, base
    return True, base


def main():
    manifest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    universe_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_UNIVERSE
    sources_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SOURCES
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("experimentId") != "cross-sectional-v1" or manifest.get("status") != "FROZEN_UNIVERSE_FORMATION_PENDING":
        raise RuntimeError("Expected frozen cross-sectional-v1 universe-formation manifest")
    if universe_path.exists() or sources_path.exists():
        raise RuntimeError("Universe formation output already exists; refusing overwrite")

    formation = manifest["universeFormation"]
    if formation["informationWindow"]["endExclusive"] != "2023-01-01T00:00:00Z":
        raise RuntimeError("Formation firewall requires a strict pre-2023 information window")

    all_historical_symbols = list_historical_symbols()
    candidates = []
    excluded = []
    for symbol in all_historical_symbols:
        ok, base = eligible_symbol(symbol, manifest)
        if ok:
            candidates.append(symbol)
        else:
            excluded.append({"symbol": symbol, "base": base})

    results = {}
    all_sources = []
    failures = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(evaluate_symbol, symbol): symbol for symbol in candidates}
        completed = 0
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                bars, sources = future.result()
            except Exception as error:
                failures.append({"symbol": symbol, "error": str(error)})
                continue
            all_sources.extend(sources)
            completed += 1
            if not bars:
                continue
            valid_count = len(bars)
            last_bar_ms = max(row["timestamp"] for row in bars)
            quote_volumes = [row["quote_volume"] for row in bars]
            median_quote_volume = statistics.median(quote_volumes)
            results[symbol] = {
                "validDailyBars": valid_count,
                "firstBar": datetime.fromtimestamp(min(row["timestamp"] for row in bars) / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                "lastBar": datetime.fromtimestamp(last_bar_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                "medianDailyQuoteVolume": median_quote_volume,
                "sourceArchiveCount": len(sources),
            }
            if completed % 50 == 0:
                print(f"processed {completed}/{len(candidates)} candidate symbols", file=sys.stderr)

    if failures:
        # A network/checksum/parse failure is not equivalent to a missing historical month.
        # Abort formation rather than silently changing the candidate set.
        sample = failures[:10]
        raise RuntimeError(f"Universe formation had {len(failures)} candidate-source failures; first failures: {sample}")

    must_have_ms = int(datetime.fromisoformat(formation["mustHaveBarOnOrAfter"].replace("Z", "+00:00")).timestamp() * 1000)
    eligible = []
    for symbol, stats in results.items():
        last_ms = int(datetime.fromisoformat(stats["lastBar"].replace("Z", "+00:00")).timestamp() * 1000)
        if stats["validDailyBars"] < formation["minimumValidDailyBarsIn2022"]:
            continue
        if last_ms < must_have_ms:
            continue
        eligible.append({"symbol": symbol, **stats})

    eligible.sort(key=lambda row: (-row["medianDailyQuoteVolume"], row["symbol"]))
    membership_size = int(formation["membershipSize"])
    if len(eligible) < membership_size:
        raise RuntimeError(f"Only {len(eligible)} symbols satisfy frozen formation criteria; need {membership_size}")
    membership = [row["symbol"] for row in eligible[:membership_size]]

    all_sources.sort(key=lambda row: (row["symbol"], row["month"]))
    sources_payload = {
        "experimentId": manifest["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "informationWindow": formation["informationWindow"],
        "historicalSymbolPrefixCount": len(all_historical_symbols),
        "candidateUsdtSymbolCount": len(candidates),
        "sourceArchiveCount": len(all_sources),
        "sourceFiles": all_sources,
    }
    sources_bytes = (json.dumps(sources_payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    sources_sha = sha256(sources_bytes)
    sources_path.parent.mkdir(parents=True, exist_ok=True)
    sources_path.write_bytes(sources_bytes)

    universe = {
        "experimentId": manifest["experimentId"],
        "status": "UNIVERSE_FORMED_PRE_DEVELOPMENT",
        "formedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "formationInformationEndExclusive": formation["informationWindow"]["endExclusive"],
        "postFormationDataInspected": false,
        "membershipSize": membership_size,
        "membership": membership,
        "eligibleRanking": eligible,
        "formationSourceManifest": str(sources_path),
        "formationSourceManifestSha256": sources_sha,
        "ruleSummary": {
            "quoteAsset": formation["quoteAsset"],
            "minimumValidDailyBarsIn2022": formation["minimumValidDailyBarsIn2022"],
            "mustHaveBarOnOrAfter": formation["mustHaveBarOnOrAfter"],
            "liquidityMeasure": formation["liquidityMeasure"],
            "tieBreak": "symbol lexicographic",
        },
    }
    universe_bytes = (json.dumps(universe, indent=2, sort_keys=True) + "\n").encode("utf-8")
    universe_path.write_bytes(universe_bytes)
    print(json.dumps({
        "universe": str(universe_path),
        "universeSha256": sha256(universe_bytes),
        "sources": str(sources_path),
        "sourcesSha256": sources_sha,
        "historicalSymbols": len(all_historical_symbols),
        "candidateUsdtSymbols": len(candidates),
        "eligibleSymbols": len(eligible),
        "membership": membership,
    }, indent=2))


if __name__ == "__main__":
    main()
