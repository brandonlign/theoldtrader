#!/usr/bin/env python3
"""Compatibility entrypoint for the already-frozen Trial 3 universe builder.

The frozen builder was committed with one Python spelling defect in its output
serialization (`false` instead of `False`).  The defect is unrelated to data
selection, ranking, thresholds, or any economic rule.  This entrypoint exposes
that name as the Python boolean False and executes the frozen builder unchanged,
so the scientific specification and source code remain auditable as originally
frozen while universe formation can complete.
"""

import builtins
import runpy
from pathlib import Path

builtins.false = False
runpy.run_path(
    str(Path(__file__).with_name("form-cross-sectional-universe.py")),
    run_name="__main__",
)
