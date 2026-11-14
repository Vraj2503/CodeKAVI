"""T35: AI Insights read what each view shows, and an answer is kept per analysis."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rune.cache import AnalysisCache
from rune.routes import visualize
from rune.routes.visualize import ExplainVizRequest, explain_visualization

MAIN, CORE, CHAT = "app/main.py", "app/core.py", "app/routes/chat.py"


def _record() -> dict:
    return {
        "file_profiles": [
            {"path": MAIN, "role": "entry_point", "role_label": "Entry Point", "importance_score": 90, "complexity": 6},
            {"path": CHAT, "role": "router", "role_label": "Router", "importance_score": 85, "complexity": 20},
            {
                "path": CORE,
                "role": "core_module",
                "role_label": "Core Module",
                "importance_score": 80,
                "complexity": 64,
            },
        ],
        "dep_data": {
            "entry_points": [{"file": MAIN}],
            "adjacency": {MAIN: [CHAT, CORE], CHAT: [CORE], CORE: []},
            "file_imports": {},
        },
    }


def _symbol(name, complexity, line):
    return {"name": name, "kind": "function", "line": line, "end_line": line + 9, "complexity": complexity}


FACTS = {
    CORE: {
        "purpose": "Scores and ranks the analysis.",
        "purpose_source": "doc",
        "symbols": [_symbol("rank_files", 31, 10), _symbol("score", 12, 80)],
    },
    MAIN: {"purpose": "Starts the API server.", "purpose_source": "doc", "symbols": [], "routes": ["GET /health"]},
    CHAT: {
        "summary": "Answers questions about an analyzed repo.",
        "purpose": "Routes: POST /chat",
        "symbols": [],
        "routes": ["POST /chat/{repo_id}"],
    },
}


class Provider:
    name = "fake-llm"

    def __init__(self):
        self.prompts: list[str] = []

    async def generate_with_usage(self, system_prompt, user_prompt, **kwargs):
        self.prompts.append(user_prompt)
        return f"Answer {len(self.prompts)}", {"total_tokens": 321}


class Quota:
    def __init__(self):
        self.checks = 0

    def check_quota(self, user_id):
        self.checks += 1
        return True

    def get_remaining(self, user_id):
        return 0


@pytest.fixture
def env(monkeypatch):
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    cache.set("r", _record())
    cache.facts.put("r", FACTS)
    provider, quota = Provider(), Quota()
    monkeypatch.setattr("rune.llm.providers.get_provider", lambda name: provider)
    monkeypatch.setattr("rune.quota.get_token_tracker", lambda: quota)
    monkeypatch.setattr(visualize.settings, "gemini_api_key", "key")

    async def load(repo_id, c, user_id):
        return c.get(repo_id), None

    with patch.object(visualize, "_load_repo", AsyncMock(side_effect=load)):
        yield cache, provider, quota


async def _explain(cache, viz_type, refresh=False):
    body = ExplainVizRequest(repo_id="r", refresh=refresh)
    return await explain_visualization(MagicMock(), viz_type, body, cache=cache, user_id="u")


@pytest.mark.asyncio
async def test_the_radar_prompt_names_the_hotspot_and_the_functions_behind_it(env):
    cache, provider, _ = env
    await _explain(cache, "concentric_radar")

    prompt = provider.prompts[0]
    assert f"{CORE} — Scores and ranks the analysis. (CC 64); most complex: rank_files (CC 31), score (CC 12)" in prompt
    assert "Hotspots: app/core.py (CC 64)" in prompt
    assert f"{CHAT} — Answers questions about an analyzed repo." in prompt  # the written sentence wins


@pytest.mark.asyncio
async def test_a_second_click_returns_the_kept_answer_and_costs_nothing(env):
    cache, provider, quota = env
    first = await _explain(cache, "concentric_radar")
    second = await _explain(cache, "concentric_radar")

    assert (first["explanation"], first["tokens_used"], first["cached"]) == ("Answer 1", 321, False)
    assert (second["explanation"], second["tokens_used"], second["cached"]) == ("Answer 1", 0, True)
    assert len(provider.prompts) == 1 and quota.checks == 1


@pytest.mark.asyncio
async def test_refresh_asks_again_and_keeps_the_new_answer(env):
    cache, provider, _ = env
    await _explain(cache, "concentric_radar")
    fresh = await _explain(cache, "concentric_radar", refresh=True)

    assert fresh["explanation"] == "Answer 2"
    assert (await _explain(cache, "concentric_radar"))["explanation"] == "Answer 2"


@pytest.mark.asyncio
async def test_each_view_keeps_its_own_answer(env):
    cache, _, _ = env
    await _explain(cache, "concentric_radar")
    await _explain(cache, "mindmap")

    record = cache.get("r")
    assert record["insights_concentric_radar"]["explanation"] == "Answer 1"
    assert record["insights_mindmap"]["explanation"] == "Answer 2"


@pytest.mark.asyncio
async def test_the_architecture_and_dataflow_prompts_carry_files_and_routes(env):
    cache, provider, _ = env
    await _explain(cache, "architecture")
    await _explain(cache, "dataflow")

    architecture, dataflow = provider.prompts
    assert "app/main.py — Starts the API server." in architecture
    assert f"- {MAIN} — Starts the API server. | serves GET /health | imports {CORE}, {CHAT}" in dataflow
