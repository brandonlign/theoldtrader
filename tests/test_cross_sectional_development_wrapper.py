import gzip
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "research" / "crypto" / "prepare-cross-sectional-development-data.py"
spec = importlib.util.spec_from_file_location("trial3_dev_wrapper", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Trial3DevelopmentWrapperTest(unittest.TestCase):
    def test_first_archive_listing_uses_earliest_monthly_zip(self):
        xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Contents><Key>data/spot/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2021-02.zip.CHECKSUM</Key></Contents>
  <Contents><Key>data/spot/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2021-02.zip</Key></Contents>
  <Contents><Key>data/spot/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2020-12.zip</Key></Contents>
  <Contents><Key>data/spot/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2021-01.zip</Key></Contents>
</ListBucketResult>'''
        seen = []

        def fake_fetch(url):
            seen.append(url)
            return xml

        key, payload, url = module.list_first_archive("AAAUSDT", fake_fetch)
        self.assertEqual(key, "data/spot/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2020-12.zip")
        self.assertEqual(payload, xml)
        self.assertEqual(seen, [url])
        self.assertIn("prefix=data%2Fspot%2Fmonthly%2Fklines%2FAAAUSDT%2F1d%2F", url)

    def test_deterministic_gzip_writer_round_trips_and_is_byte_stable(self):
        payload = b'{"trial":3,"paperOnly":true}\n'
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "a.json.gz"
            second = Path(tmp) / "b.json.gz"
            module.deterministic_gzip_write(first, payload)
            module.deterministic_gzip_write(second, payload)
            with gzip.open(first, "rb") as handle:
                self.assertEqual(handle.read(), payload)
            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
