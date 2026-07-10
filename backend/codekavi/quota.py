"""
quota.py — T4.1 TokenTracker for per-user/per-day usage accounting.

Tracks LLM token usage and cost per user per UTC day with a 24h TTL so
counters auto-expire. Backed by Redis when available — falls back to an
in-process dict for local development and tests.

Public surface:
    tracker = TokenTracker()
    tracker.record(user_id, provider, tokens)            # both prompt and completion
    if not tracker.check_quota(user_id):
        raise HTTPException(429, "quota_exceeded")
    remaining = tracker.get_remaining(user_id)
    cost = tracker.estimate_cost_usd(provider, tokens)

Quotas and pricing are read from ``codekavi.settings.settings``.
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

_REDIS_KEY_PREFIX = "codekavi:quota:"
_QUOTA_TTL_SECONDS = 24 * 60 * 60  # 24h
_GLOBAL_KEY = "global"


class TokenTracker:
    """
    Process-local fallback — actually uses Redis if available, in-memory dict otherwise.

    Usage:
        recorder = TokenTracker()
        recorder.record("user-123", "groq", tokens=4200)
        if not recorder.check_quota("user-123"):
            raise HTTPException(429, "daily quota exceeded")
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._memory: dict[str, int] = defaultdict(int)
        self._memory_global: int = 0
        self._memory_global_providers: dict[str, int] = defaultdict(int)
        self._redis = self._try_connect_redis()

    # ── backend plumbing ──────────────────────────────────────────────

    @staticmethod
    def _try_connect_redis() -> Any:
        """Lazily connect to Redis; return None if unavailable."""
        try:
            import redis

            from codekavi.settings import settings

            client = redis.from_url(settings.redis_url, decode_responses=True)
            client.ping()
            logger.info("TokenTracker connected to Redis")
            return client
        except Exception as e:
            logger.debug(f"TokenTracker using in-memory backend: {e}")
            return None

    def _today_key(self, user_id: str) -> str:
        today = datetime.now(tz=UTC).strftime("%Y-%m-%d")
        return f"{_REDIS_KEY_PREFIX}{today}:{user_id}"

    def _today_global_key(self) -> str:
        today = datetime.now(tz=UTC).strftime("%Y-%m-%d")
        return f"{_REDIS_KEY_PREFIX}{today}:{_GLOBAL_KEY}"

    def _today_global_provider_key(self, provider: str) -> str:
        today = datetime.now(tz=UTC).strftime("%Y-%m-%d")
        return f"{_REDIS_KEY_PREFIX}{today}:{_GLOBAL_KEY}:{provider}"

    # ── public API ────────────────────────────────────────────────────

    def record(self, user_id: str | None, provider: str, tokens: int, direction: str = "total") -> None:
        """
        Record token usage for a user + provider.

        Args:
            user_id:    The authenticated user's id, or None for anonymous.
                        None callers contribute only to the global daily bucket.
            provider:   LLM provider name ("groq", "gemini", ...).
            tokens:     Total tokens consumed (prompt + completion).
            direction:  "prompt" / "completion" / "total". Used by the metrics
                        layer; quota accounting always uses the absolute count.

        Increments the user's bucket, the global token bucket, and the
        global per-provider bucket (needed to compute actual USD spend
        rather than a blended-average estimate). Always succeeds — quota
        tracking is best-effort and never breaks a request.
        """
        if not tokens or tokens <= 0:
            return
        if self._redis is not None:
            try:
                pipe = self._redis.pipeline()
                if user_id:
                    pipe.incrby(self._today_key(user_id), tokens)
                    pipe.expire(self._today_key(user_id), _QUOTA_TTL_SECONDS)
                pipe.incrby(self._today_global_key(), tokens)
                pipe.expire(self._today_global_key(), _QUOTA_TTL_SECONDS)
                pipe.incrby(self._today_global_provider_key(provider), tokens)
                pipe.expire(self._today_global_provider_key(provider), _QUOTA_TTL_SECONDS)
                pipe.execute()
                return
            except Exception as e:
                logger.warning(f"Redis quota record failed, falling back to memory: {e}")
                # fall through to memory

        with self._lock:
            if user_id:
                self._memory[self._today_key(user_id)] += tokens
            self._memory_global += tokens
            self._memory_global_providers[provider] += tokens

    def check_quota(self, user_id: str | None) -> bool:
        """
        Return True if a request for ``user_id`` is allowed (under both
        user and global daily quotas). Always True when enforcement is
        disabled in settings — see ``settings.enforce_token_quota``.
        """
        from codekavi.settings import settings

        if not settings.enforce_token_quota:
            return True

        used = self.get_used(user_id)
        if used > settings.daily_user_token_quota:
            logger.warning(f"User {user_id} exceeded daily token quota: {used} > {settings.daily_user_token_quota}")
            return False

        global_used_usd = self.get_global_used_usd()
        if global_used_usd > settings.global_daily_spend_limit_usd:
            logger.warning(
                f"Global daily spend exceeded: ${global_used_usd:.4f} > ${settings.global_daily_spend_limit_usd:.2f}"
            )
            return False
        return True

    def get_used(self, user_id: str | None) -> int:
        """Return tokens consumed today by ``user_id`` (0 for None)."""
        if not user_id:
            return 0
        if self._redis is not None:
            try:
                val = self._redis.get(self._today_key(user_id))
                if val is None:
                    return 0
                return int(val)
            except Exception:
                pass
        with self._lock:
            return self._memory.get(self._today_key(user_id), 0)

    def get_remaining(self, user_id: str | None) -> int:
        """Tokens remaining today for ``user_id``. Returns 0 for None."""
        from codekavi.settings import settings

        used = self.get_used(user_id)
        if not user_id:
            return 0
        return max(0, settings.daily_user_token_quota - used)

    def get_global_used(self) -> float:
        """Return total tokens (all providers) consumed globally today."""
        if self._redis is not None:
            try:
                val = self._redis.get(self._today_global_key())
                return float(val) if val else 0.0
            except Exception:
                pass
        with self._lock:
            return float(self._memory_global)

    def get_global_used_usd(self) -> float:
        """
        Return actual global spend in USD today, summed per-provider
        (tokens x that provider's per-1k rate) rather than a blended
        average — a blended mean underestimates spend whenever an
        expensive provider carries a disproportionate share of traffic,
        which can keep the hard cap from tripping when it should.
        """
        from codekavi.settings import settings

        total_usd = 0.0
        for provider, per_1k in settings.cost_per_1k_tokens_usd.items():
            tokens = self._get_global_provider_used(provider)
            if tokens > 0:
                total_usd += (tokens / 1000.0) * per_1k
        return total_usd

    def _get_global_provider_used(self, provider: str) -> int:
        """Return tokens consumed globally today by ``provider``."""
        if self._redis is not None:
            try:
                val = self._redis.get(self._today_global_provider_key(provider))
                return int(val) if val else 0
            except Exception:
                pass
        with self._lock:
            return self._memory_global_providers.get(provider, 0)

    def estimate_cost_usd(self, provider: str, tokens: int) -> float:
        """Compute USD cost for ``tokens`` against the provider's pricing tier."""
        from codekavi.settings import settings

        if not tokens:
            return 0.0
        per_1k = settings.cost_per_1k_tokens_usd.get(provider, 0.0)
        return round((tokens / 1000.0) * per_1k, 6)

    # ── test helpers ──────────────────────────────────────────────────

    def reset(self) -> None:
        """Clear all counters — tests only."""
        with self._lock:
            self._memory.clear()
            self._memory_global = 0
            self._memory_global_providers.clear()
        if self._redis is not None:
            try:
                today = datetime.now(tz=UTC).strftime("%Y-%m-%d")
                cursor = 0
                pattern = f"{_REDIS_KEY_PREFIX}{today}:*"
                while True:
                    cursor, keys = self._redis.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        self._redis.delete(*keys)
                    if cursor == 0:
                        break
            except Exception:
                pass


# Process-singleton — matches existing convention for AnalysisCache, providers.
_tracker: TokenTracker | None = None
_tracker_lock = threading.Lock()


def get_token_tracker() -> TokenTracker:
    """Return the process-singleton TokenTracker, lazily creating it on first call."""
    global _tracker
    with _tracker_lock:
        if _tracker is None:
            _tracker = TokenTracker()
        return _tracker
