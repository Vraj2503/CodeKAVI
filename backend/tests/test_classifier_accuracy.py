"""
test_classifier_accuracy.py — T4.7 classifier ground-truth evaluation.

Runs ``classifier.classify_files()`` against a labeled ground-truth set
across multiple popular open-source repos and reports per-role precision,
recall, F1. Asserts a minimum macro-F1 so regressions in the classifier
surface immediately in CI.

Setup:
    The labeled repos must be cloned locally. Run:

        python tests/eval_setup.py

    This populates ``tests/fixtures/classifier_eval/repos/`` with shallow
    clones of fastapi, express, django, react, flask.

If the repos are not present locally the test prints a clear skip
message but does NOT fail CI — useful for a first green run before the
clone is wired into the dev workflow. Once you have the clones (or run
``eval_setup.py``), the test executes and asserts ``macro_f1 >= 0.6``.

The classifier module under test is at ``codekavi.classifier`` and its
public surface is documented in that file's docstring.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "classifier_eval"
GROUND_TRUTH_PATH = FIXTURES_DIR / "ground_truth.json"
REPOS_DIR = FIXTURES_DIR / "repos"

EVAL_REPOS = {
    "fastapi": "https://github.com/tiangolo/fastapi.git",
    "express": "https://github.com/expressjs/express.git",
    "django": "https://github.com/django/django.git",
    "react": "https://github.com/facebook/react.git",
    "flask": "https://github.com/pallets/flask.git",
}

# Test macro-F1 floor — if better than this we pass. Tunable.
MACRO_F1_FLOOR = 0.6

# Role baseline aliasing — many classifier outputs are semantically equivalent
# under different keys. We project both expected and actual labels onto this
# canonical set before computing precision/recall.
ROLE_CANONICAL_ALIASES = {
    # entry_point stays entry_point
    "router": "router",
    "config": "config",
    "test": "test",
    "documentation": "documentation",
    "build": "build",
    "type_definition": "type_definition",
    "data": "data",
    "leaf": "leaf",
    # utility-ish
    "shared_utility": "shared_utility",
    "internal_helper": "shared_utility",
    "orchestrator": "shared_utility",
    "core_module": "shared_utility",
    # re-export
    "barrel": "barrel",
}


def _canonical(role: str) -> str:
    return ROLE_CANONICAL_ALIASES.get(role, role)


# ─────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def ground_truth() -> dict[str, list[dict[str, Any]]]:
    """Load the ground-truth JSON once for the entire test session."""
    if not GROUND_TRUTH_PATH.exists():
        pytest.skip(f"Ground truth file missing at {GROUND_TRUTH_PATH}")
    return json.loads(GROUND_TRUTH_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def eval_repos_present() -> dict[str, Path]:
    """
    Discover which EVAL_REPOS are checked out under REPOS_DIR.

    Returns a mapping ``{repo_label: clone_path}`` for repos whose
    ``HEAD`` is present. Missing repos are silently absent from the
    dict; the test reports them with a skip-style message instead of
    failing CI prematurely.
    """
    present: dict[str, Path] = {}
    if not REPOS_DIR.exists():
        return present
    for label in EVAL_REPOS:
        clone_path = REPOS_DIR / label
        if (clone_path.is_dir() and any(clone_path.glob("**/*.py"))) or any(clone_path.glob("**/*.js")):
            present[label] = clone_path
    return present


def _classify_repo(repo_label: str, repo_path: Path) -> list[dict[str, Any]]:
    """Run the analyzer + classifier pipeline on a local clone."""
    from codekavi.analyzer import analyze_dependencies
    from codekavi.classifier import classify_files
    from codekavi.traverser import traverse_repo
    from codekavi.utils import BoundedContentCache

    repo_data = traverse_repo(str(repo_path))
    files = repo_data["files"]
    if not files:
        # Some repos have shuffled files (test fixtures); bail early.
        return []
    # Files may be very large — cap the file list to keep the test fast.
    files = files[:400]
    content_cache = BoundedContentCache(max_bytes=8 * 1024 * 1024)
    try:
        dep_data = analyze_dependencies(str(repo_path), files, content_cache=content_cache)
        profiles = classify_files(str(repo_path), files, dep_data, content_cache=content_cache)
    finally:
        content_cache.clear()
    return profiles


def _index_profiles_by_path(profiles: list[dict]) -> dict[str, dict]:
    return {p["path"]: p for p in profiles}


def _evaluate(
    ground_truth: list[dict[str, Any]],
    profiles_by_path: dict[str, dict],
) -> tuple[dict[str, dict[str, int]], int]:
    """
    Compute per-role TP/FP/FN counts and the number of correctly-matched
    labels. ``ground_truth`` is a list of {path, expected_role}.

    Returns (per_role_counts, n_correct).
    """
    per_role: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    n_correct = 0
    for entry in ground_truth:
        path = entry["path"]
        expected = _canonical(entry["expected_role"])
        profile = profiles_by_path.get(path)
        if profile is None:
            # File absent or pruned (size limit / ignored dir). Treat as FN.
            per_role[expected]["fn"] += 1
            continue
        actual = _canonical(profile["role"])
        if actual == expected:
            per_role[expected]["tp"] += 1
            n_correct += 1
        else:
            per_role[expected]["fn"] += 1
            per_role[actual]["fp"] += 1
    return per_role, n_correct


def _macro_f1(per_role: dict[str, dict[str, int]]) -> tuple[float, dict[str, float]]:
    """Return (macro_f1, per_role_f1). Roles with TP+FP+FN == 0 are silently skipped."""
    per_role_f1: dict[str, float] = {}
    for role, counts in per_role.items():
        tp, fp, fn = counts["tp"], counts["fp"], counts["fn"]
        if tp + fp + fn == 0:
            continue
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        per_role_f1[role] = f1
    macro = sum(per_role_f1.values()) / len(per_role_f1) if per_role_f1 else 0.0
    return macro, per_role_f1


# ─────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────


class TestClassifierAccuracy:
    """Macro-F1 across labeled repos must clear the configured floor."""

    def test_at_least_one_repo_available(self, eval_repos_present):
        """If no repos are present, document how to set them up and skip cleanly."""
        if not eval_repos_present:
            msg = (
                "No ground-truth repos checked out under "
                f"{REPOS_DIR}. Run `python tests/eval_setup.py` to clone them, "
                "then re-run this test. Existing repos would be: "
                + ", ".join(EVAL_REPOS)
            )
            pytest.skip(msg)

    @pytest.mark.parametrize(
        "repo_label",
        sorted(EVAL_REPOS.keys()),
    )
    def test_repo_macro_f1(
        self,
        repo_label: str,
        ground_truth: dict[str, list[dict[str, Any]]],
        eval_repos_present: dict[str, Path],
    ):
        """Each repo (if cloned) must individually clear MACRO_F1_FLOOR."""
        repo_path = eval_repos_present.get(repo_label)
        if repo_path is None:
            pytest.skip(f"Repo {repo_label} not cloned at {REPOS_DIR / repo_label}")

        labels = ground_truth.get(f"{repo_label}_main", ground_truth.get(repo_label, []))
        if not labels:
            pytest.skip(f"No labels for repo {repo_label}")

        profiles = _classify_repo(repo_label, repo_path)
        by_path = _index_profiles_by_path(profiles)
        per_role, n_correct = _evaluate(labels, by_path)
        macro, per_role_f1 = _macro_f1(per_role)

        # Build a small ASCII report for failure / debugging visibility.
        report_lines = [
            f"{repo_label}: macro-F1={macro:.3f}  correct={n_correct}/{len(labels)}",
            "per-role:",
        ]
        for role in sorted(per_role_f1):
            f1 = per_role_f1[role]
            mark = "OK" if f1 >= 0.5 else "WEAK"
            report_lines.append(f"  {role:>18s}  F1={f1:.2f}  [{mark}]")
        report = "\n".join(report_lines)

        # Soft warn, hard assert.
        if macro < MACRO_F1_FLOOR:
            pytest.fail(
                f"Classifier F1 dropped for {repo_label}: {macro:.3f} < {MACRO_F1_FLOOR}\n"
                + report
                + "\nHint: tweak classifier.py thresholds, expand role detection, or "
                "update the ground-truth labels to match recent codebase shifts."
            )

        # Don't flood stdout on pass — but always include in -v run.
        print(f"\n{report}")


# ─────────────────────────────────────────────────────────────────────
# Helper: cloning the eval repos
# ─────────────────────────────────────────────────────────────────────


def setup_repos(verbose: bool = True) -> None:
    """
    Clone the eval repos shallowly into ``tests/fixtures/classifier_eval/repos``.

    Called manually via ``python tests/eval_setup.py``.
    """
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    for label, url in EVAL_REPOS.items():
        target = REPOS_DIR / label
        if target.exists() and any(target.iterdir()):
            if verbose:
                print(f"[skip] {label} already cloned at {target}")
            continue
        if target.exists():
            shutil.rmtree(target)
        if verbose:
            print(f"[clone] {label} → {target}")
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", url, str(target)],
                check=True,
                stdout=subprocess.PIPE if not verbose else None,
                stderr=subprocess.PIPE if not verbose else None,
            )
        except subprocess.CalledProcessError as e:
            print(f"[fail] could not clone {label}: {e.stderr}")
            continue


if __name__ == "__main__":
    # Allow direct invocation: `python tests/test_classifier_accuracy.py setup`
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "setup":
        setup_repos()
    else:
        print("Usage: python test_classifier_accuracy.py setup")
