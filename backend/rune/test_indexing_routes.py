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
from rune.cache import PIPELINE_VERSION, AnalysisCache
from rune.fingerprint import ChangeClassification
from rune.index_status import make_status
from rune.indexer import INDEX_VERSION, index_recipe
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
    """A saved analysis, made by this pipeline unless ``pipeline_version`` says otherwise."""
    return {
        "pipeline_version": PIPELINE_VERSION,
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
    assert cache.get(NEW)["pipeline_version"] == PIPELINE_VERSION
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


@pytest.fixture
def cloudflare_index(monkeypatch):
    """A fresh index would be built as an index with no recorded identity was: Cloudflare, no prefix."""
    monkeypatch.setattr(analyze_routes, "configured_index_embedding", lambda: ("cloudflare", ""))


def _events(response) -> list[dict]:
    return [json.loads(line[len("data: ") :]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_a_deduplicated_analysis_is_saved_for_the_new_user_and_shares_the_origin_vectors(
    app, cache, clone, cloudflare_index
):
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
    assert saved["repo_signature"] == SIGNATURE  # findable after a restart
    assert "index_status" not in saved  # always read live from the vector owner
    assert saved["vector_index_status"]["status"] == "complete"  # for when the owner's record is gone

    assert body["index_status"]["status"] == "complete"
    assert cache.get(ORIGIN)["owner_user_id"] == "user-a"
    assert cache.resolve_signature(SIGNATURE)[0] == ORIGIN


def test_deduplicating_a_shared_analysis_points_at_the_vectors_underneath(app, cache, clone, cloudflare_index):
    cache.set(ROOT, _analysis("user-a", _origin_repo_id=ROOT, index_status=make_status("complete")))
    cache.set(ORIGIN, _analysis("user-c", _origin_repo_id=ROOT, vector_repo_id=ROOT))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert response.json()["index_status"]["status"] == "complete"
    saved = cache.get(NEW)
    assert (saved["vector_repo_id"], saved["_origin_repo_id"]) == (ROOT, ROOT)
    assert cache.resolve_signature(SIGNATURE)[0] == ROOT


def test_the_stream_reuses_an_unchanged_fully_indexed_commit(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch
):
    _configure_indexing(monkeypatch, True)
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=make_status("complete")))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    events = _events(response)
    assert [event["stage"] for event in events] == ["cloning", "complete"]  # no analysis stages
    result = events[-1]["data"]["result"]
    assert (result["repo_id"], result["deduplicated"], result["index_status"]["status"]) == (NEW, True, "complete")
    assert pipeline == []  # nothing embedded: no new vector set
    saved = cache.get(NEW)
    assert (saved["vector_repo_id"], saved["owner_user_id"], saved["repo_signature"]) == (ORIGIN, "user-b", SIGNATURE)


@pytest.mark.parametrize(
    ("earlier", "request_extra", "reuse_enabled"),
    [
        (make_status("pending"), {}, True),  # still indexing, or died mid-index
        (make_status("partial"), {}, True),
        ({**make_status("complete"), "embedding_identity": "bge-large-en-v1.5:cls"}, {}, True),  # another model
        ({**make_status("complete"), "document_prefix": "passage: "}, {}, True),  # another document prompt
        (make_status("complete"), {"force": True}, True),
        (make_status("complete"), {}, False),  # ANALYZE_REUSE_UNCHANGED_COMMITS=false
    ],
    ids=["pending", "partial", "other-model", "other-prefix", "force", "reuse-off"],
)
def test_the_stream_analyzes_afresh_unless_the_earlier_index_is_as_good_as_a_new_one(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch, earlier, request_extra, reuse_enabled
):
    _configure_indexing(monkeypatch, True)
    monkeypatch.setattr(settings, "analyze_reuse_unchanged_commits", reuse_enabled)
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=earlier))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL, **request_extra})

    assert response.status_code == 200, response.text
    stages = [event["stage"] for event in _events(response)]
    assert "traversing" in stages and "indexing" in stages
    assert pipeline == [(NEW, clone["clone_path"], cache)]
    assert cache.get(NEW)["repo_signature"] == SIGNATURE  # a fresh analysis records its commit too


