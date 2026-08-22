#!/usr/bin/env python3
"""Stable unittest entrypoint for carry-source parsing regressions."""
import importlib.util
import pathlib
import unittest

TARGET = pathlib.Path(__file__).with_name('test_prepare_carry_data.py')
spec = importlib.util.spec_from_file_location('test_prepare_carry_data', TARGET)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

if __name__ == '__main__':
    unittest.main(module=module)
