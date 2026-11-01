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
import threading
from typing import Any

from cachetools import LRUCache, TTLCache

from rune.settings import settings

logger = logging.getLogger(__name__)

# Redis TTL for cached analysis results (seconds)
REDIS_TTL_SECONDS = 24 * 60 * 60  # 24 hours

# Redis key prefix
_REDIS_PREFIX = "codekavi:result:"  # keyspace of live cache entries
# T4.4 — Redis key prefix for the cross-user signature index.
_REDIS_SIG_PREFIX = "rune:sig:"

# Bump whenever analyzer/fingerprint/graph-export logic changes in a way
# that alters cached output. A mismatch makes cached results a cache miss,
# forcing transparent re-analysis. Current bump: fix UnboundLocalError in
# analyze route that cached empty (zero-edge) dep graphs on the FULL_UPDATE path.
ANALYSIS_VERSION = "3"

# Writes to one repo's record are serialized by a lock picked from this pool
# (striped by repo_id, so the pool stays fixed-size however many repos pass
# through). Two repos sharing a stripe just take turns.
_WRITE_LOCK_STRIPES = 64


def _make_serializable(obj: Any) -> Any:
    """Recursively convert sets to sorted lists for JSON serialization."""
    if isinstance(obj, set):
        return sorted(obj)
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [_make_serializable(item) for item in obj]
    if hasattr(obj, "model_dump"):
        return _make_serializable(obj.model_dump())
    if hasattr(obj, "dict"):
        return _make_serializable(obj.dict())
    return obj


