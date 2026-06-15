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


class TestAnalysisCacheTiers:
    """Test L1 -> L2 -> L3 multi-tier cache logic, read-through, and graceful degradation."""

    def test_write_to_all_tiers(self):
        from unittest.mock import MagicMock, patch

        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        mock_redis = MagicMock()
        mock_supabase = MagicMock()

        with (
            patch.object(cache, "_get_redis", return_value=mock_redis),
            patch.object(cache, "_get_supabase", return_value=mock_supabase),
        ):
            cache.set("test_id", {"repo_name": "foo"})

            # L1 check
            assert cache._memory["test_id"] == {"repo_name": "foo"}
            # L2 check (Redis set called)
            mock_redis.set.assert_called_once()
            # L3 check (Supabase upsert called)
            mock_supabase.table.assert_called_once_with("analysis_cache")

    def test_read_through_l2(self):
        import json
        from unittest.mock import MagicMock, patch

        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        mock_redis = MagicMock()
        mock_redis.get.return_value = json.dumps({"repo_name": "redis_data"})
        mock_supabase = MagicMock()

        with (
            patch.object(cache, "_get_redis", return_value=mock_redis),
            patch.object(cache, "_get_supabase", return_value=mock_supabase),
        ):
            result = cache.get("test_id")
            assert result == {"repo_name": "redis_data"}
            # L1 should have been populated
            assert cache._memory["test_id"] == {"repo_name": "redis_data"}
            # Supabase should not be called since L2 hit
            mock_supabase.table.assert_not_called()

    def test_read_through_l3(self):
        from unittest.mock import MagicMock, patch

        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        mock_redis = MagicMock()
        mock_redis.get.return_value = None
        mock_supabase = MagicMock()

        # Mock Supabase response
        mock_response = MagicMock()
        mock_response.data = {"result_json": {"repo_name": "supabase_data"}}
        mock_supabase.table().select().eq().maybe_single().execute.return_value = mock_response

        with (
            patch.object(cache, "_get_redis", return_value=mock_redis),
            patch.object(cache, "_get_supabase", return_value=mock_supabase),
        ):
            result = cache.get("test_id")
            assert result == {"repo_name": "supabase_data"}
            # L1 and L2 should be populated
            assert cache._memory["test_id"] == {"repo_name": "supabase_data"}
            mock_redis.set.assert_called_once()

    def test_graceful_degradation_when_down(self):
        from unittest.mock import patch

        from codekavi.cache import AnalysisCache

        cache = AnalysisCache()
        # Mock connection methods to raise exception or return None
        with (
            patch.object(cache, "_get_redis", return_value=None),
            patch.object(cache, "_get_supabase", return_value=None),
        ):
            # Getting missing or setting data should degrade gracefully and not crash
            assert cache.get("test_id") is None
            cache.set("test_id", {"data": 123})
            assert cache._memory["test_id"] == {"data": 123}
            cache.delete("test_id")
            assert cache.get("test_id") is None
