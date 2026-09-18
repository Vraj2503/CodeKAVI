"""Regression tests for the indexer's batch hand-off and chunk line numbers.

flush_batch used to pass the live accumulator lists downstream (into the
embedder and into collection.insert, which runs on a worker thread) and then
call .clear() on them. That only worked because the producer loop blocked on
every flush. The fakes here keep what they are handed *by reference*, the way
the insert thread does, so a batch that gets emptied after being handed over
shows up as a column that no longer lines up with its ids.
"""

import asyncio
import hashlib
import logging
from typing import Any

import pytest
from langchain_text_splitters import RecursiveCharacterTextSplitter

from rune import indexer
from rune.index_status import IndexOutcome
from rune.settings import settings

REPO_ID = "abcdef012345"
TEXT_COL = 8  # position of the chunk text column in insert_data


def _source(tag: str, n_funcs: int) -> str:
    return "".join(
        f"def {tag}_{i}(value):\n    total = value * {i}\n    return total + {i}  # {tag} {'x' * 40}\n\n"
        for i in range(n_funcs)
    )


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200, length_function=len)


class _MutationResult:
    def __init__(self, rows: int) -> None:
        self.primary_keys = [f"pk{i}" for i in range(rows)]


class FakeCollection:
    def __init__(self) -> None:
        self.inserts: list[list[Any]] = []  # insert_data, kept by reference

    def insert(self, data: list[Any]) -> _MutationResult:
        self.inserts.append(data)
        return _MutationResult(len(data[0]))


class FakeZilliz:
    def __init__(self, collection: FakeCollection) -> None:
        self.collection = collection
        self.setup_error: Exception | None = None

    def setup_collection(self) -> FakeCollection:
        if self.setup_error:
            raise self.setup_error
        return self.collection

    def clear_repo(self, repo_id: str) -> None:
        pass


class FakeEmbedder:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []  # texts, kept by reference
        self.fail_on_call: int | None = None

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        await asyncio.sleep(0)  # yield to the loop, as a real HTTP call does
        if self.fail_on_call == len(self.calls):
            raise RuntimeError("simulated embedding failure")
        return [[float(len(t))] * 4 for t in texts]


@pytest.fixture
def repo(tmp_path):
    files = {
        "pkg/alpha.py": _source("alpha", 200),
        "pkg/beta.py": _source("beta", 200),
        "gamma.py": _source("gamma", 200),
    }
    for rel, content in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    profiles = [{"path": rel, "role_label": "Core Logic"} for rel in files]
    return str(tmp_path), files, profiles


@pytest.fixture
def fakes(monkeypatch):
    collection = FakeCollection()
    zilliz = FakeZilliz(collection)
    embedder = FakeEmbedder()
    monkeypatch.setattr(indexer, "zilliz_client", zilliz)
    monkeypatch.setattr(indexer, "CloudflareEmbedding", lambda: embedder)
    monkeypatch.setattr(settings, "indexer_batch_delay_s", 0.0)
    return collection, embedder, zilliz


def _expected_chunks(files: dict[str, str]) -> dict[str, str]:
    """chunk id -> chunk text, computed independently of the indexer."""
    expected = {}
    for rel, content in files.items():
        file_hash = hashlib.md5(rel.encode()).hexdigest()[:10]
        for i, chunk in enumerate(_splitter().split_text(content)):
            expected[f"{REPO_ID}_{file_hash}_{i}"] = chunk
    return expected


# ── Batch hand-off ──


@pytest.mark.asyncio
async def test_rows_handed_to_insert_stay_intact_after_the_flush(repo, fakes):
    root, files, profiles = repo
    collection, _, _ = fakes

    outcome = await indexer.index_repository(REPO_ID, profiles, root)

    expected = _expected_chunks(files)
    assert len(expected) > 2 * indexer.BATCH_SIZE, "fixture must span several batches"
    assert len(collection.inserts) >= 3
    persisted = []
    for data in collection.inserts:
        ids = data[0]
        assert ids, "an insert arrived with no rows"
        # Every column must still line up with its ids after the flush returned.
        assert [len(column) for column in data] == [len(ids)] * len(data)
        for chunk_id, text in zip(ids, data[TEXT_COL], strict=True):
            assert text == expected[chunk_id]
        persisted.extend(ids)
    assert sorted(persisted) == sorted(expected)
    assert outcome == IndexOutcome(attempted=len(expected), inserted=len(expected))


@pytest.mark.asyncio
async def test_texts_handed_to_the_embedder_stay_intact_after_the_flush(repo, fakes):
    root, files, profiles = repo
    _, embedder, _ = fakes

    await indexer.index_repository(REPO_ID, profiles, root)

    assert all(call for call in embedder.calls), "a batch was emptied after being handed over"
    embedded = sorted(text for call in embedder.calls for text in call)
    assert embedded == sorted(_expected_chunks(files).values())


@pytest.mark.asyncio
async def test_a_failed_batch_is_lost_alone_and_later_batches_still_land(repo, fakes):
    root, files, profiles = repo
    collection, embedder, _ = fakes
    embedder.fail_on_call = 2

    outcome = await indexer.index_repository(REPO_ID, profiles, root)

    total = len(_expected_chunks(files))
    lost = len(embedder.calls[1])
    assert lost > 0
    persisted = [chunk_id for data in collection.inserts for chunk_id in data[0]]
    assert len(persisted) == len(set(persisted)) == total - lost
    assert outcome == IndexOutcome(attempted=total, inserted=total - lost)


