"""T23: writers that hold the cached analysis record must not erase each other.

The LLM overlays and the indexing outcome each load the record, spend seconds
(indexing: minutes) on their own work, then save one key. They used to save
back the whole copy they had loaded, so the last one to finish erased what the
others saved meanwhile: an overlay finishing after indexing wrote its stale
"pending" over "complete", and chat said "still being indexed" for a fully
indexed repo, for good (P4).
"""

import json
import threading
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rune import limiter
from rune.auth import verify_supabase_token
from rune.cache import AnalysisCache
from rune.index_status import make_status, record_index_status
from rune.routes import visualize as visualize_routes
from rune.routes.dependencies import get_cache

REPO = "aaaaaaaaaaaa"
USER = "user-1"
SYMBOL = "rune/cache.py::AnalysisCache"


def _record(**extra: Any) -> dict:
    return {
        "repo_name": "demo",
        "owner": "octo",
        "owner_user_id": USER,
        "dep_data": {},
        "file_profiles": [],
        "symbol_graph": {
            "nodes": [{"id": SYMBOL, "symbol_importance": 1.0}],
            "edges": [],
            "metadata": {},
            "diagnostics": {},
        },
        "index_status": make_status("pending"),
        **extra,
    }


@pytest.fixture
def cache(tmp_path) -> AnalysisCache:
    in_memory = AnalysisCache()
    in_memory._redis_available = False
    in_memory._supabase_available = False
    in_memory.set(REPO, _record())
    in_memory.set_session_path(REPO, str(tmp_path))
    return in_memory


@pytest.fixture
def client(cache, monkeypatch) -> TestClient:
    limiter._local_buckets.clear()
    app = FastAPI()
    app.include_router(visualize_routes.router, prefix="/api")
    app.dependency_overrides[get_cache] = lambda: cache
    app.dependency_overrides[verify_supabase_token] = lambda: USER
    quota = SimpleNamespace(check_quota=lambda user_id: True, get_remaining=lambda user_id: 0)
    monkeypatch.setattr("rune.quota.get_token_tracker", lambda: quota)
    return TestClient(app)


class IndexingFinishesMidCall:
    """An LLM provider during whose call the index job records its outcome."""

    def __init__(self, cache: AnalysisCache, response: dict) -> None:
        self.cache = cache
        self.response = response

    async def generate_with_usage(self, **kwargs: Any) -> tuple[str, dict]:
        await record_index_status(self.cache, REPO, make_status("complete"))
        return json.dumps(self.response), {}


# ── The routes ──


def test_a_knowledge_overlay_saved_after_indexing_finished_keeps_complete(cache, client, monkeypatch):
    description = {"symbol_id": SYMBOL, "text": "Caches analysis results."}
    provider = IndexingFinishesMidCall(cache, {"descriptions": [description]})
    monkeypatch.setattr("rune.llm.providers.get_provider", lambda task: provider)

    response = client.post(f"/api/visualize/knowledge/{REPO}", json={"use_llm": True})

    assert response.status_code == 200
    saved = cache.get(REPO)
    assert saved is not None
    assert saved["index_status"]["status"] == "complete"
    assert saved["knowledge_llm"]["descriptions"] == [description]


def test_a_dataflow_overlay_saved_after_indexing_finished_keeps_complete(cache, client, monkeypatch):
    flow = {
        "repo_type": "web_app",
        "nodes": [{"id": "api", "label": "API", "type": "io"}, {"id": "db", "label": "DB", "type": "data_store"}],
        "edges": [{"source": "api", "target": "db", "data_type": "db"}],
    }
    provider = IndexingFinishesMidCall(cache, flow)
    monkeypatch.setattr("rune.llm.providers.get_provider", lambda task: provider)

    response = client.get(f"/api/visualize/dataflow/{REPO}")

    assert response.status_code == 200
    assert response.json()["data"]["metadata"]["is_llm_enriched"] is True
    saved = cache.get(REPO)
    assert saved is not None
    assert saved["index_status"]["status"] == "complete"
    assert saved["dataflow_llm"]["metadata"]["is_llm_enriched"] is True


# ── AnalysisCache.update ──


def test_an_update_replaces_only_its_own_keys_and_leaves_held_records_alone(cache):
    held = cache.get(REPO)  # what a concurrent reader is holding

    assert cache.update(REPO, {"knowledge_llm": {"descriptions": []}})

    saved = cache.get(REPO)
    assert saved is not None
    assert saved["knowledge_llm"] == {"descriptions": []}
    assert saved["repo_name"] == "demo" and saved["index_status"]["status"] == "pending"
    assert held is not None and "knowledge_llm" not in held


def test_an_update_to_a_missing_record_writes_nothing(cache):
    assert not cache.update("bbbbbbbbbbbb", {"index_status": make_status("complete")})
    assert cache.get("bbbbbbbbbbbb") is None


def test_one_repos_writes_reach_the_persistent_tier_in_order(cache, monkeypatch):
    """A slow upload must not land after a newer one and roll the record back."""
    uploads: list[dict] = []
    first_uploading, release_first = threading.Event(), threading.Event()

    def slow_first_upload(repo_id: str, json_str: str, repo_name: str, owner: str) -> None:
        record = json.loads(json_str)
        if "dataflow_llm" in record and record["index_status"]["status"] == "pending":
            first_uploading.set()
            release_first.wait(timeout=5)
        uploads.append(record)

    monkeypatch.setattr(cache, "_supabase_set_raw", slow_first_upload)

    first = threading.Thread(target=cache.update, args=(REPO, {"dataflow_llm": {"nodes": []}}))
    second = threading.Thread(target=cache.update, args=(REPO, {"index_status": make_status("complete")}))
    first.start()
    assert first_uploading.wait(timeout=5)
    second.start()
    second.join(timeout=0.3)  # unserialized, the second upload would land now, before the first
    release_first.set()
    first.join(timeout=5)
    second.join(timeout=5)

    last = uploads[-1]
    assert last["index_status"]["status"] == "complete"
    assert last["dataflow_llm"] == {"nodes": []}
