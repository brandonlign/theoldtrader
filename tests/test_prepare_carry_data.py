import csv
import importlib.util
import io
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "research" / "crypto" / "prepare-carry-data.py"
spec = importlib.util.spec_from_file_location("prepare_carry_data", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def utc_ms(year, month, day, hour=0):
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp() * 1000)


def funding_zip(rows):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        text = io.StringIO()
        writer = csv.writer(text, lineterminator="\n")
        writer.writerow(["calc_time", "last_funding_rate"])
        writer.writerows(rows)
        archive.writestr("BTCUSDT-fundingRate-test.csv", text.getvalue())
    return output.getvalue()


class FundingTimestampNormalizationTest(unittest.TestCase):
    def test_millisecond_jitter_maps_to_scheduled_boundary(self):
        boundary = utc_ms(2021, 5, 1, 0)
        for skew in (2, 6, -3, 60_000, -60_000):
            scheduled, observed_skew = module.scheduled_funding_boundary(boundary + skew)
            self.assertEqual(scheduled, boundary)
            self.assertEqual(observed_skew, skew)

    def test_outside_frozen_tolerance_is_rejected(self):
        boundary = utc_ms(2021, 5, 1, 8)
        with self.assertRaises(RuntimeError):
            module.scheduled_funding_boundary(boundary + 60_001)
        with self.assertRaises(RuntimeError):
            module.scheduled_funding_boundary(boundary - 60_001)

    def test_parse_preserves_raw_timestamp_and_rate(self):
        start = utc_ms(2021, 5, 1, 0)
        end = utc_ms(2021, 5, 2, 0)
        payload = funding_zip([
            [start + 2, "0.00010000"],
            [start + module.EIGHT_HOURS_MS + 6, "-0.00005000"],
            [start + 2 * module.EIGHT_HOURS_MS - 3, "0.00007500"],
        ])
        parsed = module.parse_funding(payload, start, end, module.FUNDING_SKEW_TOLERANCE_MS)
        self.assertEqual(sorted(parsed), [start, start + module.EIGHT_HOURS_MS, start + 2 * module.EIGHT_HOURS_MS])
        first = parsed[start]
        self.assertEqual(first.raw_timestamp_ms, start + 2)
        self.assertEqual(first.scheduled_timestamp_ms, start)
        self.assertEqual(first.skew_ms, 2)
        self.assertAlmostEqual(first.rate, 0.0001)

    def test_two_raw_observations_cannot_collapse_to_one_payment(self):
        start = utc_ms(2021, 5, 1, 0)
        end = utc_ms(2021, 5, 1, 8)
        payload = funding_zip([
            [start + 2, "0.00010000"],
            [start + 8, "0.00010000"],
        ])
        with self.assertRaises(RuntimeError):
            module.parse_funding(payload, start, end, module.FUNDING_SKEW_TOLERANCE_MS)


if __name__ == "__main__":
    unittest.main()
