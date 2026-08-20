"""
Tests for the importance score in rune/classifier.py.

The score decides which files reach the treemap, the tour and the explanation
budget, so the thing worth pinning down is that it is a plain equal-weighted
share of four measured quantities — not a taxonomy the reader cannot recompute.
"""

import pytest

from rune.classifier import _compute_importance, _importance_maxima
from rune.pipeline_models import FileProfile


def _profile(**kwargs) -> FileProfile:
    base = dict(
        path="a.py",
        name="a.py",
        language="Python",
        size=100,
        role="core_module",
        role_label="Core Module",
        role_confidence=1.0,
        depends_on=[],
        used_by=[],
        in_degree=0,
        out_degree=0,
        importance_score=0.0,
        tags=[],
    )
    return FileProfile(**{**base, **kwargs})


def test_leading_every_term_scores_100():
    maxima = (500, 10, 20, 30)
    assert _compute_importance(500, 10, 20, 30, maxima) == 100.0


def test_terms_are_weighted_equally():
    maxima = (100, 100, 100, 100)
    # One term at full, three at zero — a quarter of the scale, whichever term.
    assert _compute_importance(100, 0, 0, 0, maxima) == 25.0
    assert _compute_importance(0, 100, 0, 0, maxima) == 25.0
    assert _compute_importance(0, 0, 100, 0, maxima) == 25.0
    assert _compute_importance(0, 0, 0, 100, maxima) == 25.0


def test_a_term_nobody_scores_on_is_dropped_not_divided_by():
    """A repo with no imports anywhere still ranks its files by the rest."""
    maxima = (200, 0, 0, 8)
    assert _compute_importance(200, 0, 0, 8, maxima) == 50.0
    assert _compute_importance(100, 0, 0, 0, maxima) == 12.5


def test_maxima_treat_unmeasured_files_as_zero():
    """A file with no parser has loc/functions None — it must not crash the
    max, and it must not win it either."""
    profiles = [
        _profile(loc=120, functions=6, in_degree=2, out_degree=3),
        _profile(loc=None, functions=None, in_degree=9, out_degree=1),
    ]
    assert _importance_maxima(profiles) == (120, 3, 9, 6)
    assert _compute_importance(0, 1, 9, 0, _importance_maxima(profiles)) == pytest.approx(25.0 + 25.0 / 3)


if __name__ == "__main__":  # pragma: no cover
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
