#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "research" / "crypto" / "prepare-cross-sectional-final-data.py"


class Trial3FinalWrapperGateTest(unittest.TestCase):
    def run_wrapper(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "does-not-exist-manifest.json",
                "does-not-exist-universe.json",
                "does-not-exist-output.json.gz",
                "does-not-exist-sources.json",
                *extra,
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_refuses_final_acquisition_without_explicit_confirmation(self) -> None:
        result = self.run_wrapper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--confirm-final YES", result.stderr + result.stdout)
        self.assertNotIn("does-not-exist-manifest", result.stderr)

    def test_refuses_wrong_confirmation_token_before_manifest_access(self) -> None:
        result = self.run_wrapper("--confirm-final", "NO")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--confirm-final YES", result.stderr + result.stdout)
        self.assertNotIn("does-not-exist-manifest", result.stderr)


if __name__ == "__main__":
    unittest.main()
