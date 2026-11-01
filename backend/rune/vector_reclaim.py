"""
vector_reclaim.py — delete vector sets nothing can reach any more (T5).

Every analysis embeds its repo under its own random repo_id, so vectors are
only ever added, never replaced. A set stays reachable while something still
names its repo_id:

  - a saved analysis record, in any cache tier and of any version (its own vectors);
  - another record's ``vector_repo_id`` (a deduplicated analysis borrowing them);
  - a session row (an entry in someone's "Recent analyses" list).

A set that nothing names can't be opened by anyone. On 2026-11-01 that was 36%
of the collection, mostly analyses whose record never reached Supabase.

Fails safe on Supabase, the persistent tier: if it can't be read, nothing is
deleted, because "could not read" must never look like "unreferenced". A set
that grows during the settle wait, or gains a reference meanwhile, is kept,
since an index may still be writing it.

Redis is the exception. Configured-but-unreachable usually means it simply
isn't running (the dev setup), and then it holds no records. The one thing that
could be lost: an analysis whose Supabase save failed, held only in Redis,
while Redis is down here and back within its 24 h expiry. That is logged.
"""

import asyncio
import logging
from collections import Counter
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

from rune.cache import AnalysisCache
from rune.vectorstore import _validate_repo_id

logger = logging.getLogger(__name__)

SETTLE_SECONDS = 60.0
_PAGE_SIZE = 1000  # PostgREST returns at most this many rows per request by default
_DELETE_BATCH = 50


class ReferencesUnreadableError(RuntimeError):
    """A source of references couldn't be read, so nothing may be deleted."""


@dataclass
class ReclaimReport:
    sets_found: int = 0
    sets_deleted: int = 0
    vectors_deleted: int = 0
    kept_changing: int = 0  # grew, shrank or gained a reference during the settle wait
    kept_unsafe_id: int = 0  # repo_id not in the app's own format; never put in an expression
    aborted: str | None = None


def _paged(query: Callable[[], Any], page_size: int = _PAGE_SIZE) -> Iterator[dict]:
    """Every row of a PostgREST query, a page at a time. ``query`` builds a fresh, ordered query."""
    start = 0
    while True:
        rows = query().range(start, start + page_size - 1).execute().data or []
        yield from rows
        if len(rows) < page_size:
            return
        start += page_size


def referenced_repo_ids(cache: AnalysisCache, page_size: int = _PAGE_SIZE) -> set[str]:
    """Every repo_id whose vectors something can still reach. Raises ReferencesUnreadableError."""
    refs: set[str] = set()

    # L1: includes records whose save to Supabase failed.
    for repo_id, record in cache.memory_records():
        refs.add(repo_id)
        if isinstance(record, dict) and record.get("vector_repo_id"):
            refs.add(record["vector_repo_id"])

    # L2: a record here and nowhere else is one whose Supabase save failed.
    # Its own vectors are protected; a pointer inside it is not read (each
    # record is several MB), and its target normally has a record of its own.
    redis_ids = cache.redis_record_ids()
    if redis_ids is None:
        logger.warning(
            "Redis is configured but unreachable: reading it as holding no records "
            "(an analysis saved only to Redis would lose its vectors)"
        )
    else:
        refs |= redis_ids

    sb = cache.supabase_client()
    if sb is None:
        raise ReferencesUnreadableError("Supabase is not configured or unreachable")
    try:
        records = _paged(
            lambda: (
                sb.table("analysis_cache")
                .select("repo_id,vector_repo_id:result_json->>vector_repo_id")
                .order("repo_id")
            ),
            page_size,
        )
        for row in records:
            refs.add(row["repo_id"])
            if row.get("vector_repo_id"):
                refs.add(row["vector_repo_id"])
        for row in _paged(lambda: sb.table("sessions").select("repo_id").order("id"), page_size):
            if row.get("repo_id"):
                refs.add(row["repo_id"])
    except Exception as e:
        raise ReferencesUnreadableError(f"Supabase read failed: {e}") from e
    return refs


