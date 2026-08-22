import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).parents[1] / "research" / "crypto" / "prepare-ctrend-data.py"
spec = importlib.util.spec_from_file_location("prepare_ctrend_data", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CtrendAcquisitionWindowTests(unittest.TestCase):
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

    def test_development_stops_before_holdout(self):
        start, end = module.resolve_acquisition_window(self.manifest(), "development")
        self.assertEqual(start, "2022-01-01T00:00:00Z")
        self.assertEqual(end, "2026-01-01T00:00:00Z")

    def test_final_requires_explicit_confirmation(self):
        with self.assertRaises(RuntimeError):
            module.resolve_acquisition_window(self.manifest(), "final", "NO")
        _, end = module.resolve_acquisition_window(self.manifest(), "final", "YES")
        self.assertEqual(end, "2026-08-01T00:00:00Z")

    def test_boundary_mismatch_aborts(self):
        manifest = self.manifest()
        manifest["historicalData"]["developmentAcquisitionHardStop"] = "2026-02-01T00:00:00Z"
        with self.assertRaises(RuntimeError):
            module.resolve_acquisition_window(manifest, "development")


if __name__ == "__main__":
    unittest.main()
