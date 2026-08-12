import csv
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "research" / "crypto" / "form-cross-sectional-universe.py"
spec = importlib.util.spec_from_file_location("form_cross_sectional_universe", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def utc_ms(year, month, day):
    return int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)


def kline_zip(rows):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        text = io.StringIO()
        writer = csv.writer(text, lineterminator="\n")
        for timestamp, close, quote_volume in rows:
            writer.writerow([
                timestamp, close, close, close, close, 1,
                timestamp + 86_400_000 - 1, quote_volume, 1, 1, quote_volume, 0
            ])
        archive.writestr("synthetic.csv", text.getvalue())
    return output.getvalue()


class CrossSectionalUniverseTest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "research" / "crypto" / "manifests" / "cross-sectional-v1.json").read_text())

    def test_symbol_filter_rejects_stables_fiat_and_leveraged_tokens(self):
        self.assertEqual(module.eligible_symbol("BTCUSDT", self.manifest), (True, "BTC"))
        self.assertEqual(module.eligible_symbol("ETHUSDT", self.manifest), (True, "ETH"))
        self.assertEqual(module.eligible_symbol("USDCUSDT", self.manifest)[0], False)
        self.assertEqual(module.eligible_symbol("EURUSDT", self.manifest)[0], False)
        self.assertEqual(module.eligible_symbol("BTCUPUSDT", self.manifest)[0], False)
        self.assertEqual(module.eligible_symbol("ETHDOWNUSDT", self.manifest)[0], False)
        self.assertEqual(module.eligible_symbol("BTCBUSD", self.manifest)[0], False)

    def test_daily_archive_parser_uses_quote_volume_and_ignores_post_2022_rows(self):
        payload = kline_zip([
            (utc_ms(2022, 1, 1), 100, 1_000_000),
            (utc_ms(2022, 1, 2), 101, 3_000_000),
            (utc_ms(2023, 1, 1), 102, 999_000_000),
        ])
        bars = module.parse_daily_zip(payload)
        self.assertEqual(len(bars), 2)
        self.assertEqual(sorted(row["quote_volume"] for row in bars.values()), [1_000_000, 3_000_000])

    def test_main_ranks_only_frozen_2022_information_with_lexicographic_tie_break(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            manifest = json.loads(json.dumps(self.manifest))
            manifest["universeFormation"]["minimumValidDailyBarsIn2022"] = 2
            manifest["universeFormation"]["membershipSize"] = 2
            manifest["universeFormation"]["mustHaveBarOnOrAfter"] = "2022-12-30T00:00:00Z"
            manifest_path = tmp / "manifest.json"
            universe_path = tmp / "universe.json"
            sources_path = tmp / "sources.json"
            manifest_path.write_text(json.dumps(manifest))

            historical = ["AAAUSDT", "BBBUSDT", "CCCUSDT", "USDCUSDT", "XYZUPUSDT"]
            volumes = {
                "AAAUSDT": [100.0, 100.0],
                "BBBUSDT": [200.0, 200.0],
                "CCCUSDT": [200.0, 200.0],
            }

            def fake_evaluate(symbol):
                rows = [
                    {"timestamp": utc_ms(2022, 1, 1), "close": 1.0, "quote_volume": volumes[symbol][0]},
                    {"timestamp": utc_ms(2022, 12, 31), "close": 1.0, "quote_volume": volumes[symbol][1]},
                ]
                sources = [{
                    "symbol": symbol,
                    "month": "2022-12",
                    "url": f"https://example.invalid/{symbol}.zip",
                    "checksum_url": f"https://example.invalid/{symbol}.zip.CHECKSUM",
                    "expected_sha256": "0" * 64,
                    "observed_sha256": "0" * 64,
                    "bytes": 1,
                    "bars": 2,
                }]
                return rows, sources

            argv = [str(SCRIPT), str(manifest_path), str(universe_path), str(sources_path)]
            with patch.object(module, "list_historical_symbols", return_value=historical), \
                 patch.object(module, "evaluate_symbol", side_effect=fake_evaluate), \
                 patch.object(sys, "argv", argv):
                module.main()

            universe = json.loads(universe_path.read_text())
            self.assertEqual(universe["membership"], ["BBBUSDT", "CCCUSDT"])
            self.assertFalse(universe["postFormationDataInspected"])
            self.assertEqual(universe["formationInformationEndExclusive"], "2023-01-01T00:00:00Z")
            self.assertEqual([row["symbol"] for row in universe["eligibleRanking"]], ["BBBUSDT", "CCCUSDT", "AAAUSDT"])
            self.assertEqual(len(universe["formationSourceManifestSha256"]), 64)

    def test_main_aborts_on_candidate_source_failure_instead_of_changing_universe(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            manifest = json.loads(json.dumps(self.manifest))
            manifest["universeFormation"]["minimumValidDailyBarsIn2022"] = 1
            manifest["universeFormation"]["membershipSize"] = 1
            manifest_path = tmp / "manifest.json"
            universe_path = tmp / "universe.json"
            sources_path = tmp / "sources.json"
            manifest_path.write_text(json.dumps(manifest))

            argv = [str(SCRIPT), str(manifest_path), str(universe_path), str(sources_path)]
            with patch.object(module, "list_historical_symbols", return_value=["AAAUSDT"]), \
                 patch.object(module, "evaluate_symbol", side_effect=RuntimeError("checksum failure")), \
                 patch.object(sys, "argv", argv):
                with self.assertRaises(RuntimeError):
                    module.main()
            self.assertFalse(universe_path.exists())


if __name__ == "__main__":
    unittest.main()
