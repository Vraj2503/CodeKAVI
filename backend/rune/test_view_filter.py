"""T31: tests and docs are left out of the views that list files, unless asked for.

Tests filled the radar's outer ring and the learn tour opened on CONTRIBUTING.md.
Asking for both restores what the views showed before.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rune.architecture import build_architecture_manifest
from rune.architecture_models import ArchitectureInclude, ArchitectureRequest
from rune.cache import AnalysisCache
from rune.config import shown_in_views
from rune.graph_assembler import assemble_graph
from rune.routes import visualize
from rune.routes.visualize import MindmapRequest, visualize_mindmap, visualize_radar
from rune.tour_generator import assemble_tour

MAIN, CORE, TEST, DOC = "app/main.py", "app/core.py", "tests/test_core.py", "CONTRIBUTING.md"


def _profile(path, role, importance, *, depends_on=(), used_by=()):
    return {
        "path": path,
        "role": role,
        "role_label": role.replace("_", " ").title(),
        "importance_score": importance,
        "complexity": 12,
        "loc": 40,
        "functions": 3,
        "language": "Markdown" if path.endswith(".md") else "Python",
        "depends_on": list(depends_on),
        "used_by": list(used_by),
        "size": 900,
    }


def _record() -> dict:
    edges = [(MAIN, CORE), (TEST, CORE)]
    return {
        "file_profiles": [
            _profile(DOC, "documentation", 95),
            _profile(TEST, "test", 90, depends_on=[CORE]),
            _profile(MAIN, "entry_point", 80, depends_on=[CORE]),
            _profile(CORE, "core_module", 70, used_by=[MAIN, TEST]),
        ],
        "dep_data": {
            "edges": [{"source": s, "target": t} for s, t in edges],
            "adjacency": {MAIN: [CORE], TEST: [CORE], CORE: [], DOC: []},
            "reverse_adjacency": {CORE: [MAIN, TEST], MAIN: [], TEST: [], DOC: []},
            "file_imports": {},
        },
    }


@pytest.mark.parametrize(
    ("path", "role", "shown"),
    [
        ("app/cache.py", "core_module", True),
        ("backend/rune/test_cache.py", "test", False),
        ("app/tests/fixtures/sample_app.py", "core_module", False),  # a fixture app is test code
        ("CONTRIBUTING.md", "documentation", False),
        ("docs/guide.mdx", None, False),
        ("README.txt", "documentation", False),
        ("backend/requirements.txt", "config", True),  # .txt alone doesn't make a doc
    ],
)
def test_one_rule_decides_what_views_show(path, role, shown):
    assert shown_in_views(path, role) is shown
    assert shown_in_views(path, role, include_tests=True, include_docs=True) is True


def test_the_two_switches_are_independent():
    assert shown_in_views(TEST, "test", include_docs=True) is False
    assert shown_in_views(DOC, "documentation", include_tests=True) is False
    assert shown_in_views(TEST, "test", include_tests=True) is True


@pytest.fixture
def loaded():
    record = _record()
    with patch.object(visualize, "_load_repo", AsyncMock(return_value=(record, None))):
        yield record


def _memory_cache() -> AnalysisCache:
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    return cache


async def _radar(**flags):
    return (await visualize_radar(MagicMock(), "r", cache=_memory_cache(), user_id="u", **flags))["data"]


@pytest.mark.asyncio
async def test_the_radar_has_no_test_ring_and_no_docs_by_default(loaded):
    data = await _radar(include_tests=False, include_docs=False)

    assert {m["path"] for m in data["modules"]} == {MAIN, CORE}
    assert [t["level"] for t in data["tiers"]] == [0, 1, 2, 3, 4]  # "Verification: Tests" isn't drawn
    core = next(m for m in data["modules"] if m["path"] == CORE)
    assert core["inbound"] == [MAIN]  # the hidden test doesn't point at it either


@pytest.mark.asyncio
async def test_asking_for_tests_and_docs_restores_the_radar_as_it_was(loaded):
    data = await _radar(include_tests=True, include_docs=True)

    assert {m["path"] for m in data["modules"]} == {MAIN, CORE, TEST, DOC}
    assert data["tiers"] == visualize._RADAR_TIERS
    assert data["stats"]["tier_counts"][visualize._TEST_TIER] == 1


def _leaf_paths(node) -> set[str]:
    children = node.get("children") or []
    if not children:
        return {node.get("path")} if node.get("path") else set()
    return set().union(*(_leaf_paths(child) for child in children))


@pytest.mark.asyncio
async def test_the_mind_map_leaves_out_tests_and_docs_unless_asked(loaded):
    default = await visualize_mindmap(MagicMock(), "r", MindmapRequest(), cache=_memory_cache(), user_id="u")
    everything = await visualize_mindmap(
        MagicMock(), "r", MindmapRequest(include_tests=True, include_docs=True), cache=_memory_cache(), user_id="u"
    )

    assert _leaf_paths(default["data"]["root"]) == {MAIN, CORE}
    assert _leaf_paths(everything["data"]["root"]) == {MAIN, CORE, TEST, DOC}


def _evidence_paths(manifest) -> set[str]:
    return {evidence.path for node in manifest.nodes for evidence in node.evidence}


def test_the_architecture_diagram_leaves_out_tests_and_docs_unless_asked():
    record = _record()
    default = build_architecture_manifest("r", record["dep_data"], record["file_profiles"])
    everything = build_architecture_manifest(
        "r",
        record["dep_data"],
        record["file_profiles"],
        ArchitectureRequest(include=ArchitectureInclude(tests=True, docs=True)),
    )

    assert TEST not in _evidence_paths(default) and DOC not in _evidence_paths(default)
    assert {TEST, DOC} <= _evidence_paths(everything)


def _first_and_all(tour) -> tuple[str, list[str]]:
    ids = [step["node_ids"][0] for step in tour["steps"]]
    return ids[0], ids


def test_the_learn_tour_opens_on_an_entry_point_not_on_contributing_md():
    graph = assemble_graph(_record())

    first, walked = _first_and_all(assemble_tour(graph, "learn"))
    assert first == MAIN
    assert walked == [MAIN, CORE]

    first_shown, walked_shown = _first_and_all(assemble_tour(graph, "learn", include_tests=True, include_docs=True))
    assert first_shown == MAIN  # with tests and docs walked too, the tour still starts where execution does
    assert set(walked_shown) == {MAIN, CORE, TEST, DOC}


def test_the_recall_tour_skips_them_too():
    graph = assemble_graph(_record())

    _, walked = _first_and_all(assemble_tour(graph, "recall"))
    assert walked == [MAIN, CORE]
