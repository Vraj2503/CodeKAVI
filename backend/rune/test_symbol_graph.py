"""
Tests for rune/symbol_graph.py, plus the classifier wiring that feeds it.

The graph is built from names alone, so the thing worth pinning down is the
resolution ladder: what it connects, what it refuses to connect, and that the
refusals are counted rather than quietly dropped.
"""

import os

from rune.classifier import classify_files
from rune.pipeline_models import DepGraph, FileEntry
from rune.symbol_graph import (
    MAX_OVERVIEW_GROUPS,
    MIN_OVERVIEW_GROUPS,
    build_symbol_graph,
    select_groups,
)

# ── Fixtures ──

MAIN_PY = """\
from app.util import helper


class App(Base):
    def run(self):
        helper()
        self.local()

    def local(self):
        pass


class Base:
    pass


def orphaned():
    mystery_call()
"""

UTIL_PY = """\
def helper():
    return 1
"""


def _entry(path: str, content: str, language: str = "Python") -> FileEntry:
    return FileEntry(
        path=path,
        name=os.path.basename(path),
        extension=os.path.splitext(path)[1],
        language=language,
        size=len(content),
        size_formatted=f"{len(content)} B",
        depth=path.count("/"),
        mtime=0.0,
        content=content,
    )


def _dep_data() -> DepGraph:
    return DepGraph(
        edges=[],
        adjacency={"app/main.py": ["app/util.py"]},
        reverse_adjacency={"app/util.py": ["app/main.py"]},
        file_imports={},
        entry_points=[],
        file_signals={},
        central_files=[],
        stats={},
    )


def _classify(tmp_path, files=None):
    """Run the real classifier so the graph is tested against real extraction."""
    files = files or [
        _entry("app/main.py", MAIN_PY),
        _entry("app/util.py", UTIL_PY),
        _entry("README.md", "# hi\n", "Markdown"),
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)
    return symbols, [p.model_dump() for p in profiles]


def _graph(tmp_path, **kwargs):
    symbols, profiles = _classify(tmp_path)
    return build_symbol_graph(symbols, profiles, _dep_data().model_dump(), **kwargs)


def _edges(graph, label=None):
    return {(e["source"], e["target"]) for e in graph["edges"] if label is None or e["label"] == label}


# ── Classifier wiring ──


def test_classify_files_fills_symbols_without_changing_profiles(tmp_path):
    files = [_entry("app/main.py", MAIN_PY), _entry("README.md", "# hi\n", "Markdown")]
    plain = classify_files(str(tmp_path), files, _dep_data())

    symbols: dict[str, list[dict]] = {}
    with_symbols = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)

    assert [p.model_dump() for p in plain] == [p.model_dump() for p in with_symbols]
    # Symbols stay off the profile — that model is serialized into every
    # /analyze response and this data would bloat it.
    assert all("symbols" not in p.model_dump() for p in with_symbols)
    # Unparseable languages contribute no entry at all, rather than an empty one.
    assert set(symbols) == {"app/main.py"}


# ── Resolution ladder ──


def test_same_file_call_resolves(tmp_path):
    graph = _graph(tmp_path)
    assert ("app/main.py::run", "app/main.py::local") in _edges(graph, "calls")


def test_cross_file_call_resolves_through_the_import(tmp_path):
    graph = _graph(tmp_path)
    assert ("app/main.py::run", "app/util.py::helper") in _edges(graph, "calls")


def test_unique_definition_resolves_without_an_import(tmp_path):
    """Third rung: nothing imports it, but only one file defines the name."""
    files = [
        _entry("a.py", "def caller():\n    only_one()\n"),
        _entry("b.py", "def only_one():\n    pass\n"),
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)
    graph = build_symbol_graph(symbols, [p.model_dump() for p in profiles], {})

    assert ("a.py::caller", "b.py::only_one") in _edges(graph, "calls")


def test_an_ambiguous_name_is_dropped_not_guessed(tmp_path):
    """Two definitions, neither imported — the ladder runs out and says so."""
    files = [
        _entry("a.py", "def caller():\n    shared()\n"),
        _entry("b.py", "def shared():\n    pass\n"),
        _entry("c.py", "def shared():\n    pass\n"),
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)
    graph = build_symbol_graph(symbols, [p.model_dump() for p in profiles], {})

    assert _edges(graph, "calls") == set()
    assert graph["metadata"]["unresolved_calls"] == 1
    assert graph["diagnostics"]["resolution_rate"] == 0.0


