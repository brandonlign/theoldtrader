#!/usr/bin/env python3
"""Freeze the Trial 3 universe from 2022 information only.

This file deliberately forms the membership before any Trial 3 post-formation
performance data are requested.  See TRIAL3_FROZEN.md and the manifest for the
scientific rules.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import statistics
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://data.binance.vision/data/spot/monthly/klines"
CHECKSUM_SUFFIX = ".CHECKSUM"
SYMBOLS_URL = "https://api.binance.com/api/v3/exchangeInfo"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "TheOldTrader-Research/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def parse_checksum(raw: bytes) -> str:
    token = raw.decode("utf-8").strip().split()[0]
    if not re.fullmatch(r"[0-9a-fA-F]{64}", token):
        raise ValueError("Invalid adjacent checksum payload")
    return token.lower()


def verify_archive(url: str, raw: bytes) -> dict:
    checksum_raw = get_bytes(url + CHECKSUM_SUFFIX)
    expected = parse_checksum(checksum_raw)
    actual = sha256(raw)
    if expected != actual:
        raise ValueError(f"Checksum mismatch for {url}: expected {expected}, got {actual}")
    return {"url": url, "sha256": actual, "checksumUrl": url + CHECKSUM_SUFFIX, "checksumSha256": sha256(checksum_raw)}


def parse_daily_klines(zip_bytes: bytes) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.endswith(".csv")]
        if len(names) != 1:
            raise ValueError(f"Expected one CSV in Binance archive, found {len(names)}")
        text = zf.read(names[0]).decode("utf-8")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        try:
            open_time = int(row[0])
            quote_volume = float(row[7])
        except (ValueError, IndexError):
            # Newer archives may include a header; skip it deterministically.
            continue
        # Binance has historically emitted both millisecond and microsecond timestamps.
        if open_time > 10**14:
            open_time //= 1000
        dt = datetime.fromtimestamp(open_time / 1000, timezone.utc)
        rows.append({"date": dt.date().isoformat(), "quoteVolume": quote_volume})
    return rows


def historical_symbols_from_exchange_info(payload: dict, formation_end: datetime) -> list[str]:
    # This function is intentionally conservative: current exchangeInfo alone cannot
    # establish historical membership.  It is used only when supplied a preserved
    # historical payload by tests / future first-party snapshots.
    symbols = []
    for item in payload.get("symbols", []):
        symbol = item.get("symbol")
        if isinstance(symbol, str):
            symbols.append(symbol)
    return sorted(set(symbols))


def excluded_symbol(symbol: str, formation: dict) -> bool:
    if not symbol.endswith(formation["quoteAsset"]):
        return True
    base = symbol[: -len(formation["quoteAsset"])]
    stable = set(formation["excludeBaseAssets"])
    if base in stable:
        return True
    suffixes = tuple(formation["excludeLeveragedTokenSuffixes"])
    if base.endswith(suffixes):
        return True
    return False


def enumerate_historical_symbols(manifest: dict) -> tuple[list[str], list[dict]]:
    """Enumerate symbols from Binance Vision's historical 2022 file listing.

    The listing is first-party historical file availability, not today's survivor
    list.  The exact listing HTML is preserved and hashed in source metadata.
    """
    formation = manifest["universeFormation"]
    prefix = "https://data.binance.vision/?prefix=data/spot/monthly/klines/"
    raw = get_bytes(prefix)
    text = raw.decode("utf-8", errors="replace")
    candidates = sorted(set(re.findall(r"data/spot/monthly/klines/([A-Z0-9]+)/", text)))
    if not candidates:
        # The website may serve its S3 XML listing directly under this endpoint.
        candidates = sorted(set(re.findall(r"<Key>data/spot/monthly/klines/([A-Z0-9]+)/", text)))
    if not candidates:
        raise ValueError("Could not enumerate historical Binance Vision symbol prefixes")
    filtered = [s for s in candidates if not excluded_symbol(s, formation)]
    return filtered, [{"url": prefix, "sha256": sha256(raw), "bytes": len(raw), "kind": "historical_symbol_prefix_listing"}]


def month_ids(start: str, end_exclusive: str) -> list[str]:
    sy, sm = map(int, start[:7].split("-"))
    ey, em = map(int, end_exclusive[:7].split("-"))
    out = []
    y, m = sy, sm
    while (y, m) < (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m = 1
            y += 1
    return out


def median_daily_quote_volume(rows: list[dict], start_date: str, end_date: str) -> tuple[int, float | None, str | None]:
    values = []
    last_date = None
    for row in rows:
        d = row["date"]
        if start_date <= d < end_date:
            values.append(row["quoteVolume"])
            if last_date is None or d > last_date:
                last_date = d
    return len(values), (statistics.median(values) if values else None), last_date


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text())
    if data.get("experimentId") != "cross-sectional-v1":
        raise ValueError("Wrong manifest for Trial 3 universe formation")
    return data


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("universe_output")
    parser.add_argument("sources_output")
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    universe_path = Path(args.universe_output)
    sources_path = Path(args.sources_output)
    manifest = load_manifest(manifest_path)
    formation = manifest["universeFormation"]
    information_start = formation["informationWindow"]["startInclusive"][:10]
    information_end = formation["informationWindow"]["endExclusive"][:10]
    membership_size = int(formation["membershipSize"])

    candidates, listing_sources = enumerate_historical_symbols(manifest)
    all_historical_symbols = list(candidates)
    months = month_ids(formation["informationWindow"]["startInclusive"], formation["informationWindow"]["endExclusive"])
    ranked = []
    all_sources = list(listing_sources)

    for symbol in candidates:
        rows = []
        sources = []
        complete = True
        for month in months:
            filename = f"{symbol}-1d-{month}.zip"
            url = f"{BASE}/{symbol}/1d/{filename}"
            try:
                raw = get_bytes(url)
                meta = verify_archive(url, raw)
            except Exception as exc:
                complete = False
                break
            meta.update({"symbol": symbol, "month": month, "bytes": len(raw)})
            sources.append(meta)
            rows.extend(parse_daily_klines(raw))
        if not complete:
            continue
        valid_count, median_qv, last_date = median_daily_quote_volume(rows, information_start, information_end)
        if valid_count < int(formation["minimumValidDailyBarsIn2022"]):
            continue
        if last_date is None or last_date < formation["mustHaveBarOnOrAfter"]:
            continue
        ranked.append({
            "symbol": symbol,
            "validDailyBars2022": valid_count,
            "medianDailyQuoteVolume2022": median_qv,
            "lastDailyBar2022": last_date,
        })
        all_sources.extend(sources)

    ranked.sort(key=lambda row: (-row["medianDailyQuoteVolume2022"], row["symbol"]))
    if len(ranked) < membership_size:
        raise ValueError(f"Only {len(ranked)} eligible historical symbols, need {membership_size}")
    membership = [row["symbol"] for row in ranked[:membership_size]]
    eligible = ranked

    all_sources.sort(key=lambda row: (row.get("symbol", ""), row.get("month", ""), row["url"]))
    sources_payload = {
        "experimentId": manifest["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "informationWindow": formation["informationWindow"],
        "historicalSymbolPrefixCount": len(all_historical_symbols),
        "candidateUsdtSymbolCount": len(candidates),
        "sourceArchiveCount": len(all_sources) - len(listing_sources),
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
        "postFormationDataInspected": False,
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
    universe_path.parent.mkdir(parents=True, exist_ok=True)
    universe_path.write_bytes(universe_bytes)
    print(json.dumps({"membership": membership, "sourcesSha256": sources_sha}, indent=2))


if __name__ == "__main__":
    main()
