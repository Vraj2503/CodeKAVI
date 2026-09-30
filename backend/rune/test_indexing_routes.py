"""Route wiring for index status and deduplicated analyses.

Drives the real /analyze, /analyze/stream, /restore and /chat handlers against
an in-memory AnalysisCache. Only the clone, the pipeline stages, Zilliz and the
LLM quota tracker are stubbed, so what's under test is how the routes save,
point at, and report on vectors.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rune import fingerprint, limiter, vectorstore
from rune.auth import verify_supabase_token
from rune.cache import AnalysisCache
from rune.fingerprint import ChangeClassification
from rune.index_status import make_status
from rune.pipeline_models import DepGraph, RepoData
from rune.routes import analyze as analyze_routes
from rune.routes import chat as chat_routes
from rune.routes.dependencies import get_cache
from rune.session import ensure_repo_loaded
from rune.settings import settings
from rune.task_registry import BackgroundTaskRegistry

ROOT = "aaaaaaaaaaaa"
ORIGIN = "0123456789ab"
NEW = "fedcba987654"
SIGNATURE = "octo/demo@abc123"
URL = "https://github.com/octo/demo"


def _analysis(owner_user_id: str, **extra) -> dict:
    return {
        "repo_name": "demo",
        "owner": "octo",
        "owner_user_id": owner_user_id,
        "repo_data": {
            "total_files": 1,
            "total_size": 10,
            "total_size_formatted": "10 B",
            "languages": {"Python": 1},
            "tree": [],
            "files": [],
            "skipped_files": [],
        },
        "dep_data": {},
        "file_profiles": [],
        "role_summary": {},
        "graph_json": {"nodes": [], "edges": []},
        "module_graph": {},
        "nn_models": [],
        **extra,
    }


@pytest.fixture
def cache():
    in_memory = AnalysisCache()
    in_memory._redis_available = False
    in_memory._supabase_available = False
    return in_memory


@pytest.fixture
def app(cache):
    limiter._local_buckets.clear()
    chat_routes._validated_repos.clear()
    application = FastAPI()
    application.include_router(analyze_routes.router, prefix="/api")
    application.include_router(chat_routes.router, prefix="/api")
    application.state.task_registry = BackgroundTaskRegistry()
    application.dependency_overrides[get_cache] = lambda: cache
    return application


def client_for(app: FastAPI, user_id: str) -> TestClient:
    app.dependency_overrides[verify_supabase_token] = lambda: user_id
    return TestClient(app)


@pytest.fixture
def clone(monkeypatch, tmp_path):
    info = {
        "repo_id": NEW,
        "repo_name": "demo",
        "owner": "octo",
        "clone_path": str(tmp_path / f"demo_{NEW}"),
        "commit_sha": "abc123",
        "repo_signature": SIGNATURE,
    }
    monkeypatch.setattr(analyze_routes, "clone_repo", lambda url: dict(info))
    return info


@pytest.fixture
def pipeline(monkeypatch):
    """Stub the analysis stages and the index job; returns the jobs scheduled."""
    repo_data = RepoData(
        total_files=0, total_size=0, total_size_formatted="0 B", languages={}, tree=[], files=[], skipped_files=[]
    )
    monkeypatch.setattr(analyze_routes, "traverse_repo", lambda path: repo_data)
    monkeypatch.setattr(
        fingerprint, "compare_and_classify_repo", lambda *args, **kwargs: ({}, set(), ChangeClassification.FULL_UPDATE)
    )

    result = analyze_routes.PipelineResult(
        dep_data=DepGraph(
            edges=[],
            adjacency={},
            reverse_adjacency={},
            file_imports={},
            entry_points=[],
            file_signals={},
            central_files=[],
            stats={},
        ),
        dep_data_dict={},
        file_profiles=[],
        file_profiles_dicts=[],
        role_summary={},
        graph_json={"nodes": [], "edges": []},
        module_graph={},
        cycles_data={"has_cycles": False, "cycles": []},
        mermaid={"file_level": "", "module_level": ""},
        selected_files=[],
        nn_models=[],
        symbol_graph={"nodes": [], "edges": []},
    )

    async def fake_pipeline(*args, **kwargs):
        yield ("__result__", 100, "", result)

    monkeypatch.setattr(analyze_routes, "_run_pipeline", fake_pipeline)

    scheduled = []

    async def fake_index_job(repo_id, file_profiles, clone_path, job_cache):
        scheduled.append((repo_id, clone_path, job_cache))

    monkeypatch.setattr(analyze_routes, "index_repository_and_record", fake_index_job)
    return scheduled


def _configure_indexing(monkeypatch, enabled: bool) -> None:
    values = {"cloudflare_account_id": "acct", "cloudflare_api_token": "token", "zilliz_uri": "https://zilliz"}
    for name, value in values.items():
        monkeypatch.setattr(settings, name, value if enabled else "")


# ── Index status on fresh analyses ──


@pytest.mark.parametrize("enabled", [True, False])
def test_analyze_stamps_index_status_and_only_schedules_indexing_when_configured(
    app, cache, clone, pipeline, monkeypatch, enabled
):
    _configure_indexing(monkeypatch, enabled)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    expected = "pending" if enabled else "not_configured"
    assert response.json()["index_status"]["status"] == expected
    assert cache.get(NEW)["index_status"]["status"] == expected
    assert pipeline == ([(NEW, clone["clone_path"], cache)] if enabled else [])


@pytest.mark.parametrize("enabled", [True, False])
def test_the_stream_reports_index_status_in_its_final_event(app, cache, clone, pipeline, monkeypatch, enabled):
    _configure_indexing(monkeypatch, enabled)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    events = [json.loads(line[len("data: ") :]) for line in response.text.splitlines() if line.startswith("data: ")]
    final = next(event for event in events if event["stage"] == "complete")
    expected = "pending" if enabled else "not_configured"
    assert final["data"]["result"]["index_status"]["status"] == expected
    assert cache.get(NEW)["index_status"]["status"] == expected
    assert ("indexing" in {event["stage"] for event in events}) is enabled
    assert pipeline == ([(NEW, clone["clone_path"], cache)] if enabled else [])


# ── Deduplicated analyses ──


def test_a_deduplicated_analysis_is_saved_for_the_new_user_and_shares_the_origin_vectors(app, cache, clone):
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=make_status("complete")))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["repo_id"], body["deduplicated"]) == (NEW, True)

    # Loads directly: no cache miss, so no silent re-analysis from disk (202).
    saved, clone_path = ensure_repo_loaded(NEW, cache, "user-b")
    assert saved is not None, "the deduplicated analysis was never saved under the new repo_id"
    assert clone_path == clone["clone_path"]
    assert saved["owner_user_id"] == "user-b"
    assert (saved["vector_repo_id"], saved["_origin_repo_id"]) == (ORIGIN, ORIGIN)
    assert "index_status" not in saved  # always read live from the vector owner

    assert body["index_status"]["status"] == "complete"
    assert cache.get(ORIGIN)["owner_user_id"] == "user-a"
    assert cache.resolve_signature(SIGNATURE)[0] == ORIGIN


def test_deduplicating_a_shared_analysis_points_at_the_vectors_underneath(app, cache, clone):
    cache.set(ROOT, _analysis("user-a", _origin_repo_id=ROOT, index_status=make_status("partial")))
    cache.set(ORIGIN, _analysis("user-c", _origin_repo_id=ROOT, vector_repo_id=ROOT))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert response.json()["index_status"]["status"] == "partial"
    saved = cache.get(NEW)
    assert (saved["vector_repo_id"], saved["_origin_repo_id"]) == (ROOT, ROOT)
    assert cache.resolve_signature(SIGNATURE)[0] == ROOT


def test_restore_reports_the_status_of_the_vectors_an_analysis_shares(app, cache):
    cache.set(ORIGIN, _analysis("user-a", index_status=make_status("failed")))
    cache.set(NEW, _analysis("user-b", vector_repo_id=ORIGIN))
    cache.set_session_path(NEW, "/clones/demo")

    response = client_for(app, "user-b").get(f"/api/restore/{NEW}")

    assert response.status_code == 200, response.text
    assert response.json()["index_status"]["status"] == "failed"


# ── Chat ──


class FakeZilliz:
    uri = "https://zilliz"
    token = "token"

    def __init__(self) -> None:
        self.searched: list[str] = []

    async def search(self, query, repo_id, limit=5, layer_filter=None):
        self.searched.append(repo_id)
        return []


@pytest.fixture
def zilliz(monkeypatch):
    fake = FakeZilliz()
    monkeypatch.setattr(vectorstore, "zilliz_client", fake)
    tracker = SimpleNamespace(check_quota=lambda user_id: True, get_remaining=lambda user_id: 1000)
    monkeypatch.setattr(chat_routes, "get_token_tracker", lambda: tracker)
    return fake


def test_chat_on_a_shared_analysis_searches_the_origin_vectors_and_says_why_it_found_nothing(app, cache, zilliz):
    cache.set(ORIGIN, _analysis("user-a", index_status=make_status("failed")))
    cache.set(NEW, _analysis("user-b", vector_repo_id=ORIGIN))
    cache.set_session_path(NEW, "/clones/demo")

    response = client_for(app, "user-b").post(f"/api/chat/{NEW}", json={"query": "how is the api wired?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert zilliz.searched == [ORIGIN]
    assert body["success"] is False
    assert "Indexing failed" in body["error"]
    assert body["index_status"]["status"] == "failed"


def test_chat_on_a_repo_that_is_still_indexing_says_so(app, cache, zilliz):
    cache.set(NEW, _analysis("user-b", index_status=make_status("pending")))
    cache.set_session_path(NEW, "/clones/demo")

    response = client_for(app, "user-b").post(f"/api/chat/{NEW}", json={"query": "what does this do?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert zilliz.searched == [NEW]
    assert "still being indexed" in body["error"]
