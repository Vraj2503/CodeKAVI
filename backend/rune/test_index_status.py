"""Index status: outcome classification, vector ownership, recording, and the
message chat shows when its vector search comes back empty."""

import logging
from datetime import UTC, datetime, timedelta

import pytest

from rune.index_status import (
    IndexOutcome,
    chat_unavailable_message,
    make_status,
    record_index_status,
    resolve_index_status,
    status_from_outcome,
    vector_repo_id,
)


class FakeCache:
    def __init__(self, results=None, fail_on_set=False):
        self.results = dict(results or {})
        self.sets = []
        self.fail_on_set = fail_on_set

    def get(self, repo_id):
        return self.results.get(repo_id)

    def set(self, repo_id, result):
        if self.fail_on_set:
            raise RuntimeError("redis down")
        self.sets.append((repo_id, result))
        self.results[repo_id] = result


# ── Classifying an outcome ──


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (IndexOutcome(attempted=40, inserted=40), "complete"),
        (IndexOutcome(attempted=40, inserted=25), "partial"),
        (IndexOutcome(attempted=40, inserted=0), "failed"),
        (IndexOutcome(attempted=0, inserted=0), "empty"),
        (IndexOutcome(error="vector_store_unavailable"), "failed"),
    ],
)
def test_an_outcome_maps_to_the_status_the_user_needs(outcome, expected):
    status = status_from_outcome(outcome)

    assert status["status"] == expected
    assert (status["chunks_attempted"], status["chunks_inserted"]) == (outcome.attempted, outcome.inserted)
    assert datetime.fromisoformat(status["updated_at"]).tzinfo is not None


def test_a_failure_to_start_keeps_its_reason():
    status = status_from_outcome(IndexOutcome(error="embedding_not_configured"))

    assert status["reason"] == "embedding_not_configured"


def test_a_plain_status_carries_no_counts():
    assert set(make_status("pending")) == {"status", "updated_at"}


# ── Whose vectors ──


def test_an_analysis_searches_its_own_vectors_unless_it_points_elsewhere():
    assert vector_repo_id({"repo_name": "demo"}, "aaaaaaaaaaaa") == "aaaaaaaaaaaa"
    assert vector_repo_id(None, "aaaaaaaaaaaa") == "aaaaaaaaaaaa"
    assert vector_repo_id({"vector_repo_id": "bbbbbbbbbbbb"}, "aaaaaaaaaaaa") == "bbbbbbbbbbbb"


@pytest.mark.asyncio
async def test_status_is_read_from_the_analysis_itself_when_it_owns_its_vectors():
    result = {"index_status": {"status": "partial"}}

    assert await resolve_index_status(FakeCache(), result, "aaaaaaaaaaaa") == {"status": "partial"}


@pytest.mark.asyncio
async def test_status_is_read_from_the_vector_owner_for_a_shared_analysis():
    owner = {"index_status": {"status": "failed"}}
    shared = {"vector_repo_id": "bbbbbbbbbbbb", "index_status": {"status": "complete"}}  # stale copy ignored

    status = await resolve_index_status(FakeCache({"bbbbbbbbbbbb": owner}), shared, "aaaaaaaaaaaa")

    assert status == {"status": "failed"}


@pytest.mark.asyncio
async def test_a_vanished_vector_owner_means_status_unknown():
    shared = {"vector_repo_id": "bbbbbbbbbbbb"}

    assert await resolve_index_status(FakeCache(), shared, "aaaaaaaaaaaa") is None


# ── Recording ──


@pytest.mark.asyncio
async def test_recording_replaces_the_cached_result_without_mutating_the_original():
    original = {"repo_name": "demo", "index_status": {"status": "pending"}}
    cache = FakeCache({"aaaaaaaaaaaa": original})

    await record_index_status(cache, "aaaaaaaaaaaa", make_status("complete"))

    assert original["index_status"] == {"status": "pending"}  # the shared L1 object is left alone
    saved = cache.results["aaaaaaaaaaaa"]
    assert saved is not original
    assert (saved["repo_name"], saved["index_status"]["status"]) == ("demo", "complete")


@pytest.mark.asyncio
async def test_recording_without_a_cached_analysis_is_a_logged_no_op(caplog):
    cache = FakeCache()

    with caplog.at_level(logging.WARNING, logger="rune.index_status"):
        await record_index_status(cache, "aaaaaaaaaaaa", make_status("complete"))

    assert cache.sets == []
    assert "no cached analysis" in caplog.text


@pytest.mark.asyncio
async def test_a_cache_failure_while_recording_is_logged_not_raised(caplog):
    cache = FakeCache({"aaaaaaaaaaaa": {"repo_name": "demo"}}, fail_on_set=True)

    with caplog.at_level(logging.WARNING, logger="rune.index_status"):
        await record_index_status(cache, "aaaaaaaaaaaa", make_status("failed"))

    assert "Failed to record index status 'failed'" in caplog.text


# ── What chat says ──


def _pending(started_ago: timedelta | None):
    status = {"status": "pending"}
    if started_ago is not None:
        status["updated_at"] = (datetime.now(UTC) - started_ago).isoformat(timespec="seconds")
    return status


@pytest.mark.parametrize(
    ("status", "phrase"),
    [
        (_pending(timedelta(hours=3, minutes=5)), "still being indexed (started 3 hours ago)"),
        (_pending(timedelta(minutes=12)), "(started 12 minutes ago)"),
        (_pending(timedelta(days=3)), "(started 3 days ago)"),
        (_pending(None), "still being indexed, so there's no code to search yet"),
        ({"status": "pending", "updated_at": "not a timestamp"}, "still being indexed, so"),
        ({"status": "pending", "updated_at": "2026-01-01T00:00:00"}, "still being indexed, so"),  # naive
        ({"status": "complete"}, "No relevant code context found for this question."),
        ({"status": "partial", "chunks_attempted": 90, "chunks_inserted": 60}, "Only 60 of 90 code chunks"),
        ({"status": "failed"}, "Indexing failed for this repository"),
        ({"status": "empty"}, "no indexable source files"),
        ({"status": "interrupted"}, "Indexing was interrupted"),
        ({"status": "not_configured"}, "Code search isn't configured"),
        (None, "Ensure the repository was fully indexed"),
        ({"status": "something new"}, "Ensure the repository was fully indexed"),
    ],
)
def test_chat_explains_why_there_is_nothing_to_search(status, phrase):
    assert phrase in chat_unavailable_message(status)