def test_analyze_follows_the_same_rule(app, cache, clone, pipeline, cloudflare_index, monkeypatch):
    _configure_indexing(monkeypatch, True)
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=make_status("partial")))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert "deduplicated" not in response.json()
    assert pipeline == [(NEW, clone["clone_path"], cache)]


@pytest.mark.parametrize(
    ("recipe", "reindexed"),
    [
        (None, False),  # recorded before T28: counts as today's
        ({"version": INDEX_VERSION, "exclude_tests": True}, False),
        ({"version": INDEX_VERSION, "exclude_tests": False}, True),  # tests went in; a fresh index leaves them out
        ({"version": INDEX_VERSION - 1, "exclude_tests": True}, True),  # chunked by older indexing code
    ],
    ids=["no-recipe", "same", "tests-indexed", "older-chunker"],
)
def test_an_index_is_reused_only_if_a_fresh_one_would_be_chunked_the_same_way(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch, recipe, reindexed
):
    _configure_indexing(monkeypatch, True)
    monkeypatch.setattr(settings, "index_exclude_tests", True)
    status = make_status("complete", index_recipe=recipe)
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=status))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert pipeline == ([(NEW, clone["clone_path"], cache)] if reindexed else [])


@pytest.mark.parametrize(("built_with_tokens", "reindexed"), [(384, False), (512, True)])
def test_a_local_index_is_rebuilt_when_its_chunk_size_setting_changes(
    app, cache, clone, pipeline, monkeypatch, built_with_tokens, reindexed
):
    identity = "bge-large-en-v1.5:cls"
    _configure_indexing(monkeypatch, True)
    monkeypatch.setattr(analyze_routes, "configured_index_embedding", lambda: (identity, ""))
    monkeypatch.setattr(settings, "local_embedding_chunk_tokens", 384)
    recipe = {**index_recipe(identity), "chunk_tokens": built_with_tokens}
    status = make_status("complete", embedding_identity=identity, index_recipe=recipe)
    cache.set(ORIGIN, _analysis("user-a", _origin_repo_id=ORIGIN, index_status=status))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert pipeline == ([(NEW, clone["clone_path"], cache)] if reindexed else [])


# ── An older pipeline's analysis of the same commit (T28) ──


def _older_analysis(owner_user_id: str, older: dict, **extra) -> dict:
    """A saved analysis from an older pipeline: ``older`` is {} (before T28) or its version."""
    record = _analysis(owner_user_id, **extra)
    del record["pipeline_version"]
    return {**record, **older}


@pytest.mark.parametrize("older", [{}, {"pipeline_version": PIPELINE_VERSION - 1}], ids=["before-T28", "older"])
def test_the_stream_reruns_an_older_pipeline_but_keeps_its_index(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch, older
):
    _configure_indexing(monkeypatch, True)
    cache.set(ORIGIN, _older_analysis("user-a", older, _origin_repo_id=ORIGIN, index_status=make_status("complete")))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    events = _events(response)
    assert "traversing" in [event["stage"] for event in events]  # the pipeline ran
    indexing = next(event for event in events if event["stage"] == "indexing")
    assert "kept its search index" in indexing["message"]
    assert pipeline == []  # nothing embedded: no new vector set
    result = events[-1]["data"]["result"]
    assert "deduplicated" not in result
    assert result["index_status"]["status"] == "complete"
    saved = cache.get(NEW)
    assert saved["pipeline_version"] == PIPELINE_VERSION
    assert (saved["vector_repo_id"], saved["_origin_repo_id"], saved["owner_user_id"]) == (ORIGIN, NEW, "user-b")
    assert "index_status" not in saved  # read live from the vector owner
    assert saved["vector_index_status"]["status"] == "complete"
    assert cache.resolve_signature(SIGNATURE)[0] == NEW  # later analyses get the new facts


