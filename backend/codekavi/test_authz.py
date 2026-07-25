"""IDOR regression guard (review IMPL-5 / plan step 1.3): every endpoint that
takes a repo_id must deny cross-user access with 404, not 403 (no existence
oracle) and not 500/422 (the request must never get far enough downstream to
crash on another user's data). Parametrized across every such endpoint so a
newly added one that forgets to route through ensure_repo_loaded/_load_repo
fails this suite immediately.

export.py's /export/{repo_id}/* routes are excluded: they're unimplemented
placeholders that return 501 without ever touching the cache, so there is no
repo data to protect yet."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from codekavi.auth import verify_supabase_token
from codekavi.routes.analyze import router as analyze_router
from codekavi.routes.chat import router as chat_router
from codekavi.routes.dependencies import get_cache
from codekavi.routes.explain import router as explain_router
from codekavi.routes.graph import router as graph_router
from codekavi.routes.visualize import router as visualize_router


def _result(owner_user_id: str | None = "user-a") -> dict:
    return {
        "owner_user_id": owner_user_id,
        "repo_name": "demo",
        "owner": "user-a",
        "repo_data": {},
        "dep_data": {
            "edges": [],
            "adjacency": {},
            "reverse_adjacency": {},
            "entry_points": [],
            "central_files": [],
        },
        "file_profiles": [],
        "role_summary": {},
        "graph_json": {"nodes": [], "edges": [], "metadata": {}},
        "module_graph": {"modules": [], "connections": []},
        "nn_models": [],
        "selected_files": [],
    }


class _FakeCache:
    """Stands in for AnalysisCache: only the surface ensure_repo_loaded touches."""

    def __init__(self, results: dict[str, dict]):
        self._results = results

    def get(self, repo_id: str) -> dict | None:
        return self._results.get(repo_id)

    def get_session_path(self, repo_id: str) -> str | None:
        return "/tmp/fake-clone" if repo_id in self._results else None

    def delete(self, repo_id: str) -> None:
        pass

    def delete_session(self, repo_id: str) -> None:
        pass


# A repo_id owned by user-a, present under both the plain id used by most
# routes and a valid-hex id for chat.py's stricter format check.
OWNED_REPO_ID = "repo1"
OWNED_HEX_REPO_ID = "abcdef012345"  # 12-char hex, matches chat.py's ^[a-f0-9]{12}$


def _client(user_id: str = "user-b") -> TestClient:
    app = FastAPI()
    app.include_router(analyze_router, prefix="/api")
    app.include_router(chat_router, prefix="/api")
    app.include_router(explain_router, prefix="/api")
    app.include_router(graph_router, prefix="/api")
    app.include_router(visualize_router, prefix="/api")

    results = {
        OWNED_REPO_ID: _result(owner_user_id="user-a"),
        OWNED_HEX_REPO_ID: _result(owner_user_id="user-a"),
    }
    app.dependency_overrides[get_cache] = lambda: _FakeCache(results)
    app.dependency_overrides[verify_supabase_token] = lambda: user_id
    return TestClient(app)


# ── GET/DELETE endpoints with no request body ──
_NO_BODY_ENDPOINTS = [
    ("GET", f"/api/graph/{OWNED_REPO_ID}"),  # legacy raw export (analyze.py)
    ("GET", f"/api/restore/{OWNED_REPO_ID}"),
    ("DELETE", f"/api/cleanup/{OWNED_REPO_ID}"),
    ("GET", f"/api/graph/semantic/{OWNED_REPO_ID}"),
    ("GET", f"/api/visualize/dependencies/{OWNED_REPO_ID}"),
    ("GET", f"/api/visualize/complexity/{OWNED_REPO_ID}"),
    ("GET", f"/api/visualize/architecture/{OWNED_REPO_ID}"),
    ("GET", f"/api/visualize/dataflow/{OWNED_REPO_ID}"),
    ("GET", f"/api/visualize/nn/{OWNED_REPO_ID}"),
]


def test_owner_can_access_their_own_repo():
    """Sanity check the fixture itself: user-a must NOT be denied on their own repo."""
    client = _client(user_id="user-a")
    resp = client.get(f"/api/restore/{OWNED_REPO_ID}")
    assert resp.status_code != 404


@pytest.mark.parametrize("method,path", _NO_BODY_ENDPOINTS)
def test_cross_user_access_denied_no_body_endpoints(method: str, path: str):
    client = _client(user_id="user-b")
    resp = client.request(method, path)
    assert resp.status_code == 404, f"{method} {path} returned {resp.status_code}, expected 404"


# ── POST endpoints that require a request body ──
_BODY_ENDPOINTS = [
    ("POST", f"/api/visualize/mindmap/{OWNED_REPO_ID}", {}),
    ("POST", f"/api/explain/{OWNED_REPO_ID}", {}),
    ("POST", f"/api/explain/file/{OWNED_REPO_ID}", {"file_path": "a.py"}),
    ("POST", f"/api/explain/{OWNED_REPO_ID}/stream", {}),
    ("POST", "/api/explain/visualization/dependencies", {"repo_id": OWNED_REPO_ID}),
]


@pytest.mark.parametrize("method,path,body", _BODY_ENDPOINTS)
def test_cross_user_access_denied_body_endpoints(method: str, path: str, body: dict):
    client = _client(user_id="user-b")
    resp = client.request(method, path, json=body)
    assert resp.status_code == 404, f"{method} {path} returned {resp.status_code}, expected 404"


def test_cross_user_access_denied_chat(monkeypatch):
    """chat.py checks Zilliz configuration and repo_id format before ownership —
    both must be satisfied for this test to actually exercise the IDOR guard
    rather than failing earlier for an unrelated reason."""
    from codekavi.vectorstore import zilliz_client

    monkeypatch.setattr(zilliz_client, "uri", "https://fake.zilliz.example")
    monkeypatch.setattr(zilliz_client, "token", "fake-token")

    client = _client(user_id="user-b")
    resp = client.post(f"/api/chat/{OWNED_HEX_REPO_ID}", json={"query": "what does this repo do?"})
    assert resp.status_code == 404
