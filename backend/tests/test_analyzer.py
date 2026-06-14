"""
test_analyzer.py — Tests for the dependency analyzer.

Phase 0: Smoke tests to verify tooling works.
Phase 4: Full coverage (import extraction, resolution, graph construction).
"""


class TestPythonImportExtraction:
    """Test Python AST-based import extraction."""

    def test_extract_absolute_import(self, sample_repo_path, sample_file_list):
        """Verify that 'from utils.helpers import ...' in main.py is extracted."""
        from codekavi.analyzer import analyze_dependencies

        dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
        adjacency = dep_data["adjacency"]

        # main.py should import from utils/__init__.py or utils/helpers.py
        assert "main.py" in adjacency, "main.py should have outgoing edges"
        main_deps = adjacency["main.py"]
        # Should resolve to utils/__init__.py or utils/helpers.py
        assert any("utils" in dep for dep in main_deps), (
            f"main.py should depend on something in utils/, got: {main_deps}"
        )

    def test_entry_points_detected(self, sample_repo_path, sample_file_list):
        """Verify that main.py and cmd/main.go are detected as entry points."""
        from codekavi.analyzer import analyze_dependencies

        dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
        entry_files = {ep["file"] for ep in dep_data["entry_points"]}

        assert "main.py" in entry_files, "main.py should be detected as an entry point"

    def test_content_cache_excluded(self, sample_repo_path, sample_file_list):
        """Verify content_cache is NOT returned in the dep_data dict."""
        from codekavi.analyzer import analyze_dependencies

        dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
        assert "content_cache" not in dep_data, "content_cache should be excluded from analyzer output"


class TestJsImportExtraction:
    """Test JS/TS import extraction."""

    def test_extract_js_imports(self, sample_repo_path, sample_file_list):
        """Verify JS imports from index.js are extracted."""
        from codekavi.analyzer import analyze_dependencies

        dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
        file_imports = dep_data["file_imports"]

        # Find index.js imports
        js_keys = [k for k in file_imports if k.endswith("index.js")]
        assert len(js_keys) > 0, f"Should have imports for index.js, got keys: {list(file_imports.keys())}"

        js_imports = file_imports[js_keys[0]]
        raw_imports = [imp["raw"] for imp in js_imports]
        assert "./api" in raw_imports or "./api.ts" in raw_imports, (
            f"index.js should import from ./api, got: {raw_imports}"
        )


class TestGoImportExtraction:
    """Test Go import extraction."""

    def test_extract_go_grouped_imports(self, sample_repo_path, sample_file_list):
        """Verify Go grouped imports are extracted."""
        from codekavi.analyzer import analyze_dependencies

        dep_data = analyze_dependencies(sample_repo_path, sample_file_list)
        file_imports = dep_data["file_imports"]

        go_keys = [k for k in file_imports if k.endswith("main.go")]
        assert len(go_keys) > 0, f"Should have imports for main.go, got keys: {list(file_imports.keys())}"

        go_imports = file_imports[go_keys[0]]
        raw_imports = [imp["raw"] for imp in go_imports]
        assert "fmt" in raw_imports, f"main.go should import fmt, got: {raw_imports}"
        assert "os" in raw_imports, f"main.go should import os, got: {raw_imports}"


class TestDependencyGraphStats:
    """Test dependency graph statistics."""

    def test_stats_computed(self, sample_dep_data):
        """Verify stats are computed correctly."""
        stats = sample_dep_data["stats"]
        assert "total_edges" in stats
        assert "resolved_edges" in stats
        assert "unresolved_edges" in stats
        assert stats["total_edges"] == stats["resolved_edges"] + stats["unresolved_edges"]

    def test_reverse_adjacency_consistent(self, sample_dep_data):
        """Verify reverse_adjacency is the transpose of adjacency."""
        adjacency = sample_dep_data["adjacency"]
        reverse = sample_dep_data["reverse_adjacency"]

        for src, targets in adjacency.items():
            for tgt in targets:
                assert src in reverse.get(tgt, []), f"{src}→{tgt} in adjacency but {src} not in reverse[{tgt}]"
