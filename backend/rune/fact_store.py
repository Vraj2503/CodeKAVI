"""
fact_store.py — per-file facts for the views, kept out of the analysis record (T16).

What a view says about a file: its purpose line and the symbols it defines, each
with its own complexity (T33), and later a written sentence (T34). For React's
~7,000 files that is about 2.3 MB, and it must not ride on the analysis record:
chat loads the whole record on every cache miss (decision P3-2 = B2). The store
holds one entry per file, and a view reads only the files it shows.

Tiers, like AnalysisCache: memory (its own small cache, so facts never crowd the
records out), Redis (one hash per analysis, one field per file, read with HMGET),
and Supabase (table `analysis_file_facts`, one row per file, read with `.in_()`).
Facts are written once per analysis. The Supabase upload runs in the background,
and any failure leaves the views without facts, never an analysis failed.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from cachetools import TTLCache

logger = logging.getLogger(__name__)

FACTS_TABLE = "analysis_file_facts"
MAX_SYMBOLS_PER_FILE = 40
FACTS_TTL_SECONDS = 24 * 60 * 60  # the same as the records' Redis TTL
_REDIS_PREFIX = "codekavi:facts:"
_UPLOAD_BATCH = 500
_READ_BATCH = 100  # paths per `.in_()` query, so the URL stays short
_LEAN_SYMBOL_FIELDS = ("name", "kind", "line", "end_line", "doc", "signature", "complexity")


def shape_file_facts(
    symbols_by_file: dict[str, list[dict[str, Any]]], purposes: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """One entry per file from the pipeline's symbols and purpose lines.

    Symbols keep only what a view shows (no callees). A file with more than
    MAX_SYMBOLS_PER_FILE keeps its most complex ones, in source order, and says
    it was cut (`truncated`).
    """
    files: dict[str, dict[str, Any]] = {}
    for path in sorted(set(symbols_by_file) | set(purposes)):
        symbols = [{key: s.get(key) for key in _LEAN_SYMBOL_FIELDS} for s in symbols_by_file.get(path, [])]
        kept = sorted(symbols, key=lambda s: (-(s.get("complexity") or 0), s.get("line") or 0))[:MAX_SYMBOLS_PER_FILE]
        kept.sort(key=lambda s: s.get("line") or 0)
        files[path] = {**purposes.get(path, {}), "symbols": kept, "truncated": len(symbols) > MAX_SYMBOLS_PER_FILE}
    return files


def facts_repo_id(record: dict | None, repo_id: str) -> str:
    """The analysis whose facts a record uses: its origin when it reused one (T4, T5)."""
    return (record or {}).get("_origin_repo_id") or repo_id


def file_description(facts: dict[str, Any] | None) -> tuple[str | None, str | None]:
    """What a view says a file is for: its written sentence (T34), else its purpose line (T33).

    Returns (text, source), source one of "summary", "doc", "derived", or (None, None).
    """
    if not facts:
        return None, None
    if facts.get("summary"):
        return facts["summary"], "summary"
    return facts.get("purpose"), facts.get("purpose_source")


def top_symbols(facts: dict[str, Any] | None, limit: int) -> list[dict[str, Any]]:
    """A file's most complex functions and methods first, ties in source order."""
    symbols = [s for s in (facts or {}).get("symbols") or [] if s.get("kind") != "class"]
    return sorted(symbols, key=lambda s: (-(s.get("complexity") or 0), s.get("line") or 0))[:limit]


def _is_missing_table(error: Exception) -> bool:
    text = str(error)
    return "PGRST205" in text or "42P01" in text or (FACTS_TABLE in text and "does not exist" in text)


def _in_background(work: Callable[[], None]) -> None:
    threading.Thread(target=work, daemon=True).start()


@dataclass
class _Entry:
    files: dict[str, dict[str, Any]] = field(default_factory=dict)
    complete: bool = False  # written here by put(), so a path it lacks has no facts
    missing: set[str] = field(default_factory=set)  # asked below and not found


