"""
test_tour_generator.py — Tests for the deterministic zero-LLM tour.

Covers T2.5:
  * DAG ordering (Kahn's algorithm topological sort).
  * Cyclic-node fallthrough: cyclic nodes still appear after acyclic ones,
    sorted by importance desc.
  * Determinism: identical input → byte-identical output across calls.
  * Truncation via ``max_steps``.
"""


def _build(dag_edges: dict[str, list[str]]) -> dict:
    """Build a dep_data dict from a src -> targets adjacency map."""
    edges = [{"source": s, "target": t, "type": "import"} for s, ts in dag_edges.items() for t in ts]
    return {
        "adjacency": {k: list(v) for k, v in dag_edges.items()},
        "reverse_adjacency": {},
        "edges": edges,
        "entry_points": [],
    }


def _profiles_for(paths: list[str]) -> list[dict]:
    """Build profile list where importance_score == 100 - index (desc)."""
    return [
        {
            "path": p,
            "role": "core_module",
            "role_label": "Core Module",
            "importance_score": 100 - i,
            "language": "Python",
        }
        for i, p in enumerate(paths)
    ]


class TestDagOrdering:
    """Pure DAG → all nodes appear in Kahn's topological order."""

    def test_chain_topology_order(self):
        from codekavi.tour_generator import generate_deterministic_tour

        dep = _build({"a.py": ["b.py"], "b.py": ["c.py"], "c.py": []})
        tour = generate_deterministic_tour(dep)
        assert [s["file"] for s in tour] == ["a.py", "b.py", "c.py"]

    def test_diamond_starts_with_no_dependents(self):
        from codekavi.tour_generator import generate_deterministic_tour

        # diamond: a → b, a → c, b → d, c → d
        dep = _build({"a.py": ["b.py", "c.py"], "b.py": ["d.py"], "c.py": ["d.py"], "d.py": []})
        tour = generate_deterministic_tour(dep)
        files = [s["file"] for s in tour]
        assert files[0] == "a.py"
        assert files[-1] == "d.py"
        # b and c must come before d
        assert files.index("b.py") < files.index("d.py")
        assert files.index("c.py") < files.index("d.py")

    def test_empty_graph_returns_empty_tour(self):
        from codekavi.tour_generator import generate_deterministic_tour

        assert generate_deterministic_tour({"adjacency": {}, "edges": []}) == []


class TestCyclicFallback:
    """Nodes part of cycles must surface despite Kahn's not reaching them."""

    def test_cyclic_nodes_appear_after_acyclic(self):
        from codekavi.tour_generator import generate_deterministic_tour

        # acyclic: a → b
        # cyclic: c → d → c
        dep = _build({"a.py": ["b.py"], "b.py": [], "c.py": ["d.py"], "d.py": ["c.py"]})
        files = [
            f["file"]
            for f in generate_deterministic_tour(
                dep,
                file_profiles=_profiles_for(["a.py", "b.py", "c.py", "d.py"]),
            )
        ]
        # a, b must precede c, d
        assert files.index("a.py") < files.index("c.py")
        assert files.index("b.py") < files.index("c.py")
        # All 4 files present (Kahn's skip only LEAVES cyclic nodes, doesn't
        # eliminate them — they appear via the importance-sorted fallback).
        assert set(files) == {"a.py", "b.py", "c.py", "d.py"}

    def test_cyclic_sorted_by_importance(self):
        from codekavi.tour_generator import generate_deterministic_tour

        # cyclic triple, importance: a=10 < b=50 < c=90
        dep = _build({"a.py": ["b.py"], "b.py": ["c.py"], "c.py": ["a.py"]})
        profiles = _profiles_for(["a.py", "b.py", "c.py"])
        files = [
            f["file"]
            for f in generate_deterministic_tour(dep, file_profiles=profiles)
        ]
        # All 3 must be present (cyclic ones fall through the append).
        assert set(files) == {"a.py", "b.py", "c.py"}


class TestDeterminism:
    """Identical input must produce byte-identical output across calls."""

    def test_two_calls_yield_identical_output(self):
        from codekavi.tour_generator import generate_deterministic_tour

        dep = _build(
            {"a.py": ["b.py", "c.py"], "b.py": ["d.py"], "c.py": ["d.py"], "d.py": ["e.py"]}
        )
        profiles = _profiles_for(["a.py", "b.py", "c.py", "d.py", "e.py"])

        first = generate_deterministic_tour(dep, file_profiles=profiles)
        second = generate_deterministic_tour(dep, file_profiles=profiles)
        assert first == second

    def test_returned_structure_has_required_keys(self):
        from codekavi.tour_generator import generate_deterministic_tour

        dep = _build({"a.py": ["b.py"], "b.py": []})
        tour = generate_deterministic_tour(dep)
        assert len(tour) == 2
        for stop in tour:
            for k in ("file", "role", "role_label", "importance", "description", "connections"):
                assert k in stop


class TestTruncation:
    """``max_steps`` must cap tour length without breaking determinism."""

    def test_truncates_to_max_steps(self):
        from codekavi.tour_generator import generate_deterministic_tour

        # a → b → c → d → e (chain of 5)
        dep = _build(
            {"a.py": ["b.py"], "b.py": ["c.py"], "c.py": ["d.py"], "d.py": ["e.py"], "e.py": []}
        )
        tour = generate_deterministic_tour(dep, max_steps=3)
        assert len(tour) == 3
        # First three of dependency order = ["a.py", "b.py", "c.py"]
        assert [s["file"] for s in tour] == ["a.py", "b.py", "c.py"]