def test_a_method_name_does_not_resolve_across_files(tmp_path):
    """`some_dict.get(k)` must not bind to whatever class defines `get` elsewhere.

    Receiver types are not inferred, so past the same file a bare method name is
    a guess — and a wrong edge outranks a missing one in the fan-in ordering.
    """
    files = [
        _entry("a.py", "def caller():\n    d = {}\n    d.get('k')\n"),
        _entry("b.py", "class Store:\n    def get(self):\n        pass\n"),
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)
    graph = build_symbol_graph(symbols, [p.model_dump() for p in profiles], {})

    assert _edges(graph, "calls") == set()
    assert graph["metadata"]["unresolved_calls"] == 1


def test_unresolvable_calls_are_counted(tmp_path):
    graph = _graph(tmp_path)
    # `mystery_call` is defined nowhere; `helper`, `local` and the Base
    # inheritance all resolve.
    assert graph["metadata"]["unresolved_calls"] == 1
    assert graph["metadata"]["resolved_calls"] == 3
    assert graph["diagnostics"]["resolution_rate"] == 0.75


def test_inherits_edges_appear(tmp_path):
    graph = _graph(tmp_path)
    assert ("app/main.py::App", "app/main.py::Base") in _edges(graph, "inherits")


def test_typescript_extends_and_calls_resolve(tmp_path):
    files = [
        _entry(
            "src/app.ts",
            "import { helper } from './util';\n"
            "export class App extends Base {\n"
            "  run() { helper(); }\n"
            "}\n"
            "class Base {}\n",
            "TypeScript",
        ),
        _entry("src/util.ts", "export function helper() { return 1; }\n", "TypeScript"),
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(
        str(tmp_path),
        files,
        DepGraph(
            edges=[],
            adjacency={"src/app.ts": ["src/util.ts"]},
            reverse_adjacency={},
            file_imports={},
            entry_points=[],
            file_signals={},
            central_files=[],
            stats={},
        ),
        symbols_out=symbols,
    )
    graph = build_symbol_graph(
        symbols, [p.model_dump() for p in profiles], {"adjacency": {"src/app.ts": ["src/util.ts"]}}
    )

    assert ("src/app.ts::run", "src/util.ts::helper") in _edges(graph, "calls")
    assert ("src/app.ts::App", "src/app.ts::Base") in _edges(graph, "inherits")


# ── Payload shape ──


def test_nodes_carry_file_context(tmp_path):
    graph = _graph(tmp_path)
    helper = next(n for n in graph["nodes"] if n["id"] == "app/util.py::helper")

    assert helper["label"] == "helper"
    assert helper["type"] == "function"
    assert helper["file"] == "app/util.py"
    assert helper["line"] == 1
    assert helper["in_degree"] == 1  # called from main.py
    assert helper["role"]  # enriched from the file profile
    assert helper["importance"] is not None


def test_unresolved_names_survive_as_vocabulary(tmp_path):
    """`mystery_call` resolves to nothing, but naming it is the whole point."""
    graph = _graph(tmp_path)
    orphaned = next(n for n in graph["nodes"] if n["id"] == "app/main.py::orphaned")

    assert orphaned["external_calls"] == ["mystery_call"]
    # The honesty metric must not shift because we started keeping the name.
    assert graph["metadata"]["unresolved_calls"] == 1


def test_generic_names_are_filtered_out_of_the_vocabulary():
    symbols = {
        "a.py": [
            {"name": "f", "kind": "function", "line": 1, "callees": ["len", "append", "json_dumps", "print"]},
        ]
    }
    graph = build_symbol_graph(symbols, [], {})

    assert graph["nodes"][0]["external_calls"] == ["json_dumps"]
    assert graph["metadata"]["unresolved_calls"] == 4  # all four still counted


def test_external_calls_are_capped():
    callees = [f"distinct_call_{i}" for i in range(20)]
    graph = build_symbol_graph({"a.py": [{"name": "f", "kind": "function", "line": 1, "callees": callees}]}, [], {})

    assert graph["nodes"][0]["external_calls"] == callees[:8]


def test_effect_tags_come_from_distinctive_callee_tails():
    symbols = {
        "a.py": [
            {"name": "loader", "kind": "function", "line": 1, "callees": ["open", "execute", "gather"]},
            # `get` is a receiver we can't type — tagging it network would be a guess.
            {"name": "quiet", "kind": "function", "line": 9, "callees": ["get", "run"]},
        ]
    }
    graph = build_symbol_graph(symbols, [], {})
    by_id = {n["id"]: n for n in graph["nodes"]}

    assert by_id["a.py::loader"]["effects"] == ["concurrency", "db", "filesystem"]
    assert by_id["a.py::quiet"]["effects"] == []


def test_nodes_carry_the_semantics_the_parser_found(tmp_path):
    files = [
        _entry(
            "app/api.py",
            '@router.get("/health")\nasync def health(request):\n    """Report liveness."""\n    return {}\n',
        )
    ]
    symbols: dict[str, list[dict]] = {}
    profiles = classify_files(str(tmp_path), files, _dep_data(), symbols_out=symbols)
    node = build_symbol_graph(symbols, [p.model_dump() for p in profiles], {})["nodes"][0]

    assert node["doc"] == "Report liveness."
    assert node["signature"] == "(request)"
    assert node["is_async"] is True
    assert node["http"] == "GET /health"
    assert node["loc"] == 2


def test_truncation_ranks_by_fan_in_before_cutting():
    """The failure this cap exists to avoid: cutting in arbitrary order."""
    symbols = {
        "a.py": [{"name": f"caller{i}", "kind": "function", "line": i, "callees": ["hot"]} for i in range(10)]
        + [{"name": "hot", "kind": "function", "line": 99, "callees": []}]
    }
    graph = build_symbol_graph(symbols, [], {}, max_nodes=3)

    assert graph["nodes"][0]["id"] == "a.py::hot"
    assert len(graph["nodes"]) == 3
    assert graph["metadata"]["is_truncated"] is True
    assert graph["metadata"]["truncated_count"] == 8
    assert graph["metadata"]["total_symbols"] == 11
    # Every drawn edge lands on a drawn node.
    ids = {n["id"] for n in graph["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in graph["edges"])


def test_recursion_does_not_draw_a_self_loop():
    symbols = {"a.py": [{"name": "walk", "kind": "function", "line": 1, "callees": ["walk"]}]}
    graph = build_symbol_graph(symbols, [], {})

    assert graph["edges"] == []
    assert graph["metadata"]["resolved_calls"] == 1  # it resolved; it just isn't drawn


# ── Overview tier ──


def test_groups_collapse_symbols_by_file(tmp_path):
    graph = _graph(tmp_path)
    groups = {g["id"]: g for g in graph["groups"]}

    assert set(groups) == {"app/main.py", "app/util.py"}
    assert groups["app/main.py"]["label"] == "main.py"
    # App, Base, run, local, orphaned — every symbol lands in exactly one group.
    assert sum(g["symbol_count"] for g in graph["groups"]) == len(graph["nodes"])
    assert graph["metadata"]["total_groups"] == 2


def test_group_edges_aggregate_cross_file_calls(tmp_path):
    graph = _graph(tmp_path)

    # run() -> helper() is the one call that crosses a file boundary.
    assert graph["group_edges"] == [{"source": "app/main.py", "target": "app/util.py", "weight": 1}]
    # run() -> self.local() stays inside main.py and would draw as a self-loop.
    assert all(e["source"] != e["target"] for e in graph["group_edges"])


def test_collapsing_keeps_an_edge_that_cutting_would_strand(tmp_path):
    """The whole reason this tier exists: a symbol cut severs, a collapse doesn't."""
    graph = _graph(tmp_path, max_nodes=1)

    assert graph["edges"] == []  # only one symbol survives, so nothing connects it
    assert graph["group_edges"] == [{"source": "app/main.py", "target": "app/util.py", "weight": 1}]
    # Counts describe the repo, not the one node left standing.
    assert sum(g["symbol_count"] for g in graph["groups"]) == graph["metadata"]["total_symbols"]


def _importance_graph(count: int, importance, **kwargs) -> dict:
    symbols = {f"f{i}.py": [{"name": f"fn{i}", "kind": "function", "line": 1, "callees": []}] for i in range(count)}
    profiles = [{"path": f"f{i}.py", "importance_score": importance(i)} for i in range(count)]
    return build_symbol_graph(symbols, profiles, {}, **kwargs)


def test_groups_rank_by_importance_and_store_past_what_is_drawn():
    graph = _importance_graph(5, float, max_groups=2)

    assert [g["id"] for g in graph["groups"]] == ["f4.py", "f3.py", "f2.py", "f1.py", "f0.py"]
    # The tail is stored, not drawn: re-picking later never needs a rebuild.
    assert [g["id"] for g in graph["groups"] if g["drawn"]] == ["f4.py", "f3.py"]
    assert graph["metadata"]["drawn_groups"] == 2
    assert graph["metadata"]["group_selection"] == "fixed"
    assert graph["metadata"]["total_groups"] == 5


def test_the_drawn_count_follows_the_importance_falloff():
    """Ten real modules then a cliff draws ten; a flat repo draws them all."""
    cliff = _importance_graph(30, lambda i: 100.0 if i < 10 else 1.0)
    flat = _importance_graph(30, lambda i: 100.0)

    assert sum(g["drawn"] for g in cliff["groups"]) == 10
    assert sum(g["drawn"] for g in flat["groups"]) == 30
    assert cliff["metadata"]["group_selection"] == "adaptive"


def test_the_adaptive_count_is_clamped_at_both_ends():
    one_dominant = _importance_graph(20, lambda i: 100.0 if i == 0 else 0.0)
    broad = _importance_graph(60, lambda i: 100.0)

    assert sum(g["drawn"] for g in one_dominant["groups"]) == MIN_OVERVIEW_GROUPS
    assert sum(g["drawn"] for g in broad["groups"]) == MAX_OVERVIEW_GROUPS


def test_select_groups_redraws_the_overview_without_a_rebuild():
    graph = _importance_graph(20, float, max_groups=2)

    picked = select_groups(graph, {"f0.py", "f9.py"})

    assert [g["id"] for g in picked["groups"] if g["drawn"]] == ["f9.py", "f0.py"]
    assert picked["metadata"]["group_selection"] == "llm"
    assert picked["metadata"]["drawn_groups"] == 2
    assert picked["diagnostics"]["group_count"] == 2
    # Same groups, same edges — only the flag moved.
    assert [g["id"] for g in picked["groups"]] == [g["id"] for g in graph["groups"]]
    assert picked["group_edges"] == graph["group_edges"]


def test_select_groups_keeps_the_adaptive_pick_when_nothing_matches():
    graph = _importance_graph(20, float)

    assert select_groups(graph, {"nowhere.py"}) == graph
    assert select_groups(graph, set()) == graph


def test_test_files_sort_last_but_are_not_dropped():
    symbols = {p: [{"name": f"fn_{p}", "kind": "function", "line": 1, "callees": []}] for p in ("t.py", "a.py")}
    # The test file outscores the source file, as it does on real repos.
    profiles = [
        {"path": "t.py", "importance_score": 90.0, "role": "test"},
        {"path": "a.py", "importance_score": 10.0, "role": "leaf"},
    ]
    graph = build_symbol_graph(symbols, profiles, {})

    assert [g["id"] for g in graph["groups"]] == ["a.py", "t.py"]


def test_a_group_previews_what_is_inside_it():
    symbols = {
        "a.py": [{"name": f"caller{i}", "kind": "function", "line": i, "callees": ["hot"]} for i in range(5)]
        + [
            {"name": "hot", "kind": "function", "line": 99, "callees": ["open"]},
            {"name": "handle", "kind": "function", "line": 200, "callees": [], "decorators": ['@router.get("/x")']},
        ]
    }
    group = build_symbol_graph(symbols, [], {})["groups"][0]

    assert group["top_symbols"] == ["hot", "caller0", "caller1"]  # fan-in order, capped at 3
    assert group["effects"] == ["filesystem"]  # rolled up from hot()
    assert group["routes"] == ["GET /x"]


def test_unsupported_languages_names_code_we_cannot_parse(tmp_path):
    profiles = [
        {"path": "a.py", "language": "Python"},
        {"path": "b.go", "language": "Go"},
        {"path": "c.rb", "language": "Ruby"},
        {"path": "README.md", "language": "Markdown"},
    ]
    graph = build_symbol_graph({}, profiles, {})

    # Go and Ruby are code we can't read yet; Markdown was never a candidate.
    assert graph["metadata"]["unsupported_languages"] == ["Go", "Ruby"]


def test_an_empty_repo_reports_a_clean_rate():
    graph = build_symbol_graph({}, [], {})

    assert graph["nodes"] == []
    assert graph["edges"] == []
    assert graph["diagnostics"]["resolution_rate"] == 1.0
    assert graph["metadata"]["is_truncated"] is False