@pytest.mark.asyncio
async def test_a_repo_with_no_indexable_text_reports_nothing_attempted(tmp_path, fakes):
    (tmp_path / "blank.py").write_text("   \n\n", encoding="utf-8")
    profiles = [{"path": "blank.py"}, {"path": "missing.py"}]

    outcome = await indexer.index_repository(REPO_ID, profiles, str(tmp_path))

    assert outcome == IndexOutcome(attempted=0, inserted=0)


@pytest.mark.asyncio
async def test_an_unreachable_vector_store_reports_why_indexing_could_not_start(repo, fakes):
    root, _, profiles = repo
    _, embedder, zilliz = fakes
    zilliz.setup_error = RuntimeError("zilliz down")

    outcome = await indexer.index_repository(REPO_ID, profiles, root)

    assert outcome == IndexOutcome(error="vector_store_unavailable")
    assert embedder.calls == []


# ── Chunk line numbers ──


def _original_lookup(content: str, chunks: list[str]) -> list[tuple[int, int]]:
    """The lookup the indexer used before, kept as a reference implementation."""
    spans, search_start = [], 0
    for chunk in chunks:
        offset = content.find(chunk, search_start)
        if offset == -1:
            spans.append((0, 0))
            continue
        start = content[:offset].count("\n") + 1
        spans.append((start, start + chunk.count("\n")))
        search_start = offset + 1
    return spans


def test_line_spans_match_the_original_lookup_on_real_splitter_output():
    content = _source("delta", 300)
    chunks = _splitter().split_text(content)
    assert len(chunks) > 5

    spans = indexer._chunk_line_spans(content, chunks, "delta.py")

    assert spans == _original_lookup(content, chunks)


def test_line_spans_point_at_the_lines_each_chunk_came_from():
    content = _source("epsilon", 300)
    chunks = _splitter().split_text(content)
    lines = content.split("\n")

    spans = indexer._chunk_line_spans(content, chunks, "epsilon.py")

    assert spans[0][0] == 1
    for chunk, (start, end) in zip(chunks, spans, strict=True):
        chunk_lines = chunk.split("\n")
        assert chunk_lines[0] in lines[start - 1]
        assert chunk_lines[-1] in lines[end - 1]


def test_a_chunk_missing_from_the_file_is_logged_not_silently_zeroed(caplog):
    content = "one\ntwo\nthree\n"

    with caplog.at_level(logging.WARNING, logger="rune.indexer"):
        spans = indexer._chunk_line_spans(content, ["two", "not in the file", "three"], "x.py")

    assert spans == [(2, 2), (0, 0), (3, 3)]
    assert "Chunk 1 of x.py not found" in caplog.text


def test_a_chunk_behind_the_search_position_is_found_by_the_retry():
    content = "alpha\nbeta\ngamma\ndelta\n"

    spans = indexer._chunk_line_spans(content, ["gamma", "alpha", "delta"], "x.py")

    assert spans == [(3, 3), (1, 1), (4, 4)]


# ── Recording the outcome ──


class FakeCache:
    def __init__(self, results: dict[str, dict] | None = None) -> None:
        self.results = dict(results or {})
        self.sets: list[tuple[str, dict]] = []

    def get(self, repo_id: str) -> dict | None:
        return self.results.get(repo_id)

    def set(self, repo_id: str, result: dict) -> None:
        self.sets.append((repo_id, result))
        self.results[repo_id] = result


def _stub_index_repository(monkeypatch, behaviour):
    async def fake(repo_id, file_profiles, clone_path):
        return behaviour()

    monkeypatch.setattr(indexer, "index_repository", fake)


@pytest.mark.asyncio
async def test_the_outcome_is_recorded_on_the_cached_analysis(monkeypatch):
    cache = FakeCache({REPO_ID: {"repo_name": "demo", "index_status": {"status": "pending"}}})
    _stub_index_repository(monkeypatch, lambda: IndexOutcome(attempted=10, inserted=7))

    await indexer.index_repository_and_record(REPO_ID, [], "/clone", cache)

    result = cache.results[REPO_ID]
    assert result["repo_name"] == "demo"
    assert result["index_status"]["status"] == "partial"
    assert (result["index_status"]["chunks_attempted"], result["index_status"]["chunks_inserted"]) == (10, 7)


@pytest.mark.asyncio
async def test_a_crash_is_recorded_as_failed_and_still_raised(monkeypatch):
    cache = FakeCache({REPO_ID: {"repo_name": "demo"}})

    def crash():
        raise RuntimeError("boom")

    _stub_index_repository(monkeypatch, crash)

    with pytest.raises(RuntimeError, match="boom"):
        await indexer.index_repository_and_record(REPO_ID, [], "/clone", cache)

    status = cache.results[REPO_ID]["index_status"]
    assert (status["status"], status["reason"]) == ("failed", "indexing_crashed")


@pytest.mark.asyncio
async def test_a_cancelled_run_is_recorded_as_interrupted_and_still_cancelled(monkeypatch):
    cache = FakeCache({REPO_ID: {"repo_name": "demo"}})

    def cancelled():
        raise asyncio.CancelledError

    _stub_index_repository(monkeypatch, cancelled)

    with pytest.raises(asyncio.CancelledError):
        await indexer.index_repository_and_record(REPO_ID, [], "/clone", cache)

    assert cache.results[REPO_ID]["index_status"]["status"] == "interrupted"


@pytest.mark.asyncio
async def test_no_cached_analysis_means_nothing_is_recorded(monkeypatch):
    cache = FakeCache()
    _stub_index_repository(monkeypatch, lambda: IndexOutcome(attempted=3, inserted=3))

    await indexer.index_repository_and_record(REPO_ID, [], "/clone", cache)

    assert cache.sets == []