class FactStore:
    """Per-file facts by analysis: put once, get the paths a view shows, delete with the record."""

    def __init__(
        self,
        redis_client: Callable[[], Any],
        supabase_client: Callable[[], Any],
        run_in_background: Callable[[Callable[[], None]], None] = _in_background,
    ):
        self._memory: TTLCache = TTLCache(maxsize=48, ttl=FACTS_TTL_SECONDS)
        self._lock = threading.Lock()
        self._redis = redis_client
        self._supabase = supabase_client
        self._run_in_background = run_in_background
        self._table_missing = False  # until migration 003 runs, Supabase is skipped after one try

    # ── Write ──

    def put(self, repo_id: str, files: dict[str, dict[str, Any]]) -> None:
        """Save one analysis's facts: memory and Redis now, Supabase in the background."""
        with self._lock:
            self._memory[repo_id] = _Entry(files=dict(files), complete=True)
        if not files:
            return
        r = self._redis()
        if r is not None:
            try:
                key = _REDIS_PREFIX + repo_id
                pipe = r.pipeline()
                pipe.delete(key)
                pipe.hset(key, mapping={path: json.dumps(facts) for path, facts in files.items()})
                pipe.expire(key, FACTS_TTL_SECONDS)
                pipe.execute()
            except Exception as e:
                logger.warning(f"Saving file facts for {repo_id} to Redis failed: {e}")
        if not self._table_missing:
            self._run_in_background(lambda: self._upload(repo_id, files))

    def _upload(self, repo_id: str, files: dict[str, dict[str, Any]]) -> None:
        sb = self._supabase()
        if sb is None:
            return
        rows = [{"repo_id": repo_id, "path": path, "facts": facts} for path, facts in files.items()]
        try:
            for start in range(0, len(rows), _UPLOAD_BATCH):
                sb.table(FACTS_TABLE).upsert(rows[start : start + _UPLOAD_BATCH]).execute()
        except Exception as e:
            self._log_supabase_failure("Saving", repo_id, e)

    # ── Read ──

    def get(self, repo_id: str, paths: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Facts for the given paths that have any; lower tiers are asked only for what memory lacks."""
        wanted = list(dict.fromkeys(paths))
        with self._lock:
            entry = self._memory.get(repo_id)
            if entry is None:
                entry = self._memory[repo_id] = _Entry()
            found = {path: entry.files[path] for path in wanted if path in entry.files}
            if entry.complete:
                return found
            todo = [path for path in wanted if path not in found and path not in entry.missing]
        if not todo:
            return found

        fetched = self._redis_get(repo_id, todo)
        rest = [path for path in todo if path not in fetched]
        answered = True
        if rest:
            from_supabase = self._supabase_get(repo_id, rest)
            answered = from_supabase is not None
            fetched.update(from_supabase or {})
        with self._lock:
            entry.files.update(fetched)
            if answered:  # a failed read proves nothing about what exists
                entry.missing.update(path for path in todo if path not in fetched)
        found.update(fetched)
        return found

    def _redis_get(self, repo_id: str, paths: list[str]) -> dict[str, dict[str, Any]]:
        r = self._redis()
        if r is None:
            return {}
        try:
            values = r.hmget(_REDIS_PREFIX + repo_id, paths)
        except Exception as e:
            logger.warning(f"Reading file facts for {repo_id} from Redis failed: {e}")
            return {}
        return {path: json.loads(value) for path, value in zip(paths, values, strict=True) if value}

    def _supabase_get(self, repo_id: str, paths: list[str]) -> dict[str, dict[str, Any]] | None:
        sb = self._supabase()
        if sb is None:
            return {}
        if self._table_missing:
            return {}
        found: dict[str, dict[str, Any]] = {}
        try:
            for start in range(0, len(paths), _READ_BATCH):
                response = (
                    sb.table(FACTS_TABLE)
                    .select("path,facts,summary")
                    .eq("repo_id", repo_id)
                    .in_("path", paths[start : start + _READ_BATCH])
                    .execute()
                )
                for row in getattr(response, "data", None) or []:
                    facts = dict(row.get("facts") or {})
                    if row.get("summary"):
                        facts["summary"] = row["summary"]
                    found[row["path"]] = facts
        except Exception as e:
            self._log_supabase_failure("Reading", repo_id, e)
            return None
        return found

    # ── Delete ──

    def delete(self, repo_id: str) -> None:
        """Remove an analysis's facts from every tier (with its record, on /cleanup)."""
        with self._lock:
            self._memory.pop(repo_id, None)
        r = self._redis()
        if r is not None:
            try:
                r.delete(_REDIS_PREFIX + repo_id)
            except Exception as e:
                logger.warning(f"Deleting file facts for {repo_id} from Redis failed: {e}")
        sb = self._supabase()
        if sb is not None and not self._table_missing:
            try:
                sb.table(FACTS_TABLE).delete().eq("repo_id", repo_id).execute()
            except Exception as e:
                self._log_supabase_failure("Deleting", repo_id, e)

    def _log_supabase_failure(self, action: str, repo_id: str, error: Exception) -> None:
        if _is_missing_table(error):
            if not self._table_missing:
                logger.warning(
                    f"Supabase has no {FACTS_TABLE} table yet (backend/supabase_migrations/"
                    f"003_analysis_file_facts.sql): file facts stay in memory and Redis until it is created."
                )
            self._table_missing = True
            return
        logger.warning(f"{action} file facts for {repo_id} in Supabase failed: {error}")
