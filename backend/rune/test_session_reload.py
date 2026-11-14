"""Opening an analysis that isn't in memory (T42).

A miss used to mean "re-analyze from the clone and save the result", and a failed Supabase
read counted as a miss. The re-analysis saves a reduced record, so one network hiccup could
replace a saved analysis: no vector pointer (chat searched nothing), no index status (chat
embedded questions with the wrong model), no owner, and with T43's `.git`-only folders an
empty file list.
"""

import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from rune import session
from rune.cache import ANALYSIS_VERSION, AnalysisCache
from rune.index_status import make_status

REPO = "aaaaaaaaaaaa"
ORIGIN = "0123456789ab"


class _FakeSupabase:
    """Answers the one query AnalysisCache._supabase_get makes."""

    def __init__(self, *, record=None, fail=False):
        self.record, self.fail = record, fail

    def table(self, _name):
        return self

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self.fail:
            raise ConnectionError("Server disconnected without sending a response.")
        return SimpleNamespace(data={"result_json": self.record}) if self.record else None


class _RunNow:
    """threading.Thread stand-in: runs the re-analysis before ensure_repo_loaded returns."""

    def __init__(self, target, daemon=None):
        self.target = target

    def start(self):
        self.target()


@pytest.fixture
def clones(tmp_path, monkeypatch):
    monkeypatch.setattr(session, "CLONE_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(session.threading, "Thread", _RunNow)
    return tmp_path


def _cache(supabase: _FakeSupabase) -> tuple[AnalysisCache, list[str]]:
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase, cache._supabase_available = supabase, True
    writes: list[str] = []
    cache._supabase_set_raw = lambda repo_id, *_args: writes.append(repo_id)
    return cache, writes


def _clone(base, *, files: bool = True) -> str:
    path = os.path.join(base, f"demo_{REPO}")
    os.makedirs(os.path.join(path, ".git"))
    with open(os.path.join(path, ".git", "HEAD"), "w", encoding="utf-8") as f:
        f.write("ref: refs/heads/main\n")
    if files:
        with open(os.path.join(path, "app.py"), "w", encoding="utf-8") as f:
            f.write('"""Demo app."""\n\nimport util\n\n\ndef main():\n    return util.helper()\n')
        with open(os.path.join(path, "util.py"), "w", encoding="utf-8") as f:
            f.write("def helper():\n    return 1\n")
    return path


def _outdated(owner_user_id: str) -> dict:
    return {
        "_analysis_version": str(int(ANALYSIS_VERSION) - 1),
        "repo_name": "demo",
        "owner": "octo",
        "owner_user_id": owner_user_id,
        "repo_signature": "octo/demo@abc123",
        "_origin_repo_id": ORIGIN,
        "vector_repo_id": ORIGIN,
        "vector_index_status": make_status("complete"),
        "file_profiles": [{"path": "an/older/shape.py"}],
    }


def test_a_failed_read_answers_503_and_saves_nothing(clones):
    _clone(clones)
    cache, writes = _cache(_FakeSupabase(fail=True))

    with pytest.raises(HTTPException) as raised:
        session.ensure_repo_loaded(REPO, cache, "user-a")

    assert raised.value.status_code == 503
    assert writes == [] and cache.get(REPO) is None


def test_an_outdated_record_keeps_its_owner_vectors_and_signature(clones):
    path = _clone(clones)
    cache, writes = _cache(_FakeSupabase(record=_outdated("user-a")))

    with pytest.raises(HTTPException) as raised:
        session.ensure_repo_loaded(REPO, cache, "user-a")

    assert raised.value.status_code == 202  # re-analyzing; ran inline here
    saved = cache.get(REPO)
    assert writes == [REPO]
    assert (saved["owner_user_id"], saved["owner"], saved["repo_name"]) == ("user-a", "octo", "demo")
    assert (saved["vector_repo_id"], saved["_origin_repo_id"]) == (ORIGIN, ORIGIN)
    assert saved["vector_index_status"]["status"] == "complete"
    assert saved["repo_signature"] == "octo/demo@abc123"
    assert {p["path"] for p in saved["file_profiles"]} == {"app.py", "util.py"}  # facts recomputed
    assert "pipeline_version" not in saved  # a subset of the pipeline: T28 re-runs it
    assert saved["clone_path"] == path


def test_someone_else_cannot_reanalyze_an_outdated_record_into_theirs(clones):
    _clone(clones)
    cache, writes = _cache(_FakeSupabase(record=_outdated("user-a")))

    with pytest.raises(HTTPException) as raised:
        session.ensure_repo_loaded(REPO, cache, "user-b")

    assert raised.value.status_code == 404
    assert writes == []


def test_a_git_only_folder_is_not_reanalyzed_into_an_empty_analysis(clones):
    _clone(clones, files=False)
    cache, writes = _cache(_FakeSupabase(record=None))

    assert session.ensure_repo_loaded(REPO, cache, "user-a") == (None, None)
    assert writes == []
    assert session.find_clone_path_by_repo_id(REPO) is None


def test_a_real_miss_with_a_clone_still_reanalyzes_for_the_requester(clones):
    _clone(clones)
    cache, writes = _cache(_FakeSupabase(record=None))

    with pytest.raises(HTTPException) as raised:
        session.ensure_repo_loaded(REPO, cache, "user-a")

    assert raised.value.status_code == 202
    assert writes == [REPO]
    assert cache.get(REPO)["owner_user_id"] == "user-a"


def test_lookup_tells_a_failed_read_from_a_miss_and_get_is_unchanged():
    failed, _ = _cache(_FakeSupabase(fail=True))
    missing, _ = _cache(_FakeSupabase(record=None))
    outdated, _ = _cache(_FakeSupabase(record=_outdated("user-a")))

    assert (failed.lookup(REPO).record, failed.lookup(REPO).unread) == (None, True)
    assert (missing.lookup(REPO).record, missing.lookup(REPO).unread) == (None, False)
    assert outdated.lookup(REPO).outdated["owner_user_id"] == "user-a"
    assert failed.get(REPO) is None and missing.get(REPO) is None and outdated.get(REPO) is None


def test_a_supabase_client_that_could_not_be_built_makes_reads_unknown(monkeypatch):
    cache = AnalysisCache()
    cache._redis_available = False
    monkeypatch.setattr("rune.cache.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("rune.cache.settings.supabase_service_key", "key")
    monkeypatch.setattr("supabase.create_client", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bad config")))

    assert cache.lookup(REPO).unread is True
