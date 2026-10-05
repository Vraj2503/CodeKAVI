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
from dataclasses import dataclass, field
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
    # Excluded from equality so Phase-0 tests comparing counts keep their
    # useful small assertions while callers can still persist this metadata.
    embedding_identity: str | None = field(default=None, compare=False)
    embedding_seconds: float = field(default=0.0, compare=False)
    insert_seconds: float = field(default=0.0, compare=False)
    fallback_from: str | None = field(default=None, compare=False)
    document_prefix: str = field(default="", compare=False)


def make_status(
    status: str,
    *,
    attempted: int | None = None,
    inserted: int | None = None,
    reason: str | None = None,
    embedding_identity: str | None = None,
    embedding_seconds: float | None = None,
    insert_seconds: float | None = None,
    fallback_from: str | None = None,
    document_prefix: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"status": status, "updated_at": datetime.now(UTC).isoformat(timespec="seconds")}
    if attempted is not None:
        record["chunks_attempted"] = attempted
    if inserted is not None:
        record["chunks_inserted"] = inserted
    if reason:
        record["reason"] = reason
    if embedding_identity:
        record["embedding_identity"] = embedding_identity
    if embedding_seconds is not None:
        record["embedding_seconds"] = round(embedding_seconds, 3)
    if insert_seconds is not None:
        record["insert_seconds"] = round(insert_seconds, 3)
    if fallback_from:
        record["fallback_from"] = fallback_from
    if document_prefix:
        record["document_prefix"] = document_prefix
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
    return make_status(
        status,
        attempted=outcome.attempted,
        inserted=outcome.inserted,
        reason=outcome.error,
        embedding_identity=outcome.embedding_identity,
        embedding_seconds=outcome.embedding_seconds if outcome.embedding_identity else None,
        insert_seconds=outcome.insert_seconds if outcome.embedding_identity else None,
        fallback_from=outcome.fallback_from,
        document_prefix=outcome.document_prefix if outcome.document_prefix else None,
    )


def vector_repo_id(result: dict[str, Any] | None, repo_id: str) -> str:
    """The repo_id whose vectors hold this analysis's code."""
    return (result or {}).get("vector_repo_id") or repo_id


async def resolve_index_status(cache: Any, result: dict[str, Any] | None, repo_id: str) -> dict[str, Any] | None:
    """Index status for ``repo_id``, read from whichever analysis owns its vectors."""
    owner = vector_repo_id(result, repo_id)
    if owner != repo_id:
        result = await run_sync(cache.get, owner)
    return (result or {}).get("index_status")


async def resolve_embedding_identity(cache: Any, result: dict[str, Any] | None, repo_id: str) -> str:
    """Embedding space for the vector owner; old status records mean Cloudflare."""
    status = await resolve_index_status(cache, result, repo_id)
    return (status or {}).get("embedding_identity") or "cloudflare"


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


def chat_embedding_unavailable_message(identity: str, reason: str = "") -> str:
    """Explain a provider mismatch/outage rather than pretending a search was empty."""
    if reason == "local_document_prefix_mismatch":
        return (
            f"The document prefix used to index this repository does not match the current configuration ({identity}). "
            "Re-analyze the repository or restore LOCAL_EMBEDDING_DOCUMENT_PREFIX."
        )
    if reason == "local_tokenizer_unavailable":
        return (
            f"The tokenizer for local embedding model ({identity}) is unavailable. "
            "Download it or re-analyze the repository with a configured provider."
        )
    if identity == "cloudflare":
        return "The Cloudflare embedding service that indexed this repository is unavailable or not configured."
    return (
        f"The local embedding model ({identity}) that indexed this repository is unavailable or its "
        "configuration changed. Start that model again or re-analyze the repository with a configured provider."
    )


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