def test_analyze_reruns_an_older_pipeline_and_keeps_its_index_too(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch
):
    _configure_indexing(monkeypatch, True)
    cache.set(ORIGIN, _older_analysis("user-a", {}, _origin_repo_id=ORIGIN, index_status=make_status("complete")))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze", json={"github_url": URL})

    assert response.status_code == 200, response.text
    body = response.json()
    assert "deduplicated" not in body
    assert body["index_status"]["status"] == "complete"
    assert pipeline == []
    saved = cache.get(NEW)
    assert (saved["vector_repo_id"], saved["pipeline_version"]) == (ORIGIN, PIPELINE_VERSION)
    assert "index_status" not in saved


def test_keeping_a_shared_analysis_index_points_at_the_vectors_underneath(
    app, cache, clone, pipeline, cloudflare_index, monkeypatch
):
    _configure_indexing(monkeypatch, True)
    cache.set(ROOT, _older_analysis("user-a", {}, _origin_repo_id=ROOT, index_status=make_status("complete")))
    cache.set(ORIGIN, _older_analysis("user-c", {}, _origin_repo_id=ROOT, vector_repo_id=ROOT))
    cache.register_signature(SIGNATURE, ORIGIN)

    response = client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert pipeline == []
    assert cache.get(NEW)["vector_repo_id"] == ROOT


def test_once_rerun_the_commit_is_reused_whole_again(app, cache, clone, pipeline, cloudflare_index, monkeypatch):
    _configure_indexing(monkeypatch, True)
    cache.set(ORIGIN, _older_analysis("user-a", {}, _origin_repo_id=ORIGIN, index_status=make_status("complete")))
    cache.register_signature(SIGNATURE, ORIGIN)
    client_for(app, "user-b").post("/api/analyze/stream", json={"github_url": URL})  # reruns the pipeline as NEW

    later_repo_id = "111111111111"
    later = {**clone, "repo_id": later_repo_id, "clone_path": clone["clone_path"].replace(NEW, later_repo_id)}
    monkeypatch.setattr(analyze_routes, "clone_repo", lambda url: dict(later))
    response = client_for(app, "user-d").post("/api/analyze/stream", json={"github_url": URL})

    assert response.status_code == 200, response.text
    assert [event["stage"] for event in _events(response)] == ["cloning", "complete"]
    saved = cache.get(later_repo_id)
    assert (saved["vector_repo_id"], saved["_origin_repo_id"]) == (ORIGIN, NEW)
    assert pipeline == []  # embedded once, ever


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
        self.calls: list[dict] = []  # anything beyond the real signature lands here too

    async def search(
        self,
        query,
        repo_id,
        limit=5,
        embedding_identity="cloudflare",
        document_prefix=None,
        **kwargs,
    ):
        self.searched.append(repo_id)
        self.calls.append({"limit": limit, **kwargs})
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


def test_a_technical_question_gets_more_chunks_and_no_layer_is_dropped(app, cache, zilliz):
    # Dropping "frontend" for technical questions never helped on the eval set and
    # cost answers (a UI library's own code is frontend), so no layer filter is sent.
    cache.set(NEW, _analysis("user-b", index_status=make_status("complete")))
    cache.set_session_path(NEW, "/clones/demo")
    client = client_for(app, "user-b")

    client.post(f"/api/chat/{NEW}", json={"query": "how is the api wired?"})  # "api": technical
    client.post(f"/api/chat/{NEW}", json={"query": "what does this do?"})

    assert zilliz.calls == [{"limit": 8}, {"limit": 5}]


def test_chat_on_a_repo_that_is_still_indexing_says_so(app, cache, zilliz):
    cache.set(NEW, _analysis("user-b", index_status=make_status("pending")))
    cache.set_session_path(NEW, "/clones/demo")

    response = client_for(app, "user-b").post(f"/api/chat/{NEW}", json={"query": "what does this do?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert zilliz.searched == [NEW]
    assert "still being indexed" in body["error"]
