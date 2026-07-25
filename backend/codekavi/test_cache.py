"""3-tier cache: L1 -> L2 -> L3 read-through with tier promotion on hit,
version-stamp gating, and graceful degradation when Redis/Supabase are unset."""

from unittest.mock import MagicMock

from codekavi.cache import ANALYSIS_VERSION, AnalysisCache
from codekavi.settings import settings


def _result(**extra):
    return {"_analysis_version": ANALYSIS_VERSION, **extra}


def test_l1_hit_returns_without_touching_lower_tiers():
    cache = AnalysisCache()
    cache._memory["repo-1"] = _result(data="l1")
    cache._redis_available = False
    cache._supabase_available = False
    assert cache.get("repo-1") == _result(data="l1")


def test_l2_hit_populates_l1():
    cache = AnalysisCache()
    fake_redis = MagicMock()
    fake_redis.get.return_value = f'{{"_analysis_version": "{ANALYSIS_VERSION}", "data": "l2"}}'
    cache._redis = fake_redis
    cache._redis_available = True
    cache._supabase_available = False

    result = cache.get("repo-2")

    assert result == _result(data="l2")
    assert cache._memory["repo-2"] == _result(data="l2")


def test_l3_hit_populates_l1_and_l2():
    cache = AnalysisCache()
    cache._redis_available = False  # L2 miss, degraded
    fake_supabase = MagicMock()
    query = fake_supabase.table.return_value.select.return_value.eq.return_value.maybe_single.return_value
    query.execute.return_value = MagicMock(data={"result_json": _result(data="l3")})
    cache._supabase = fake_supabase
    cache._supabase_available = True

    result = cache.get("repo-3")

    assert result == _result(data="l3")
    assert cache._memory["repo-3"] == _result(data="l3")


def test_stale_version_is_treated_as_miss():
    cache = AnalysisCache()
    cache._memory["repo-4"] = {"_analysis_version": "stale", "data": "old"}
    cache._redis_available = False
    cache._supabase_available = False
    assert cache.get("repo-4") is None


def test_full_miss_returns_none():
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    assert cache.get("nonexistent") is None


def test_missing_redis_url_disables_l2_gracefully(monkeypatch):
    monkeypatch.setattr(settings, "redis_url", "")
    cache = AnalysisCache()
    assert cache._get_redis() is None
    assert cache._redis_available is False


def test_missing_supabase_creds_disables_l3_gracefully(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_key", "")
    cache = AnalysisCache()
    assert cache._get_supabase() is None
    assert cache._supabase_available is False
