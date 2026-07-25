"""GET /graph/semantic/{repo_id}: shape, ETag round-trip, zero provider calls, 202
passthrough, 404 for unknown repos. See
docs/superpowers/plans/2026-07-25-graph-phase1-plan.md Step 5."""

from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from codekavi.auth import verify_supabase_token
from codekavi.routes.dependencies import get_cache
from codekavi.routes.graph import router


def _profile(path: str, role: str = "router", in_degree: int = 0, out_degree: int = 0) -> dict:
    return {
        "path": path,
        "name": path.rsplit("/", 1)[-1],
        "role": role,
        "role_label": role,
        "size": 100,
        "in_degree": in_degree,
        "out_degree": out_degree,
        "importance_score": 0.5,
        "language": "python",
    }


def _result(owner_user_id: str | None = "user-a") -> dict:
    return {
        "owner_user_id": owner_user_id,
        "dep_data": {
            "edges": [{"source": "api/routes/b.py", "target": "api/routes/a.py"}],
            "adjacency": {"api/routes/b.py": ["api/routes/a.py"]},
            "reverse_adjacency": {"api/routes/a.py": ["api/routes/b.py"]},
            "entry_points": [],
            "central_files": [],
        },
        "file_profiles": [
            _profile("api/routes/a.py", in_degree=1),
            _profile("api/routes/b.py", out_degree=1),
        ],
    }


class _FakeCache:
    """Stands in for AnalysisCache: only the surface ensure_repo_loaded touches."""

    def __init__(self, results: dict[str, dict]):
        self._results = results

    def get(self, repo_id: str) -> dict | None:
        return self._results.get(repo_id)

    def get_session_path(self, repo_id: str) -> str | None:
        return "/tmp/fake-clone" if repo_id in self._results else None


def _client(results: dict[str, dict], user_id: str = "user-a") -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_cache] = lambda: _FakeCache(results)
    app.dependency_overrides[verify_supabase_token] = lambda: user_id
    return TestClient(app)


def test_returns_200_with_expected_payload_shape():
    client = _client({"repo1": _result()})
    resp = client.get("/api/graph/semantic/repo1")

    assert resp.status_code == 200
    body = resp.json()
    for key in ("fingerprint", "layers", "containers", "files", "edges", "portals", "insights"):
        assert key in body


def test_two_calls_return_byte_identical_bodies():
    client = _client({"repo1": _result()})
    first = client.get("/api/graph/semantic/repo1")
    second = client.get("/api/graph/semantic/repo1")

    assert first.content == second.content


def test_etag_round_trip_returns_304():
    client = _client({"repo1": _result()})
    first = client.get("/api/graph/semantic/repo1")
    etag = first.headers["etag"]

    second = client.get("/api/graph/semantic/repo1", headers={"if-none-match": etag})
    assert second.status_code == 304


def test_zero_provider_calls(monkeypatch):
    mock_provider = MagicMock(side_effect=AssertionError("provider must not be called"))
    monkeypatch.setattr("codekavi.llm.providers.get_provider", mock_provider)

    client = _client({"repo1": _result()})
    resp = client.get("/api/graph/semantic/repo1")

    assert resp.status_code == 200
    mock_provider.assert_not_called()


def test_reanalyzing_repo_returns_202_not_a_graph(monkeypatch):
    from fastapi import HTTPException

    def _raise_202(*args, **kwargs):
        raise HTTPException(status_code=202, detail={"status": "re-analyzing"})

    monkeypatch.setattr("codekavi.routes.visualize.ensure_repo_loaded", _raise_202)

    client = _client({"repo1": _result()})
    resp = client.get("/api/graph/semantic/repo1")

    assert resp.status_code == 202
    assert resp.json()["detail"]["status"] == "re-analyzing"


def test_unknown_repo_id_returns_404():
    client = _client({})
    resp = client.get("/api/graph/semantic/does-not-exist")
    assert resp.status_code == 404


def test_cross_user_access_returns_404_not_403():
    client = _client({"repo1": _result(owner_user_id="user-a")}, user_id="user-b")
    resp = client.get("/api/graph/semantic/repo1")
    assert resp.status_code == 404
