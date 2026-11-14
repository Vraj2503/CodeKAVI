"""T36: the Report reads the facts, counts its tokens against the user, and is kept per analysis."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rune import limiter
from rune.auth import verify_supabase_token
from rune.cache import AnalysisCache
from rune.routes import explain as explain_routes
from rune.routes.dependencies import get_cache
from rune.settings import settings

REPO = "aaaaaaaaaaaa"
CORE = "app/core.py"


class FakeProvider:
    name = "fake-llm"

    def __init__(self, fail_on: str | None = None):
        self.calls: list[dict] = []
        self.fail_on = fail_on

    async def generate(
        self, system_prompt, user_prompt, temperature=0.3, max_tokens=3000, json_mode=False, user_id=None
    ):
        self.calls.append({"user_prompt": user_prompt, "user_id": user_id, "json_mode": json_mode})
        if self.fail_on and self.fail_on in user_prompt:
            raise RuntimeError("provider down")
        if json_mode:
            return json.dumps({"content": "Mind map text.", "visualization": {"name": "root", "children": []}})
        return f"Section text {len(self.calls)} naming app/core.py."


class Quota:
    def __init__(self, ok=True):
        self.ok = ok

    def check_quota(self, user_id):
        return self.ok

    def get_remaining(self, user_id):
        return 0


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "core.py").write_text("def rank_files(files):\n    return files\n", encoding="utf-8")
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    cache.set(
        REPO,
        {
            "owner_user_id": "user-a",
            "repo_data": {"files": [{"path": CORE, "language": "Python"}], "tree": []},
            "dep_data": {"entry_points": [{"file": CORE}], "stats": {"total_edges": 0}, "adjacency": {}},
            "file_profiles": [{"path": CORE, "role": "core_module", "importance_score": 90, "language": "Python"}],
            "selected_files": [{"path": CORE}],
        },
    )
    cache.set_session_path(REPO, str(tmp_path))
    cache.facts.put(
        REPO,
        {
            CORE: {
                "purpose": "Scores and ranks the analysis.",
                "purpose_source": "doc",
                "symbols": [{"name": "rank_files", "kind": "function", "line": 1, "end_line": 2, "complexity": 9}],
            }
        },
    )
    provider, quota = FakeProvider(), Quota()
    monkeypatch.setattr("rune.orchestrator.get_provider", lambda task: provider)
    monkeypatch.setattr(explain_routes, "get_token_tracker", lambda: quota)
    monkeypatch.setattr(settings, "orchestrator_batch_delay_s", 0)
    limiter._local_buckets.clear()

    app = FastAPI()
    app.include_router(explain_routes.router, prefix="/api")
    app.dependency_overrides[get_cache] = lambda: cache
    app.dependency_overrides[verify_supabase_token] = lambda: "user-a"
    return TestClient(app), cache, provider, quota


def _events(response) -> list[tuple[str, dict]]:
    events, kind = [], None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            kind = line[len("event: ") :]
        elif line.startswith("data: ") and kind:
            events.append((kind, json.loads(line[len("data: ") :])))
    return events


def _report(client, **extra):
    return client.post(f"/api/explain/{REPO}/stream", json={"use_tour": False, **extra})


def test_a_finished_report_counts_against_the_user_and_is_kept(env):
    client, cache, provider, _ = env

    response = _report(client)

    assert response.status_code == 200, response.text
    assert len(provider.calls) == 8 and {c["user_id"] for c in provider.calls} == {"user-a"}
    assert len(cache.get(REPO)["report"]["sections"]) == 8


def test_the_overview_prompt_says_what_the_main_files_do(env):
    client, _, provider, _ = env
    _report(client)

    overview = next(c["user_prompt"] for c in provider.calls if "## Files in repository" in c["user_prompt"])
    assert (
        "## What the main files do\n- app/core.py — Scores and ranks the analysis. (key functions: rank_files)"
        in overview
    )


def test_a_second_report_replays_the_kept_sections_without_calling_the_llm(env):
    client, _, provider, quota = env
    _report(client)
    provider.calls.clear()
    quota.ok = False  # a kept report costs nothing, so a spent quota doesn't block it

    events = _events(_report(client))

    assert provider.calls == []
    kinds = [kind for kind, _ in events]
    assert kinds[:2] == ["stats", "tree"] and kinds.count("section") == 8 and kinds[-1] == "done"
    assert any(kind == "progress" and data.get("phase") == "complete" for kind, data in events)


def test_refresh_writes_a_new_report(env):
    client, _, provider, _ = env
    _report(client)
    _report(client, refresh=True)

    assert len(provider.calls) == 16


def test_a_custom_prompt_neither_reads_nor_replaces_the_kept_report(env):
    client, cache, provider, _ = env
    _report(client)
    kept = cache.get(REPO)["report"]

    _report(client, prompt="Focus on security.")

    assert len(provider.calls) == 16
    assert cache.get(REPO)["report"] == kept


def test_a_spent_quota_stops_a_new_report_before_any_call(env):
    client, _, provider, quota = env
    quota.ok = False

    response = _report(client)

    assert response.status_code == 429
    assert provider.calls == []


def test_a_report_with_a_failed_section_is_not_kept(env):
    client, cache, provider, _ = env
    provider.fail_on = "## Files in repository"  # the overview

    _report(client)

    assert "report" not in cache.get(REPO)
