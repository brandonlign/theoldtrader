import importlib.util
import json
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).parents[1] / "research" / "crypto" / "prepare-ctrend-rest-data.py"
spec = importlib.util.spec_from_file_location("prepare_ctrend_rest_data", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CtrendRestDataTests(unittest.TestCase):
    def manifest(self):
        return {
            "historicalData": {
                "indicatorLookbackStart": "2022-01-01T00:00:00Z",
                "developmentEndExclusive": "2026-01-01T00:00:00Z",
                "developmentAcquisitionHardStop": "2026-01-01T00:00:00Z",
                "finalHoldoutStart": "2026-01-01T00:00:00Z",
                "finalHoldoutEndExclusive": "2026-08-01T00:00:00Z",
            }
        }

    def test_development_and_final_windows_are_separate(self):
        self.assertEqual(
            module.resolve_acquisition_window(self.manifest(), "development"),
            ("2022-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
        )
        with self.assertRaises(RuntimeError):
            module.resolve_acquisition_window(self.manifest(), "final", "NO")
        self.assertEqual(
            module.resolve_acquisition_window(self.manifest(), "final", "YES")[1],
            "2026-08-01T00:00:00Z",
        )

    def test_kline_parser_keeps_only_required_daily_fields(self):
        start = 1640995200000
        end = start + module.ONE_DAY_MS
        payload = json.dumps([[
            start, "10", "11", "9", "10.5", "7", end - 1, "123.45", 42, "0", "0", "0"
        ]]).encode()
        _, rows = module.parse_kline_rows(payload, "TESTUSDT", start, end)
        self.assertEqual(rows, [{
            "time": start // 1000,
            "open": 10.0,
            "high": 11.0,
            "low": 9.0,
            "close": 10.5,
            "quoteVolume": 123.45,
        }])

    def test_non_midnight_daily_open_aborts(self):
        start = 1640995200000
        payload = json.dumps([[
            start + 1, "10", "11", "9", "10.5", "7", start + module.ONE_DAY_MS - 1, "123.45", 42, "0", "0", "0"
        ]]).encode()
        with self.assertRaises(RuntimeError):
            module.parse_kline_rows(payload, "TESTUSDT", start, start + module.ONE_DAY_MS,)


if __name__ == "__main__":
    unittest.main()
