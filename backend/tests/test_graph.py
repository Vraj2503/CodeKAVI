"""
test_graph.py — Tests for graph export and cycle detection.

Phase 0: Smoke tests.
Phase 4: Full coverage (JSON/DOT/Mermaid, module graph, cycles).
T2.3: Progressive node capping with synthetic __collapsed__ node.
"""


class TestGraphJsonExport:
    """Test the JSON graph export."""

    def test_graph_json_structure(self, sample_dep_data, sample_file_profiles):
        """export_graph_json should produce valid nodes/edges/metadata."""
        from codekavi.graph import export_graph_json

        graph = export_graph_json(sample_dep_data, sample_file_profiles)
        assert "nodes" in graph
        assert "edges" in graph
        assert "metadata" in graph
        assert isinstance(graph["nodes"], list)
        assert isinstance(graph["edges"], list)

    def test_edges_reference_valid_nodes(self, sample_dep_data, sample_file_profiles):
        """Every edge source/target should exist as a node ID."""
        from codekavi.graph import export_graph_json

        graph = export_graph_json(sample_dep_data, sample_file_profiles)
        node_ids = {n["id"] for n in graph["nodes"]}

        for edge in graph["edges"]:
            assert edge["source"] in node_ids, f"Edge source {edge['source']} not in nodes"
            assert edge["target"] in node_ids, f"Edge target {edge['target']} not in nodes"


class TestCycleDetection:
    """Test circular dependency detection."""

    def test_no_cycles_in_fixture(self, sample_dep_data):
        """The fixture repo should have no circular dependencies."""
        from codekavi.graph import detect_cycles

        result = detect_cycles(sample_dep_data)
        assert "has_cycles" in result
        assert "cycle_count" in result
        assert "cycles" in result

    def test_detect_synthetic_cycle(self):
        """Verify cycle detection works with a known cyclic graph."""
        from codekavi.graph import detect_cycles

        dep_data = {
            "adjacency": {
                "a.py": ["b.py"],
                "b.py": ["c.py"],
                "c.py": ["a.py"],  # cycle: a → b → c → a
            }
        }
        result = detect_cycles(dep_data)
        assert result["has_cycles"] is True
        assert result["cycle_count"] >= 1
        # The cycle should contain a, b, c
        cycle_members = set()
        for cycle in result["cycles"]:
            cycle_members.update(cycle)
        assert {"a.py", "b.py", "c.py"}.issubset(cycle_members)


class TestDotExport:
    """Test DOT format export."""

    def test_dot_output_valid(self, sample_dep_data, sample_file_profiles):
        """export_dot should produce valid DOT syntax."""
        from codekavi.graph import export_dot, export_graph_json

        graph = export_graph_json(sample_dep_data, sample_file_profiles)
        dot = export_dot(graph, title="Test Graph")
        assert dot.startswith("digraph")
        assert dot.strip().endswith("}")


class TestMermaidExport:
    """Test Mermaid diagram export."""

    def test_mermaid_output_valid(self, sample_dep_data, sample_file_profiles):
        """export_mermaid should produce valid Mermaid syntax."""
        from codekavi.graph import export_graph_json, export_mermaid

        graph = export_graph_json(sample_dep_data, sample_file_profiles)
        mermaid = export_mermaid(graph)
        assert mermaid.startswith("flowchart")


class TestGraphCapping:
    """T2.3 — progressive node capping with synthetic __collapsed__ node."""

    def _make_synthetic(self, n: int) -> dict:
        """Build a dep_data dict with N connected nodes all connected to a hub."""
        nodes = [f"f{i}.py" for i in range(n)]
        # Each node imports the hub; the hub imports nothing.
        edges = [{"source": src, "target": "hub.py", "type": "import"} for src in nodes[:-1]]
        adjacency = {src: ["hub.py"] for src in nodes[:-1]}
        adjacency["hub.py"] = []
        return {
            "adjacency": adjacency,
            "reverse_adjacency": {"hub.py": nodes[:-1]},
            "edges": edges,
            "entry_points": [],
        }

    def _make_profiles(self, n: int) -> list[dict]:
        """Build file_profiles with importance = 100 - index."""
        return [
            {
                "path": f"f{i}.py" if i < n - 1 else "hub.py",
                "role": "core_module",
                "role_label": "Core",
                "importance_score": 100 - i,
                "language": "Python",
            }
            for i in range(n)
        ]

    def test_truncates_at_max_nodes(self):
        """Net node count after truncation = max_nodes (top kept + 1 collapsed)."""
        from codekavi.graph import export_graph_json

        dep_data = self._make_synthetic(300)
        profiles = self._make_profiles(300)
        graph = export_graph_json(dep_data, profiles, max_nodes=100)
        # Top max_nodes-1 = 99 + 1 collapsed = 100 total
        assert len(graph["nodes"]) == 100
        assert graph["metadata"]["is_truncated"] is True
        assert graph["metadata"]["truncated_count"] == 201  # 300 - 99

    def test_collapsed_node_present(self):
        """One synthetic __collapsed__ node must exist when truncation fires."""
        from codekavi.graph import export_graph_json

        dep_data = self._make_synthetic(150)
        profiles = self._make_profiles(150)
        graph = export_graph_json(dep_data, profiles, max_nodes=50)
        collapsed = [n for n in graph["nodes"] if n["id"] == "__collapsed__"]
        assert len(collapsed) == 1
        assert collapsed[0]["role"] == "collapsed"
        assert "more files" in collapsed[0]["label"]
        # Aggregated weight must equal sum of removed endpoints' degree.
        assert collapsed[0]["in_degree"] > 0 or collapsed[0]["out_degree"] > 0

    def test_edges_are_deduped(self):
        """Each (source, target) tuple in ``edges`` appears exactly once."""
        from codekavi.graph import export_graph_json

        dep_data = self._make_synthetic(200)
        profiles = self._make_profiles(200)
        graph = export_graph_json(dep_data, profiles, max_nodes=20)
        seen = set()
        for e in graph["edges"]:
            key = (e["source"], e["target"])
            assert key not in seen, f"Duplicate edge {key}"
            seen.add(key)

    def test_no_truncate_when_below_threshold(self):
        """Small graphs should not truncate."""
        from codekavi.graph import export_graph_json

        dep_data = self._make_synthetic(5)
        profiles = self._make_profiles(5)
        graph = export_graph_json(dep_data, profiles, max_nodes=100)
        assert len(graph["nodes"]) == 5
        assert graph["metadata"]["is_truncated"] is False
        assert graph["metadata"]["truncated_count"] == 0
        assert all(n["id"] != "__collapsed__" for n in graph["nodes"])
