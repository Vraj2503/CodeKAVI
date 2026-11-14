"""T37: the data-flow prompt says what crosses each import, what files do, and which services are called."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rune.architecture import external_services
from rune.cache import AnalysisCache
from rune.llm.prompts import build_dataflow_prompt
from rune.routes import visualize
from rune.routes.visualize import _dataflow_import_lines, _paths_in, visualize_dataflow

ROUTE, CLONER, LLM = "app/routes/analyze.py", "app/cloner.py", "app/llm/providers.py"


def _profiles():
    def profile(path, role, label, importance):
        return {
            "path": path,
            "role": role,
            "role_label": label,
            "importance_score": importance,
            "language": "Python",
            "name": path.rsplit("/", 1)[-1],
            "size": 100,
            "role_confidence": 0.9,
            "depends_on": [],
            "used_by": [],
            "in_degree": 0,
            "out_degree": 0,
            "tags": [],
        }

    return [
        profile(ROUTE, "router", "Router / Routes", 90),
        profile(CLONER, "core_module", "Core Module", 80),
        profile(LLM, "core_module", "Core Module", 70),
    ]


def _dep_data():
    return {
        "edges": [
            {"source": ROUTE, "target": CLONER, "specifiers": ["clone_repo", "parse_repo_url"]},
            {"source": ROUTE, "target": LLM, "specifiers": ["get_provider"]},
        ],
        "adjacency": {ROUTE: [CLONER, LLM], CLONER: [], LLM: []},
        "reverse_adjacency": {CLONER: [ROUTE], LLM: [ROUTE], ROUTE: []},
        "file_imports": {LLM: [{"raw": "groq"}, {"raw": "google.genai"}], CLONER: [{"raw": "subprocess"}]},
        "entry_points": [{"file": ROUTE}],
        "file_signals": {},
        "central_files": [],
        "stats": {},
    }


def test_an_import_line_says_what_crosses_it():
    lines = _dataflow_import_lines(_dep_data(), _profiles())

    assert f"{ROUTE} [Router / Routes] -> {CLONER} [Core Module] (uses clone_repo, parse_repo_url)" in lines
    assert _paths_in(lines[0]) == [ROUTE, CLONER]


def test_the_services_the_code_imports_are_found_by_name():
    assert external_services(_dep_data()["file_imports"]) == {
        "Google — Gemini": [LLM],
        "Groq — Inference API": [LLM],
    }


def test_services_are_asked_for_as_services_not_stages():
    prompt = build_dataflow_prompt(
        entry_points=[ROUTE],
        role_summary={},
        adjacency_summary=[],
        languages=["Python"],
        repo_type="web_app",
        file_notes=[f"{CLONER}: Clones repositories."],
        external_services=[f"Groq — Inference API (called from {LLM})"],
    )

    assert f"  - {CLONER}: Clones repositories." in prompt
    assert f"  - Groq — Inference API (called from {LLM})" in prompt
    assert 'Do not merge them into one generic node such as "External LLM APIs"' in prompt


class Provider:
    name = "fake-llm"

    def __init__(self):
        self.prompts: list[str] = []

    async def generate_with_usage(self, system_prompt, user_prompt, **kwargs):
        self.prompts.append(user_prompt)
        return json.dumps({"repo_type": "web_app", "nodes": [], "edges": []}), {"total_tokens": 10}


@pytest.mark.asyncio
async def test_the_route_sends_purposes_routes_and_services(monkeypatch):
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    record = {"file_profiles": _profiles(), "dep_data": _dep_data()}
    cache.set("r", record)
    cache.facts.put(
        "r",
        {
            ROUTE: {
                "purpose": "Starts and streams analyses.",
                "purpose_source": "doc",
                "symbols": [],
                "routes": ["POST /analyze"],
            },
            CLONER: {"purpose": "Clones repositories.", "purpose_source": "doc", "symbols": []},
        },
    )
    provider = Provider()
    monkeypatch.setattr("rune.llm.providers.get_provider", lambda name: provider)
    quota = MagicMock()
    quota.check_quota.return_value = True
    monkeypatch.setattr("rune.quota.get_token_tracker", lambda: quota)

    with patch.object(visualize, "_load_repo", AsyncMock(return_value=(record, None))):
        await visualize_dataflow(MagicMock(), "r", cache=cache, user_id="u")

    prompt = provider.prompts[0]
    assert f"  - {ROUTE}: Starts and streams analyses. (serves POST /analyze)" in prompt
    assert f"  - {CLONER}: Clones repositories." in prompt
    assert f"  - Groq — Inference API (called from {LLM})" in prompt
