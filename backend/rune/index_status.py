"""
index_status.py — whether a repo's code actually made it into the vector index.

Indexing runs as a background task after the analysis response has been sent,
so a failed or unfinished index used to be invisible: chat simply found nothing
to search. The analyze routes stamp ``index_status`` on the cached analysis
result when they schedule the job, and the job overwrites it with its outcome:

    route schedules indexing ──▶ pending ──┬──▶ complete     every chunk persisted
                                           ├──▶ partial      some chunks lost
                                           ├──▶ failed       nothing persisted, or it could not start
                                           ├──▶ empty        no indexable text in the repo
                                           └──▶ interrupted  task cancelled (graceful shutdown)
    indexing not configured ─────────────────▶ not_configured

A hard-killed process can't write anything, so it leaves ``pending`` behind
with a stale ``updated_at``.

A deduplicated analysis has no vectors of its own. Its ``vector_repo_id``
points at the analysis whose vectors it shares, and its status is read there.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from rune.utils import run_sync

logger = logging.getLogger(__name__)

PENDING = "pending"
COMPLETE = "complete"
PARTIAL = "partial"
FAILED = "failed"
EMPTY = "empty"
INTERRUPTED = "interrupted"
NOT_CONFIGURED = "not_configured"


@dataclass(frozen=True)
class IndexOutcome:
    """What one indexing run achieved."""

    attempted: int = 0
    inserted: int = 0
    error: str | None = None  # short reason code when indexing could not run at all


def make_status(
    status: str,
    *,
    attempted: int | None = None,
    inserted: int | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"status": status, "updated_at": datetime.now(UTC).isoformat(timespec="seconds")}
    if attempted is not None:
        record["chunks_attempted"] = attempted
    if inserted is not None:
        record["chunks_inserted"] = inserted
    if reason:
        record["reason"] = reason
    return record


def status_from_outcome(outcome: IndexOutcome) -> dict[str, Any]:
    if outcome.error or (outcome.attempted and not outcome.inserted):
        status = FAILED
    elif not outcome.attempted:
        status = EMPTY
    elif outcome.inserted < outcome.attempted:
        status = PARTIAL
    else:
        status = COMPLETE
    return make_status(status, attempted=outcome.attempted, inserted=outcome.inserted, reason=outcome.error)


def vector_repo_id(result: dict[str, Any] | None, repo_id: str) -> str:
    """The repo_id whose vectors hold this analysis's code."""
    return (result or {}).get("vector_repo_id") or repo_id


async def resolve_index_status(cache: Any, result: dict[str, Any] | None, repo_id: str) -> dict[str, Any] | None:
    """Index status for ``repo_id``, read from whichever analysis owns its vectors."""
    owner = vector_repo_id(result, repo_id)
    if owner != repo_id:
        result = await run_sync(cache.get, owner)
    return (result or {}).get("index_status")


async def record_index_status(cache: Any, repo_id: str, status: dict[str, Any]) -> None:
    """Best-effort: attach ``status`` to the cached analysis result for ``repo_id``."""
    try:
        result = await run_sync(cache.get, repo_id)
        if not result:
            logger.warning(
                f"Index status '{status['status']}' for {repo_id} not recorded: no cached analysis to attach it to"
            )
            return
        # Copy rather than mutate: the L1 entry is shared with concurrent readers.
        await run_sync(cache.set, repo_id, {**result, "index_status": status})
        logger.info(f"Recorded index status '{status['status']}' for {repo_id}")
    except Exception as e:
        logger.warning(f"Failed to record index status '{status['status']}' for {repo_id}: {e}")


def _elapsed(updated_at: Any) -> str | None:
    try:
        seconds = (datetime.now(UTC) - datetime.fromisoformat(updated_at)).total_seconds()
    except (TypeError, ValueError):  # missing, malformed, or timezone-naive
        return None
    minutes = max(0, int(seconds)) // 60
    if minutes < 2:
        return "a minute"
    if minutes < 120:
        return f"{minutes} minutes"
    if minutes < 48 * 60:
        return f"{minutes // 60} hours"
    return f"{minutes // (24 * 60)} days"


def chat_unavailable_message(status: dict[str, Any] | None) -> str:
    """What chat tells the user when the vector search came back empty."""
    status = status or {}
    state = status.get("status")
    if state == PENDING:
        elapsed = _elapsed(status.get("updated_at"))
        since = f" (started {elapsed} ago)" if elapsed else ""
        return (
            f"This repository is still being indexed{since}, so there's no code to search yet. "
            "If it doesn't finish, re-analyze the repository."
        )
    if state == COMPLETE:
        return "No relevant code context found for this question."
    if state == PARTIAL:
        return (
            f"No relevant code context found. Only {status.get('chunks_inserted', 0)} of "
            f"{status.get('chunks_attempted', 0)} code chunks were indexed, so part of this "
            "repository isn't searchable. Re-analyze it to retry."
        )
    if state == FAILED:
        return "Indexing failed for this repository, so there's no code to search. Re-analyze it to try again."
    if state == EMPTY:
        return "This repository has no indexable source files, so there's no code to search."
    if state == INTERRUPTED:
        return (
            "Indexing was interrupted before it finished, so there's no code to search yet. "
            "Re-analyze the repository to try again."
        )
    if state == NOT_CONFIGURED:
        return "Code search isn't configured on this server, so chat can't look up this repository's code."
    return "No relevant code context found. Ensure the repository was fully indexed."
