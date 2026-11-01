"""T5: delete the vector sets nothing can reach, and nothing else.

Every analysis embeds its repo under a fresh repo_id, so sets only pile up. A
set is still reachable while a saved analysis (any tier, any version), another
analysis's ``vector_repo_id`` or a session row names it. Deleting is
irreversible, so every way the job could mistake "couldn't read" for
"unreferenced" must end with nothing deleted.
"""

import logging
import re
from typing import Any, cast

import pytest

from rune.cache import AnalysisCache
from rune.vector_reclaim import reclaim_orphan_vectors, referenced_repo_ids

OWN, BORROWED, SHARER, LISTED, MEMORY, REDIS = (f"{c * 11}{i}" for i, c in enumerate("abcdef"))
ORPHAN_A, ORPHAN_B = "0123456789ab", "ba9876543210"


class FakeQuery:
    def __init__(self, table: "FakeTable") -> None:
        self.table = table
        self.start = 0
        self.end: int | None = None

    def select(self, *_args: Any) -> "FakeQuery":
        return self

    def order(self, column: str) -> "FakeQuery":
        self.table.ordered_by = column
        return self

    def range(self, start: int, end: int) -> "FakeQuery":
        self.start, self.end = start, end
        return self

    def execute(self) -> Any:
        if self.table.fail:
            raise RuntimeError("supabase down")
        self.table.pages_read += 1
        rows = self.table.rows if self.table.reads_done == 0 else self.table.rows + self.table.later_rows
        end = len(rows) if self.end is None else self.end + 1
        if end >= len(rows):
            self.table.reads_done += 1
        return type("Response", (), {"data": rows[self.start : end]})()


class FakeTable:
    def __init__(self, rows: list[dict], fail: bool = False) -> None:
        self.rows, self.fail = rows, fail
        self.later_rows: list[dict] = []  # rows that appear from the second full read on
        self.reads_done = self.pages_read = 0
        self.ordered_by: str | None = None


class FakeSupabase:
    def __init__(self, records: list[dict], sessions: list[dict]) -> None:
        self.tables = {"analysis_cache": FakeTable(records), "sessions": FakeTable(sessions)}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self.tables[name])


class FakeCache:
    def __init__(self, supabase: FakeSupabase | None, memory=(), redis: set[str] | None = None) -> None:
        self.supabase, self.memory = supabase, list(memory)
        self.redis = set() if redis is None else redis
        self.redis_down = False

    def memory_records(self) -> list[tuple[str, dict]]:
        return self.memory

    def redis_record_ids(self) -> set[str] | None:
        return None if self.redis_down else self.redis

    def supabase_client(self) -> FakeSupabase | None:
        return self.supabase


class FakeCollection:
    """One entry per vector: its repo_id."""

    def __init__(self, sizes: dict[str, int]) -> None:
        self.rows = [repo_id for repo_id, n in sizes.items() for _ in range(n)]
        self.grows: set[str] = set()  # sets that gain a vector before the recount
        self.deletes: list[str] = []

    def query_iterator(self, batch_size: int, expr: str, output_fields: list[str]) -> Any:
        batches = [self.rows[i : i + batch_size] for i in range(0, len(self.rows), batch_size)]
        it = iter(batches)

        class Iterator:
            def next(self) -> list[dict]:
                return [{"repo_id": r} for r in next(it, [])]

            def close(self) -> None:
                pass

        return Iterator()

    def query(self, expr: str, output_fields: list[str]) -> list[dict]:
        (repo_id,) = re.fullmatch(r"repo_id == '(\w+)'", expr).groups()  # type: ignore[union-attr]
        return [{"count(*)": self.rows.count(repo_id) + (repo_id in self.grows)}]

    def delete(self, expr: str) -> None:
        self.deletes.append(expr)
        ids = set(re.findall(r"'(\w+)'", expr))
        self.rows = [r for r in self.rows if r not in ids]


def _world(**sizes: int) -> tuple[FakeCache, FakeCollection]:
    """Every kind of reference, plus two orphans."""
    supabase = FakeSupabase(
        records=[{"repo_id": OWN}, {"repo_id": SHARER, "vector_repo_id": BORROWED}],
        sessions=[{"repo_id": LISTED}],
    )
    cache = FakeCache(supabase, memory=[(MEMORY, {"repo_name": "demo"})], redis={REDIS})
    default = {OWN: 3, BORROWED: 2, LISTED: 2, MEMORY: 2, REDIS: 1, ORPHAN_A: 4, ORPHAN_B: 1}
    return cache, FakeCollection({**default, **sizes})


