"""
conftest.py — Shared test fixtures for CodeKavi.

Provides:
  - sample_repo_path: path to the committed multi-language fixture repo
  - sample_file_list: pre-built file list matching traverser output format
  - sample_dep_data: pre-built dependency data matching analyzer output format
  - test_client: httpx AsyncClient wired to the FastAPI app (with mocked externals)
"""

import os
import sys

import pytest

# Ensure backend root is on sys.path so `codekavi` is importable
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


# ─────────────────────────────────────────
# Fixture: sample repo path
# ─────────────────────────────────────────

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
SAMPLE_REPO_DIR = os.path.join(FIXTURES_DIR, "sample_repo")


@pytest.fixture
def sample_repo_path() -> str:
    """Absolute path to the committed sample multi-language repo."""
    assert os.path.isdir(SAMPLE_REPO_DIR), (
        f"Fixture repo not found at {SAMPLE_REPO_DIR}. Run the test setup or check tests/fixtures/sample_repo/."
    )
    return SAMPLE_REPO_DIR


# ─────────────────────────────────────────
# Fixture: pre-built file list (traverser format)
# ─────────────────────────────────────────


@pytest.fixture
def sample_file_list(sample_repo_path: str) -> list[dict]:
    """
    Flat file list matching the output of traverser.traverse_repo()["files"].
    Built dynamically from the fixture repo on disk.
    """
    from codekavi.traverser import traverse_repo

    repo_data = traverse_repo(sample_repo_path)
    return repo_data["files"]


# ─────────────────────────────────────────
# Fixture: pre-built dependency data (analyzer format)
# ─────────────────────────────────────────


@pytest.fixture
def sample_dep_data(sample_repo_path: str, sample_file_list: list[dict]) -> dict:
    """
    Dependency analysis result matching the output of analyzer.analyze_dependencies().
    """
    from codekavi.analyzer import analyze_dependencies

    dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
    # Pop content_cache like the real pipeline does
    dep_data.pop("content_cache", None)
    return dep_data


# ─────────────────────────────────────────
# Fixture: file profiles (classifier format)
# ─────────────────────────────────────────


@pytest.fixture
def sample_file_profiles(
    sample_repo_path: str,
    sample_file_list: list[dict],
    sample_dep_data: dict,
) -> list[dict]:
    """
    File profiles matching the output of classifier.classify_files().
    """
    from codekavi.classifier import classify_files

    return classify_files(sample_repo_path, sample_file_list, sample_dep_data)


@pytest.fixture(autouse=True)
def override_auth():
    """Bypass Supabase JWT auth verification during tests."""
    from main import app

    from codekavi.auth import verify_supabase_token

    app.dependency_overrides[verify_supabase_token] = lambda: "test-user-123"
    yield
    app.dependency_overrides.pop(verify_supabase_token, None)


@pytest.fixture(autouse=True)
def setup_app_state():
    """Ensure app.state.cache and app.state.executor are initialized for all tests."""
    from concurrent.futures import ThreadPoolExecutor

    from main import app

    from codekavi.cache import AnalysisCache
    from codekavi.settings import settings

    settings.supabase_jwt_secret = "dummy_secret_for_testing_purposes_only_12345"

    executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="test-global-")
    cache = AnalysisCache()
    app.state.executor = executor
    app.state.cache = cache
    yield
    executor.shutdown(wait=True)


@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable slowapi rate limiting for all tests by default."""
    from codekavi.limiter import limiter

    limiter.enabled = False
    yield
    limiter.enabled = True
