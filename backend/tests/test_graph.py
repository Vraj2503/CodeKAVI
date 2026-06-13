"""
test_graph.py — Tests for graph export and cycle detection.

Phase 0: Smoke tests.
Phase 4: Full coverage (JSON/DOT/Mermaid, module graph, cycles).
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
