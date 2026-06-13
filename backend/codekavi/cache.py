"""
cache.py — 3-tier analysis result cache.

Tier 1 (L1): In-memory dict — fastest, current process only.
Tier 2 (L2): Redis — survives backend restarts, TTL-based eviction.
Tier 3 (L3): Supabase analysis_cache table — persistent, survives everything.

On a cache hit at any tier, lower tiers are populated automatically
so subsequent reads are faster.
"""

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Redis TTL for cached analysis results (seconds)
REDIS_TTL_SECONDS = 24 * 60 * 60  # 24 hours

# Redis key prefix
_REDIS_PREFIX = "codekavi:result:"


def _make_serializable(obj: Any) -> Any:
    """Recursively convert sets to sorted lists for JSON serialization."""
    if isinstance(obj, set):
        return sorted(obj)
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_make_serializable(item) for item in obj]
    return obj


class AnalysisCache:
    """
    3-tier cache for analysis results.

    Usage:
        cache = AnalysisCache()
        cache.set(repo_id, result_dict)
        result = cache.get(repo_id)   # walks L1 → L2 → L3
        cache.delete(repo_id)
    """

    def __init__(self):
        # L1: in-memory
        self._memory: dict[str, dict] = {}
        self._sessions: dict[str, str] = {}  # repo_id → clone_path

        # L2: Redis (lazy init)
        self._redis = None
        self._redis_available = None  # None = not yet checked

        # L3: Supabase (lazy init)
        self._supabase = None
        self._supabase_available = None

    # ── Redis connection (lazy) ──

    def _get_redis(self):
        """Lazily connect to Redis. Returns client or None."""
        if self._redis_available is False:
            return None
        if self._redis is not None:
            return self._redis

        redis_url = os.environ.get("REDIS_URL", "")
        if not redis_url:
            logger.info("REDIS_URL not set — L2 cache disabled")
            self._redis_available = False
            return None

        try:
            import redis
            self._redis = redis.from_url(redis_url, decode_responses=True)
            self._redis.ping()
            self._redis_available = True
            logger.info("Redis L2 cache connected")
            return self._redis
        except Exception as e:
            logger.warning(f"Redis connection failed — L2 cache disabled: {e}")
            self._redis_available = False
            return None

    # ── Supabase connection (lazy) ──

    def _get_supabase(self):
        """Lazily connect to Supabase. Returns client or None."""
        if self._supabase_available is False:
            return None
        if self._supabase is not None:
            return self._supabase

        supabase_url = os.environ.get("SUPABASE_URL", "")
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
        if not supabase_url or not supabase_key:
            logger.info(
                "SUPABASE_URL or SUPABASE_SERVICE_KEY not set — L3 cache disabled"
            )
            self._supabase_available = False
            return None

        try:
            from supabase import create_client
            self._supabase = create_client(supabase_url, supabase_key)
            self._supabase_available = True
            logger.info("Supabase L3 cache connected")
            return self._supabase
        except Exception as e:
            logger.warning(f"Supabase connection failed — L3 cache disabled: {e}")
            self._supabase_available = False
            return None

    # ── Public API ──

    def get(self, repo_id: str) -> dict | None:
        """
        Walk the cache chain: L1 → L2 → L3.
        On a hit at a higher tier, populate lower tiers.
        Returns the result dict or None.
        """
        # L1: in-memory
        result = self._memory.get(repo_id)
        if result:
            return result

        # L2: Redis
        result = self._redis_get(repo_id)
        if result:
            self._memory[repo_id] = result  # populate L1
            return result

        # L3: Supabase
        result = self._supabase_get(repo_id)
        if result:
            self._memory[repo_id] = result  # populate L1
            self._redis_set(repo_id, result)  # populate L2
            return result

        return None

    def set(self, repo_id: str, result: dict) -> None:
        """Write to all 3 tiers."""
        serializable = _make_serializable(result)

        # L1
        self._memory[repo_id] = serializable

        # L2
        self._redis_set(repo_id, serializable)

        # L3
        self._supabase_set(repo_id, serializable)

    def delete(self, repo_id: str) -> None:
        """Evict from all 3 tiers."""
        self._memory.pop(repo_id, None)
        self._redis_delete(repo_id)
        self._supabase_delete(repo_id)

    # ── Session path tracking (replaces active_sessions dict) ──

    def get_session_path(self, repo_id: str) -> str | None:
        """Get the clone path for a repo_id."""
        return self._sessions.get(repo_id)

    def set_session_path(self, repo_id: str, clone_path: str) -> None:
        """Store the clone path for a repo_id."""
        self._sessions[repo_id] = clone_path

    def delete_session(self, repo_id: str) -> None:
        """Remove session path."""
        self._sessions.pop(repo_id, None)

    # ── L2: Redis operations ──

    def _redis_set(self, repo_id: str, result: dict) -> None:
        r = self._get_redis()
        if not r:
            return
        try:
            key = f"{_REDIS_PREFIX}{repo_id}"
            r.set(key, json.dumps(result), ex=REDIS_TTL_SECONDS)
        except Exception as e:
            logger.warning(f"Redis SET failed for {repo_id}: {e}")

    def _redis_get(self, repo_id: str) -> dict | None:
        r = self._get_redis()
        if not r:
            return None
        try:
            key = f"{_REDIS_PREFIX}{repo_id}"
            data = r.get(key)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.warning(f"Redis GET failed for {repo_id}: {e}")
        return None

    def _redis_delete(self, repo_id: str) -> None:
        r = self._get_redis()
        if not r:
            return
        try:
            key = f"{_REDIS_PREFIX}{repo_id}"
            r.delete(key)
        except Exception as e:
            logger.warning(f"Redis DELETE failed for {repo_id}: {e}")

    # ── L3: Supabase operations ──

    def _supabase_set(self, repo_id: str, result: dict) -> None:
        sb = self._get_supabase()
        if not sb:
            return
        try:
            repo_name = result.get("repo_name", "")
            owner = result.get("owner", "")
            sb.table("analysis_cache").upsert({
                "repo_id": repo_id,
                "repo_name": repo_name,
                "owner": owner,
                "result_json": result,
                "updated_at": "now()",
            }).execute()
        except Exception as e:
            logger.warning(f"Supabase SET failed for {repo_id}: {e}")

    def _supabase_get(self, repo_id: str) -> dict | None:
        sb = self._get_supabase()
        if not sb:
            return None
        try:
            response = (
                sb.table("analysis_cache")
                .select("result_json")
                .eq("repo_id", repo_id)
                .maybe_single()
                .execute()
            )
            if response.data:
                return response.data["result_json"]
        except Exception as e:
            logger.warning(f"Supabase GET failed for {repo_id}: {e}")
        return None

    def _supabase_delete(self, repo_id: str) -> None:
        sb = self._get_supabase()
        if not sb:
            return
        try:
            sb.table("analysis_cache").delete().eq("repo_id", repo_id).execute()
        except Exception as e:
            logger.warning(f"Supabase DELETE failed for {repo_id}: {e}")


# AnalysisCache class is instantiated on startup and stored on app.state