def _is_current(result: dict) -> bool:
    """A cached result is usable only if it was written by this analysis version."""
    return result.get("_analysis_version") == ANALYSIS_VERSION


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
        # L1: in-memory, capped so it can't outgrow the process
        self._memory: TTLCache = TTLCache(maxsize=256, ttl=REDIS_TTL_SECONDS)
        self._sessions: LRUCache = LRUCache(maxsize=1024)  # repo_id → clone_path

        # T4.4 — cross-user deduplication index (signature → repo_id).
        # ``f"{owner}/{repo}@{commit_sha}"`` is keyed against the repo_id whose
        # analysis produced it. Subsequent callers probing the same commit get
        # the cached result without re-running the pipeline.
        self._signatures: LRUCache = LRUCache(maxsize=4096)

        # L2: Redis (lazy init)
        self._redis = None
        self._redis_available = None  # None = not yet checked

        # L3: Supabase (lazy init)
        self._supabase = None
        self._supabase_available = None

        # T23: every write takes its repo's lock, so an update's
        # read-merge-write can't interleave with another write in this
        # process, and L2/L3 receive one repo's writes in the order L1 did:
        # a slow upload can't land after a newer one and roll the persisted
        # record back.
        self._write_locks = [threading.Lock() for _ in range(_WRITE_LOCK_STRIPES)]

    # ── Redis connection (lazy) ──

    def _get_redis(self):
        """Lazily connect to Redis. Returns client or None."""
        if self._redis_available is False:
            return None
        if self._redis is not None:
            return self._redis

        redis_url = settings.redis_url
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

        supabase_url = settings.supabase_url
        supabase_key = settings.supabase_service_key
        if not supabase_url or not supabase_key:
            logger.info("SUPABASE_URL or SUPABASE_SERVICE_KEY not set — L3 cache disabled")
            self._supabase_available = False
            return None

        try:
            import httpx
            from postgrest.utils import SyncClient
            from supabase import ClientOptions, create_client

            options = ClientOptions(postgrest_client_timeout=10)
            self._supabase = create_client(supabase_url, supabase_key, options=options)

            # Explicitly configure HTTP connection pooling limits for Supabase under high concurrency
            limits = httpx.Limits(max_keepalive_connections=50, max_connections=100)
            old_session = self._supabase.postgrest.session
            self._supabase.postgrest.session = SyncClient(
                base_url=old_session.base_url, headers=old_session.headers, timeout=old_session.timeout, limits=limits
            )

            self._supabase_available = True
            logger.info("Supabase L3 cache connected with connection pooling")
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
        A version-stamp mismatch (result predates the current analyzer/graph
        logic) is treated as a miss so it falls through to re-analysis.
        Returns the result dict or None.
        """
        # L1: in-memory
        result = self._memory.get(repo_id)
        if result and _is_current(result):
            return result

        # L2: Redis
        result = self._redis_get(repo_id)
        if result and _is_current(result):
            self._memory[repo_id] = result  # populate L1
            return result

        # L3: Supabase
        result = self._supabase_get(repo_id)
        if result and _is_current(result):
            self._memory[repo_id] = result  # populate L1
            self._redis_set(repo_id, result)  # populate L2
            return result

        return None

    def set(self, repo_id: str, result: dict) -> None:
        """Write a whole record to all 3 tiers.

        For a record built from scratch. A writer that loaded the record and
        worked on it for a while wants ``update``: writing back what it
        loaded would erase whatever changed in between.
        """
        with self._write_lock(repo_id):
            self._write(repo_id, result)

    def update(self, repo_id: str, fields: dict[str, Any]) -> bool:
        """Replace only ``fields`` on the record as it is now; False if there is none.

        The LLM overlays and the indexing outcome each load the record, spend
        seconds (indexing: minutes) on their own work, then save one key.
        Saving the copy they loaded used to erase what another writer saved
        meanwhile — a stale "pending" over "complete", so chat said "still
        being indexed" for a fully indexed repo (P4). This re-reads the
        record under the repo's write lock and replaces only the given keys,
        so updates to different keys all survive. The record a reader is
        holding is never mutated.
        """
        with self._write_lock(repo_id):
            current = self.get(repo_id)
            if current is None:
                return False
            self._write(repo_id, {**current, **fields})
            return True

    def delete(self, repo_id: str) -> None:
        """Evict from all 3 tiers."""
        with self._write_lock(repo_id):
            self._memory.pop(repo_id, None)
            self._redis_delete(repo_id)
            self._supabase_delete(repo_id)

    def _write_lock(self, repo_id: str) -> threading.Lock:
        return self._write_locks[hash(repo_id) % _WRITE_LOCK_STRIPES]

    def _write(self, repo_id: str, result: dict) -> None:
        """Write to all 3 tiers. Callers hold the repo's write lock."""
        serializable = _make_serializable(result)
        serializable["_analysis_version"] = ANALYSIS_VERSION

        # L1
        self._memory[repo_id] = serializable

        # L2 & L3 (serialize ONCE)
        json_str = json.dumps(serializable)
        self._redis_set_raw(repo_id, json_str)
        self._supabase_set_raw(repo_id, json_str, result.get("repo_name", ""), result.get("owner", ""))

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

    def _redis_set_raw(self, repo_id: str, json_str: str) -> None:
        r = self._get_redis()
        if not r:
            return
        try:
            key = f"{_REDIS_PREFIX}{repo_id}"
            r.set(key, json_str, ex=REDIS_TTL_SECONDS)
        except Exception as e:
            logger.warning(f"Redis SET RAW failed for {repo_id}: {e}")

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
            sb.table("analysis_cache").upsert(
                {
                    "repo_id": repo_id,
                    "repo_name": repo_name,
                    "owner": owner,
                    "result_json": result,
                    "updated_at": "now()",
                }
            ).execute()
        except Exception as e:
            logger.warning(f"Supabase SET failed for {repo_id}: {e}")

    def _supabase_set_raw(self, repo_id: str, json_str: str, repo_name: str, owner: str) -> None:
        sb = self._get_supabase()
        if not sb:
            return
        try:
            # Use raw HTTP via httpx to avoid json.loads and supabase-py's internal json.dumps,
            # saving significant CPU on 10MB+ payloads.
            import httpx

            url = f"{settings.supabase_url}/rest/v1/analysis_cache"
            headers = {
                "apikey": settings.supabase_service_key,
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            }

            # Construct the payload string manually to embed the raw json_str
            import json

            payload_str = (
                f'{{"repo_id": {json.dumps(repo_id)}, '
                f'"repo_name": {json.dumps(repo_name)}, '
                f'"owner": {json.dumps(owner)}, '
                f'"result_json": {json_str}}}'
            )

            # The body is the whole analysis, often several MB. A flat 10s
            # timeout failed the upload on a slow link ("The write operation
            # timed out"), leaving the result, and its index_status, only in
            # this process's memory. Connect fast; give the upload and the
            # server's processing of a large JSON body room.
            timeout = httpx.Timeout(10.0, write=120.0, read=60.0)
            with httpx.Client(timeout=timeout) as client:
                response = client.post(url, headers=headers, content=payload_str)
                response.raise_for_status()
        except Exception as e:
            logger.warning(f"Supabase SET RAW failed for {repo_id}: {e}")

    def _supabase_get(self, repo_id: str) -> dict | None:
        # L-08: a genuine query error and a real cache miss both return None
        # here. Accepted trade-off — every caller already treats a L3 miss as
        # "fall through to re-analysis", so a distinct exception type for the
        # error case wouldn't change control flow, only add a rarely-useful
        # distinction. The warning log below is the observability signal.
        sb = self._get_supabase()
        if not sb:
            return None
        try:
            response = sb.table("analysis_cache").select("result_json").eq("repo_id", repo_id).maybe_single().execute()
            if response and getattr(response, "data", None):
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

    # ─────────────────────────────────────────────────────────────────
    # T4.4 — signature-based deduplication (cross-user cache sharing)
    # ─────────────────────────────────────────────────────────────────

    def resolve_signature(self, signature: str) -> tuple[str, dict] | None:
        """
        Return ``(repo_id, result)`` for the analysis indexed under
        ``signature`` (i.e. an ``owner/name@sha`` string), or ``None`` if no
        prior user analyzed that exact commit.

        Order: L1 in-memory → L2 Redis → L3 Supabase, where each analysis
        records its own ``repo_signature`` (read-only — we don't promote
        signature hits into other L1 entries since the ``repo_id`` linkage is
        the canonical index). Without L3 the index was lost on every restart,
        and with Redis after a day, and an unchanged commit was analyzed and
        embedded all over again.
        """
        repo_id = self._signatures.get(signature)
        if not repo_id:
            repo_id = self._redis_get_signature(signature) or self._supabase_find_signature(signature)
            if not repo_id:
                return None
            self._signatures[signature] = repo_id

        result = self.get(repo_id)
        return (repo_id, result) if result else None

    def _supabase_find_signature(self, signature: str) -> str | None:
        """repo_id of the newest saved analysis that recorded ``signature``.

        Also filters on the plain ``owner``/``repo_name`` columns, so Postgres
        only unpacks the (multi-MB) ``result_json`` of that repo's analyses.
        """
        sb = self._get_supabase()
        prefix, _, sha = signature.rpartition("@")
        owner, _, repo_name = prefix.partition("/")
        if not sb or not (owner and repo_name and sha):
            return None
        try:
            response = (
                sb.table("analysis_cache")
                .select("repo_id")
                .eq("owner", owner)
                .eq("repo_name", repo_name)
                .eq("result_json->>repo_signature", signature)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = getattr(response, "data", None) or []
            return rows[0]["repo_id"] if rows else None
        except Exception as e:
            logger.warning(f"Supabase signature lookup failed for {signature}: {e}")
            return None

    # ── What the tiers hold (for vector_reclaim) ──

    def memory_records(self) -> list[tuple[str, dict]]:
        """A snapshot of the L1 records, including any whose L3 save failed."""
        for _ in range(3):
            try:
                return list(self._memory.items())
            except RuntimeError:  # resized by another thread mid-iteration
                continue
        return list(self._memory.items())

    def redis_record_ids(self) -> frozenset[str] | None:
        """repo_ids with a record in Redis: empty without Redis, None if it's configured but unreachable.

        (frozenset because inside this class ``set`` names the method above.)
        """
        if not settings.redis_url:
            return frozenset()
        r = self._get_redis()
        if r is None:
            return None
        return frozenset(key.removeprefix(_REDIS_PREFIX) for key in r.scan_iter(match=f"{_REDIS_PREFIX}*", count=1000))

    def supabase_client(self) -> Any:
        """The L3 client, or None when Supabase isn't configured or reachable."""
        return self._get_supabase()

    def register_signature(self, signature: str, repo_id: str) -> None:
        """
        Index ``signature`` against ``repo_id`` so subsequent callers using
        the same signature can find the analysis result.

        Best-effort: in-memory always succeeds, Redis is fire-and-forget.
        """
        if not signature or not repo_id:
            return
        self._signatures[signature] = repo_id
        if self._redis is not None:
            try:
                key = f"{_REDIS_SIG_PREFIX}{signature}"
                self._redis.set(key, repo_id, ex=REDIS_TTL_SECONDS)
            except Exception as e:
                logger.warning(f"Redis signature SET failed: {e}")

    def _redis_get_signature(self, signature: str) -> str | None:
        if self._redis is None:
            return None
        try:
            return self._redis.get(f"{_REDIS_SIG_PREFIX}{signature}")
        except Exception as e:
            logger.warning(f"Redis signature GET failed: {e}")
            return None

    def _fork_of_repo_id(self, repo_id: str) -> str | None:
        """Reverse-lookup which signature indexes a given repo_id (nullable)."""
        for sig, rid in self._signatures.items():
            if rid == repo_id:
                return sig
        return None


# AnalysisCache class is instantiated on startup and stored on app.state