def _left(collection: FakeCollection) -> set[str]:
    return set(collection.rows)


async def _reclaim(cache: FakeCache, collection: FakeCollection):
    return await reclaim_orphan_vectors(cast(AnalysisCache, cache), collection, settle_seconds=0)


@pytest.mark.asyncio
async def test_only_sets_nothing_references_are_deleted():
    cache, collection = _world()

    report = await _reclaim(cache, collection)

    assert _left(collection) == {OWN, BORROWED, LISTED, MEMORY, REDIS}
    assert (report.sets_found, report.sets_deleted, report.vectors_deleted, report.aborted) == (7, 2, 5, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["supabase missing", "supabase down"])
async def test_nothing_is_deleted_when_supabase_cannot_be_read(failure):
    cache, collection = _world()
    if failure == "supabase missing":
        cache.supabase = None
    else:
        assert cache.supabase is not None
        cache.supabase.tables["sessions"].fail = True

    report = await _reclaim(cache, collection)

    assert report.aborted
    assert collection.deletes == []


@pytest.mark.asyncio
async def test_an_unreachable_redis_is_read_as_holding_no_records(caplog):
    # A dev machine sets REDIS_URL but doesn't run Redis; then it holds no
    # records, and refusing to clean up would make the job a no-op there.
    cache, collection = _world()
    cache.redis_down = True

    with caplog.at_level(logging.WARNING, logger="rune.vector_reclaim"):
        report = await _reclaim(cache, collection)

    assert report.aborted is None
    assert _left(collection) == {OWN, BORROWED, LISTED, MEMORY}  # REDIS's set had only Redis protecting it
    assert "Redis is configured but unreachable" in caplog.text


@pytest.mark.asyncio
async def test_nothing_is_deleted_when_no_references_are_found_at_all():
    collection = FakeCollection({ORPHAN_A: 4})

    report = await _reclaim(FakeCache(FakeSupabase(records=[], sessions=[])), collection)

    assert report.aborted == "no references found at all"
    assert collection.deletes == []


@pytest.mark.asyncio
async def test_a_set_that_grows_during_the_wait_is_kept():
    cache, collection = _world()
    collection.grows = {ORPHAN_A}  # an index still writing it

    report = await _reclaim(cache, collection)

    assert ORPHAN_A in _left(collection) and ORPHAN_B not in _left(collection)
    assert (report.sets_deleted, report.kept_changing) == (1, 1)


@pytest.mark.asyncio
async def test_a_set_whose_analysis_is_saved_during_the_wait_is_kept():
    cache, collection = _world()
    assert cache.supabase is not None
    cache.supabase.tables["analysis_cache"].later_rows = [{"repo_id": ORPHAN_A}]

    report = await _reclaim(cache, collection)

    assert ORPHAN_A in _left(collection) and ORPHAN_B not in _left(collection)
    assert report.kept_changing == 1


@pytest.mark.asyncio
async def test_an_id_not_in_the_apps_format_is_never_put_in_an_expression():
    cache, collection = _world(**{"x' or 1==1": 2})

    report = await _reclaim(cache, collection)

    assert report.kept_unsafe_id == 1
    assert not any("or 1==1" in expr for expr in collection.deletes)


@pytest.mark.asyncio
async def test_many_orphans_are_deleted_in_batches():
    orphans = {f"{i:012x}": 1 for i in range(120)}
    cache, collection = _world(**orphans)

    report = await _reclaim(cache, collection)

    assert report.sets_deleted == 122  # the 120 plus the two in every world
    assert len(collection.deletes) == 3
    assert _left(collection) == {OWN, BORROWED, LISTED, MEMORY, REDIS}


def test_references_beyond_the_first_page_are_read():
    records = [{"repo_id": f"{i:012x}"} for i in range(5)]
    supabase = FakeSupabase(records=records, sessions=[{"repo_id": LISTED}])

    refs = referenced_repo_ids(cast(AnalysisCache, FakeCache(supabase)), page_size=2)

    assert refs == {r["repo_id"] for r in records} | {LISTED}
    assert supabase.tables["analysis_cache"].pages_read == 3
    assert supabase.tables["analysis_cache"].ordered_by == "repo_id"  # stable pages