def vector_set_sizes(collection: Any) -> Counter:
    """repo_id -> number of vectors, over the whole collection."""
    sizes: Counter = Counter()
    iterator = collection.query_iterator(batch_size=4000, expr="repo_id != ''", output_fields=["repo_id"])
    try:
        while batch := iterator.next():
            sizes.update(row["repo_id"] for row in batch)
    finally:
        iterator.close()
    return sizes


def _count(collection: Any, repo_id: str) -> int:
    rows = collection.query(expr=f"repo_id == '{repo_id}'", output_fields=["count(*)"])
    return int(rows[0]["count(*)"]) if rows else 0


def _delete(collection: Any, repo_ids: list[str]) -> None:
    for i in range(0, len(repo_ids), _DELETE_BATCH):
        batch = repo_ids[i : i + _DELETE_BATCH]
        collection.delete(expr="repo_id in [" + ", ".join(f"'{r}'" for r in batch) + "]")


async def reclaim_orphan_vectors(
    cache: AnalysisCache, collection: Any, settle_seconds: float = SETTLE_SECONDS
) -> ReclaimReport:
    """Delete every vector set nothing references. Never raises; the report says what happened."""
    report = ReclaimReport()
    try:
        referenced = await asyncio.to_thread(referenced_repo_ids, cache)
        if not referenced:
            # Supabase keeps records indefinitely; an empty read with vectors present is suspect.
            report.aborted = "no references found at all"
            return report

        sizes = await asyncio.to_thread(vector_set_sizes, collection)
        report.sets_found = len(sizes)
        candidates: dict[str, int] = {}
        for repo_id, size in sizes.items():
            if repo_id in referenced:
                continue
            try:
                candidates[_validate_repo_id(repo_id)] = size
            except ValueError:
                report.kept_unsafe_id += 1
        if not candidates:
            return report

        # An index can't start on a repo with no record (the record is saved
        # first), but wait anyway, then re-read: a set still being written, or
        # one whose analysis was saved meanwhile, is kept.
        await asyncio.sleep(settle_seconds)
        referenced = await asyncio.to_thread(referenced_repo_ids, cache)
        doomed: list[str] = []
        for repo_id, size in candidates.items():
            if repo_id in referenced or await asyncio.to_thread(_count, collection, repo_id) != size:
                report.kept_changing += 1
            else:
                doomed.append(repo_id)

        await asyncio.to_thread(_delete, collection, doomed)
        report.sets_deleted = len(doomed)
        report.vectors_deleted = sum(candidates[r] for r in doomed)
        return report
    except ReferencesUnreadableError as e:
        report.aborted = str(e)
        return report
    except Exception as e:
        logger.exception("Orphan vector reclamation failed")
        report.aborted = f"failed: {e}"
        return report


async def reclaim_orphan_vectors_at_startup(cache: AnalysisCache) -> ReclaimReport:
    """Startup entry point: connect to Zilliz, reclaim, and log what happened."""
    from rune.vectorstore import zilliz_client

    try:
        collection = await asyncio.to_thread(zilliz_client.setup_collection)
        await asyncio.to_thread(collection.load)  # queries need the collection loaded
    except Exception as e:
        logger.warning(f"Orphan vector reclamation skipped: Zilliz unavailable ({e})")
        return ReclaimReport(aborted=f"zilliz unavailable: {e}")

    report = await reclaim_orphan_vectors(cache, collection)
    if report.aborted:
        logger.warning(f"Orphan vector reclamation deleted nothing: {report.aborted}")
    else:
        logger.info(
            f"Orphan vector reclamation: deleted {report.sets_deleted} of {report.sets_found} vector sets "
            f"({report.vectors_deleted} vectors); kept {report.kept_changing} that changed while it ran"
            + (f" and {report.kept_unsafe_id} with unexpected ids" if report.kept_unsafe_id else "")
        )
    return report
