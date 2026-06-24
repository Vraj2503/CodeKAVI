#!/usr/bin/env python
"""
eval_setup.py — T4.7 helper script.

Shallow-clones the labeled repos under ``tests/fixtures/classifier_eval/repos/``
so ``tests/test_classifier_accuracy.py`` can score the classifier against real
codebases.

Usage::

    python tests/eval_setup.py

Re-running is safe — existing clones are left untouched.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the test module importable for its setup_repos() function.
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))
BACKEND_DIR = TESTS_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from tests.test_classifier_accuracy import setup_repos  # noqa: E402


def main() -> int:
    setup_repos(verbose=True)
    print("\nSetup complete. Run the accuracy test with:")
    print("    pytest tests/test_classifier_accuracy.py -v")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
