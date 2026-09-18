"""
Tests for rune/symbol_graph.py, plus the classifier wiring that feeds it.

The graph is built from names alone, so the thing worth pinning down is the
resolution ladder: what it connects, what it refuses to connect, and that the
refusals are counted rather than quietly dropped.
"""

import os

from rune.classifier import classify_files
from rune.pipeline_models import DepGraph, FileEntry
from rune import symbol_graph
from rune.symbol_graph import _contract_edges, build_symbol_graph

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


def _edges(graph, kind_prefix=None):
    return {
        (e["source"], e["target"]) for e in graph["edges"] if kind_prefix is None or e["kind"].startswith(kind_prefix)
    }


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
        _entry("a.py", "def caller():\n    x = 1\n    only_one()\n    return x\n"),
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
            "  run() {\n"
            "    const x = 1;\n"
            "    helper();\n"
            "    return x;\n"
            "  }\n"
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


def test_important_set_ranks_by_fan_in_before_capping(monkeypatch):
    """The failure this cap exists to avoid: cutting in arbitrary order."""
    monkeypatch.setattr(symbol_graph, "MAX_IMPORTANT_SYMBOLS", 3)
    symbols = {
        "a.py": [
            {"name": f"caller{i}", "kind": "function", "line": i, "end_line": i + 3, "callees": ["hot"]}
            for i in range(10)
        ]
        + [{"name": "hot", "kind": "function", "line": 99, "callees": []}]
    }
    graph = build_symbol_graph(symbols, [], {})

    assert graph["nodes"][0]["id"] == "a.py::hot"
    assert len(graph["nodes"]) == 3
    assert graph["metadata"]["important_symbols"] == 3
    assert graph["metadata"]["total_symbols"] == 11
    # Every edge lands on a kept node — `_contract_edges` only ever runs over `important_ids`.
    ids = {n["id"] for n in graph["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in graph["edges"])


def test_recursion_does_not_draw_a_self_loop():
    symbols = {"a.py": [{"name": "walk", "kind": "function", "line": 1, "callees": ["walk"]}]}
    graph = build_symbol_graph(symbols, [], {})

    assert graph["edges"] == []
    assert graph["metadata"]["resolved_calls"] == 1  # it resolved; it just isn't drawn


def test_test_role_symbols_sort_last_despite_higher_fan_in():
    """Deprioritized, not excluded: a test-role symbol can still be `important`,
    it just never outranks a non-test symbol of equal or lower fan-in."""
    symbols = {
        "t.py": [{"name": "fn_t", "kind": "function", "line": 1, "callees": []}],
        "a.py": [{"name": f"caller{i}", "kind": "function", "line": i, "callees": ["fn_t"]} for i in range(5)]
        + [
            {"name": "user_of_a", "kind": "function", "line": 50, "callees": ["fn_a"]},
            {"name": "fn_a", "kind": "function", "line": 60, "callees": []},
        ],
    }
    profiles = [{"path": "t.py", "role": "test"}, {"path": "a.py", "role": "leaf"}]
    graph = build_symbol_graph(symbols, profiles, {})
    by_id = {n["id"]: n for n in graph["nodes"]}

    # fn_t has 5 callers, fn_a has 1 — fn_t would rank first on importance alone.
    assert by_id["t.py::fn_t"]["symbol_importance"] > by_id["a.py::fn_a"]["symbol_importance"]
    ids = [n["id"] for n in graph["nodes"]]
    assert ids.index("a.py::fn_a") < ids.index("t.py::fn_t")
    assert by_id["t.py::fn_t"]["important"] is True


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


# ── Per-symbol importance ──


def test_ui_wrapper_component_excluded_despite_high_out_degree():
    """A zero-caller React component in components/ that fans out to hooks and
    API calls should not dominate the graph over real backend logic."""
    symbols = {
        "frontend/components/Dashboard.tsx": [
            {
                "name": "Dashboard",
                "kind": "function",
                "line": 1,
                "callees": ["useAuth", "useFetch", "formatDate"],
            }
        ],
        "backend/service.py": [{"name": "process_payment", "kind": "function", "line": 1, "callees": ["execute"]}],
    }
    profiles = [
        {"path": "frontend/components/Dashboard.tsx", "role": "leaf"},
        {"path": "backend/service.py", "role": "internal_helper"},
    ]
    graph = build_symbol_graph(symbols, profiles, {})
    ids = {n["id"] for n in graph["nodes"]}

    assert "frontend/components/Dashboard.tsx::Dashboard" not in ids
    assert "backend/service.py::process_payment" in ids


def test_hard_exclusions_are_never_important_despite_high_fan_in():
    symbols = {
        "a.py": [
            {"name": f"caller{i}", "kind": "function", "line": i, "callees": ["__init__", "get_x"]} for i in range(20)
        ]
        + [
            {"name": "__init__", "kind": "method", "line": 100, "callees": []},
            {"name": "get_x", "kind": "method", "line": 110, "callees": []},
            {"name": "isolated", "kind": "function", "line": 120, "callees": []},
            {"name": "real_worker", "kind": "function", "line": 130, "callees": ["open"]},
        ],
    }
    graph = build_symbol_graph(symbols, [], {})
    ids = {n["id"] for n in graph["nodes"]}
    by_id = {n["id"]: n for n in graph["nodes"]}

    # __init__ and get_x rack up in-degree from 20 callers each, which would
    # otherwise dominate the ranking — the hard exclusions must still hold.
    # Excluded symbols never become candidates, so they never reach the
    # payload at all (only the important set is returned).
    assert "a.py::__init__" not in ids
    assert "a.py::get_x" not in ids
    assert "a.py::isolated" not in ids
    assert by_id["a.py::real_worker"]["important"] is True


def test_effects_and_cross_file_reach_can_outscore_trivial_fan_in():
    """A real, effectful entry point should outscore a trivial pass-through that
    merely gets called a lot — fan-in alone is not the whole importance story."""
    symbols = {
        "a.py": [{"name": f"caller{i}", "kind": "function", "line": i, "callees": ["trivial"]} for i in range(5)]
        + [{"name": "trivial", "kind": "function", "line": 50, "callees": []}],
        "b.py": [
            {
                "name": "handler",
                "kind": "function",
                "line": 1,
                "callees": ["open", "execute", "trivial"],
                "decorators": ['@router.post("/x")'],
            }
        ],
    }
    graph = build_symbol_graph(symbols, [], {})
    by_id = {n["id"]: n for n in graph["nodes"]}

    assert by_id["b.py::handler"]["symbol_importance"] > by_id["a.py::trivial"]["symbol_importance"]


# ── Edge contraction ──


def _edge_map(pairs: list[tuple[str, str, str]]) -> dict:
    return {(s, t, label): {"source": s, "target": t, "label": label} for s, t, label in pairs}


def test_contraction_bridges_a_chain_through_cut_glue():
    edges = _edge_map([("A", "glue1", "calls"), ("glue1", "glue2", "calls"), ("glue2", "B", "calls")])
    contracted, truncated = _contract_edges(edges, {"A", "B"})

    assert contracted == [
        {"source": "A", "target": "B", "kind": "calls_transitive", "hops": 3, "via": ["glue1", "glue2"]}
    ]
    assert truncated is False


def test_a_direct_edge_wins_over_a_longer_transitive_path():
    edges = _edge_map([("A", "B", "calls"), ("A", "glue", "calls"), ("glue", "B", "calls")])
    contracted, _ = _contract_edges(edges, {"A", "B"})

    assert contracted == [{"source": "A", "target": "B", "kind": "calls_direct", "hops": 1}]


def test_a_branch_that_never_reaches_an_important_node_is_dropped():
    chain = [(f"glue{i}", f"glue{i + 1}", "calls") for i in range(6)]
    edges = _edge_map([("A", "glue0", "calls")] + chain)
    contracted, _ = _contract_edges(edges, {"A"})

    assert contracted == []


def test_inherits_edges_are_direct_only_no_bfs():
    edges = _edge_map([("Child", "Parent", "inherits")])
    contracted, _ = _contract_edges(edges, {"Child", "Parent"})

    assert contracted == [{"source": "Child", "target": "Parent", "kind": "inherits", "hops": 1}]


def test_an_empty_repo_reports_a_clean_rate():
    graph = build_symbol_graph({}, [], {})

    assert graph["nodes"] == []
    assert graph["edges"] == []
    assert graph["diagnostics"]["resolution_rate"] == 1.0
    assert graph["metadata"]["edges_truncated"] is False
