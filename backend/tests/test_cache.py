"""
test_cache.py — Tests for the 3-tier analysis cache.

Phase 0: Smoke tests (L1 only, no Redis/Supabase needed).
Phase 4: Full coverage (L1→L2→L3, degradation, serialization).
"""



class TestAnalysisCacheL1:
    """Test the in-memory (L1) tier of AnalysisCache."""

    def test_set_and_get(self):
        """Basic set/get on L1 should work."""
        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        test_data = {"repo_name": "test", "files": [1, 2, 3]}

        cache.set("test_repo_id", test_data)
        result = cache.get("test_repo_id")

        assert result is not None
        assert result["repo_name"] == "test"

    def test_get_missing_returns_none(self):
        """Getting a non-existent key should return None."""
        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        assert cache.get("nonexistent") is None

    def test_delete(self):
        """Deleting should remove from L1."""
        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        cache.set("to_delete", {"data": True})
        cache.delete("to_delete")
        assert cache.get("to_delete") is None

    def test_session_path(self):
        """Session path set/get/delete should work."""
        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        cache.set_session_path("repo1", "/tmp/repo1_abc123")
        assert cache.get_session_path("repo1") == "/tmp/repo1_abc123"

        cache.delete_session("repo1")
        assert cache.get_session_path("repo1") is None


class TestMakeSerializable:
    """Test the _make_serializable helper."""

    def test_converts_sets_to_sorted_lists(self):
        """Sets should become sorted lists for JSON compatibility."""
        from codekavi.cache import _make_serializable

        data = {"files": {"c.py", "a.py", "b.py"}}
        result = _make_serializable(data)
        assert result["files"] == ["a.py", "b.py", "c.py"]

    def test_nested_sets(self):
        """Nested sets should be recursively converted."""
        from codekavi.cache import _make_serializable

        data = {"adjacency": {"main.py": {"utils.py", "config.py"}}}
        result = _make_serializable(data)
        assert result["adjacency"]["main.py"] == ["config.py", "utils.py"]

    def test_preserves_non_set_types(self):
        """Non-set types should pass through unchanged."""
        from codekavi.cache import _make_serializable

        data = {"count": 42, "name": "test", "items": [1, 2, 3]}
        result = _make_serializable(data)
        assert result == data
