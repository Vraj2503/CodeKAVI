"""T41: the radar's functions and tooltips come from each file's own facts (T16)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rune.cache import AnalysisCache
from rune.routes import visualize
from rune.routes.visualize import visualize_radar

CORE, MAIN = "app/core.py", "app/main.py"


def _cache() -> AnalysisCache:
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    return cache


def _record(**extra) -> dict:
    profiles = [
        {"path": MAIN, "role": "entry_point", "importance_score": 80, "complexity": 4, "loc": 20, "depends_on": [CORE]},
        {"path": CORE, "role": "core_module", "importance_score": 70, "complexity": 30, "loc": 200, "used_by": [MAIN]},
    ]
    return {"file_profiles": profiles, "dep_data": {}, **extra}


def _symbol(name, complexity, line, kind="function"):
    return {
        "name": name,
        "kind": kind,
        "line": line,
        "end_line": line + 5,
        "doc": None,
        "signature": "()",
        "complexity": complexity,
    }


async def _radar(record, cache, repo_id="r"):
    with patch.object(visualize, "_load_repo", AsyncMock(return_value=(record, None))):
        data = (
            await visualize_radar(
                MagicMock(), repo_id, include_tests=False, include_docs=False, cache=cache, user_id="u"
            )
        )["data"]
    return {m["path"]: m for m in data["modules"]}


@pytest.mark.asyncio
async def test_each_file_lists_its_five_most_complex_functions_and_says_what_it_is_for():
    cache = _cache()
    symbols = [_symbol(f"f{i}", c, i * 10) for i, c in enumerate([3, 9, 1, 12, 5, 7, 2])] + [
        _symbol("Store", 40, 1, "class")
    ]
    cache.facts.put(
        "r", {CORE: {"purpose": "Core logic.", "purpose_source": "doc", "symbols": symbols, "truncated": False}}
    )

    core = (await _radar(_record(), cache))[CORE]

    assert [(s["name"], s["complexity"]) for s in core["symbols"]] == [
        ("f3", 12),
        ("f1", 9),
        ("f5", 7),
        ("f4", 5),
        ("f0", 3),
    ]
    assert (core["purpose"], core["purpose_source"]) == ("Core logic.", "doc")


@pytest.mark.asyncio
async def test_a_written_sentence_wins_over_the_purpose_line():
    cache = _cache()
    cache.facts.put(
        "r",
        {CORE: {"purpose": "Defines: run", "purpose_source": "derived", "summary": "Runs the jobs.", "symbols": []}},
    )

    core = (await _radar(_record(), cache))[CORE]

    assert (core["purpose"], core["purpose_source"]) == ("Runs the jobs.", "summary")


@pytest.mark.asyncio
async def test_a_deduplicated_analysis_shows_its_origins_facts():
    cache = _cache()
    cache.facts.put("origin123456", {CORE: {"purpose": "Core logic.", "purpose_source": "doc", "symbols": []}})

    core = (await _radar(_record(_origin_repo_id="origin123456"), cache, repo_id="dedup1234567"))[CORE]

    assert core["purpose"] == "Core logic."


@pytest.mark.asyncio
async def test_an_analysis_saved_before_the_fact_store_still_names_its_functions():
    record = _record(symbol_graph={"nodes": [{"file": CORE, "name": "run", "kind": "function", "line": 3}]})

    core = (await _radar(record, _cache()))[CORE]

    assert [s["name"] for s in core["symbols"]] == ["run"]
    assert core["purpose"] is None
