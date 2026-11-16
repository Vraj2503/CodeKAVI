"""T38: the mind map is the repository's own structure, each file told by its facts."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rune.cache import AnalysisCache
from rune.routes import visualize
from rune.routes.visualize import MindmapRequest, _build_static_mindmap, visualize_mindmap


def _profile(path, importance, role="core_module"):
    return {"path": path, "role": role, "role_label": role.replace("_", " ").title(), "importance_score": importance}


REPO = [
    _profile("backend/main.py", 99, "entry_point"),
    _profile("backend/rune/cache.py", 90),
    _profile("backend/rune/routes/chat.py", 95, "router"),
    _profile("backend/rune/routes/analyze.py", 94, "router"),
    _profile("frontend/lib/api.ts", 92),
    _profile("frontend/components/Chat.tsx", 80, "ui_component"),
    _profile("setup.py", 10, "config"),
]


def _all_nodes(node):
    yield node
    for child in node.get("children") or []:
        yield from _all_nodes(child)


def _file_nodes(root):
    return [n for n in _all_nodes(root) if "children" not in n]


def _labels(nodes):
    return [n["label"] for n in nodes]


def test_the_first_level_is_the_repos_areas_then_their_modules():
    root = _build_static_mindmap(REPO, name="CodeKAVI")

    assert root["label"] == "CodeKAVI"
    assert _labels(root["children"]) == ["backend", "frontend", "(root)"]  # most important first
    backend = root["children"][0]
    assert _labels(backend["children"]) == ["main.py", "routes", "rune"]  # its own files beside its modules
    routes = backend["children"][1]
    assert (routes["id"], routes["path"], routes["files"]) == ("module:backend/rune/routes", "backend/rune/routes", 2)
    assert _labels(routes["children"]) == ["chat.py", "analyze.py"]


def test_labels_are_short_but_tell_siblings_apart():
    others = [_profile(f"pkg{m}/main.py", 50 - m) for m in range(9)]  # keep "web" under a fifth: unsplit
    root = _build_static_mindmap([_profile("web/a/index.ts", 99), _profile("web/b/index.ts", 98), *others])

    web = root["children"][0]
    assert _labels(web["children"]) == ["a/index.ts", "b/index.ts"]
    assert [n["path"] for n in web["children"]] == ["web/a/index.ts", "web/b/index.ts"]


def test_each_file_is_told_by_its_sentence_or_purpose_and_its_key_symbols():
    symbols = [
        {"name": "Cache", "kind": "class", "line": 1, "complexity": 30},
        *({"name": f"f{i}", "kind": "function", "line": 10 + i, "complexity": i} for i in range(7)),
    ]
    facts: dict[str, dict] = {
        "backend/rune/cache.py": {
            "purpose": "Defines: Cache",
            "purpose_source": "derived",
            "summary": "Keeps analysis records in memory, Redis and Supabase.",
            "symbols": symbols,
        },
        "backend/main.py": {"purpose": "Starts the API server.", "purpose_source": "doc", "symbols": []},
    }
    files = {n["path"]: n for n in _file_nodes(_build_static_mindmap(REPO, facts))}

    cache = files["backend/rune/cache.py"]
    assert (cache["description"], cache["description_source"]) == (
        "Keeps analysis records in memory, Redis and Supabase.",
        "summary",
    )
    assert [s["name"] for s in cache["symbols"]] == ["f6", "f5", "f4", "f3", "f2"]  # top_symbols: by complexity
    assert files["backend/main.py"]["description"] == "Starts the API server."
    assert "description" not in files["frontend/lib/api.ts"]  # no facts, nothing made up


def test_caps_per_branch_replace_the_cut_at_the_first_50_files():
    profiles = [_profile(f"pkg{m}/file{f:02}.py", 1000 - (m * 25 + f)) for m in range(6) for f in range(25)]
    root = _build_static_mindmap(profiles)

    assert _labels(root["children"]) == [f"pkg{m}" for m in range(6)]  # the old cut reached 2 of these 6
    assert all(len(area["children"]) == 20 and area["files"] == 25 for area in root["children"])
    assert root["children"][5]["children"][0]["path"] == "pkg5/file00.py"  # each folder's most important


def test_no_node_has_more_than_20_children():
    """RadialMindmap pages a folder past 20 children; sending more only grows the response."""
    web = [_profile(f"web/m{i:02}/f{j}.py", 200 - 3 * i - j) for i in range(24) for j in range(3)]
    api = [_profile(f"api/x{k}.py", 50 - k) for k in range(4)]
    root = _build_static_mindmap(web + api)

    assert _labels(root["children"]) == ["web", "api"]
    assert _labels(root["children"][0]["children"]) == [f"m{i:02}" for i in range(20)]  # the 20 most important of 24

    many = _build_static_mindmap([_profile(f"pkg{m:02}/a.py", 100 - m) for m in range(25)])
    assert _labels(many["children"]) == [f"pkg{m:02}" for m in range(20)]


def test_files_the_analysis_measured_nothing_in_stay_off_the_map():
    noise = [_profile("backend/Dockerfile", 0.0, "build"), _profile("backend/requirements.txt", 0.0, "leaf")]
    paths = {n["path"] for n in _file_nodes(_build_static_mindmap(REPO + noise))}
    assert paths == {p["path"] for p in REPO}

    only_build_files = [_profile("Dockerfile", 0.0, "build"), _profile("Makefile", 0.0, "build")]
    assert {n["path"] for n in _file_nodes(_build_static_mindmap(only_build_files))} == {"Dockerfile", "Makefile"}


def test_a_repo_in_one_folder_starts_at_its_contents():
    root = _build_static_mindmap([_profile("src/app.py", 9), _profile("src/util.py", 5)])
    assert _labels(root["children"]) == ["app.py", "util.py"]


def test_ids_stay_unique_for_files_that_share_a_name():
    profiles = [_profile("a/index.ts", 5), _profile("b/index.ts", 4), _profile("index.ts", 3)]
    ids = [n["id"] for n in _all_nodes(_build_static_mindmap(profiles))]
    assert len(ids) == len(set(ids))


@pytest.mark.asyncio
async def test_the_route_reads_the_facts_of_a_reused_analysis_and_calls_no_llm():
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    cache.facts.put("origin123456", {"backend/main.py": {"purpose": "Starts the API server.", "symbols": []}})
    record = {"repo_name": "CodeKAVI", "_origin_repo_id": "origin123456", "file_profiles": REPO}

    with (
        patch.object(visualize, "_load_repo", AsyncMock(return_value=(record, None))),
        patch("rune.llm.providers.get_provider", side_effect=AssertionError("the static map calls no LLM")),
    ):
        response = await visualize_mindmap(MagicMock(), "r", MindmapRequest(), cache=cache, user_id="u")

    root = response["data"]["root"]
    assert root["label"] == "CodeKAVI" and response["data"]["meta"] == {"is_llm_enriched": False, "cached": False}
    main = next(n for n in _file_nodes(root) if n["path"] == "backend/main.py")
    assert main["description"] == "Starts the API server."
