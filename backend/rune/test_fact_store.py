"""T16: per-file facts live in their own store, never in the analysis record."""

import logging

import pytest
from fastapi import HTTPException

from rune import fingerprint, session
from rune.cache import AnalysisCache
from rune.fact_store import FACTS_TABLE, MAX_SYMBOLS_PER_FILE, FactStore, facts_repo_id, shape_file_facts
from rune.fingerprint import ChangeClassification
from rune.routes import analyze as analyze_routes
from rune.traverser import traverse_repo

REPO = "aaaaaaaaaaaa"


# ── Fakes ──


class FakeRedis:
    def __init__(self):
        self.hashes: dict[str, dict[str, str]] = {}
        self.hmget_calls: list[list[str]] = []

    def pipeline(self):
        return self

    def delete(self, key):
        self.hashes.pop(key, None)

    def hset(self, key, mapping):
        self.hashes.setdefault(key, {}).update(mapping)

    def expire(self, key, seconds):
        pass

    def execute(self):
        pass

    def hmget(self, key, fields):
        self.hmget_calls.append(list(fields))
        stored = self.hashes.get(key, {})
        return [stored.get(f) for f in fields]


class FakeSupabase:
    """Records each query; rows live in self.rows keyed by (repo_id, path)."""

    def __init__(self, fail_with: str | None = None):
        self.rows: dict[tuple[str, str], dict] = {}
        self.fail_with = fail_with
        self.calls: list[tuple] = []
        self._query: dict = {}

    def table(self, name):
        assert name == FACTS_TABLE
        self._query = {}
        return self

    def upsert(self, rows):
        self._query = {"op": "upsert", "rows": rows}
        return self

    def select(self, columns):
        self._query = {"op": "select"}
        return self

    def delete(self):
        self._query = {"op": "delete"}
        return self

    def eq(self, column, value):
        self._query[column] = value
        return self

    def in_(self, column, values):
        self._query["paths"] = list(values)
        return self

    def execute(self):
        query, self._query = self._query, {}
        self.calls.append((query["op"], len(query.get("rows", query.get("paths", [])))))
        if self.fail_with:
            raise RuntimeError(self.fail_with)
        if query["op"] == "upsert":
            for row in query["rows"]:
                self.rows[(row["repo_id"], row["path"])] = row
            return type("R", (), {"data": []})()
        if query["op"] == "delete":
            self.rows = {k: v for k, v in self.rows.items() if k[0] != query["repo_id"]}
            return type("R", (), {"data": []})()
        data = [
            {"path": path, "facts": row["facts"], "summary": None}
            for (repo_id, path), row in self.rows.items()
            if repo_id == query["repo_id"] and path in query["paths"]
        ]
        return type("R", (), {"data": data})()


def _store(redis=None, supabase=None) -> FactStore:
    return FactStore(lambda: redis, lambda: supabase, run_in_background=lambda work: work())


def _facts(n_files: int) -> dict[str, dict]:
    return {f"src/f{i}.py": {"purpose": f"File {i}.", "purpose_source": "doc", "symbols": []} for i in range(n_files)}


# ── Shape ──


def test_a_200_function_file_keeps_its_40_most_complex_symbols_in_source_order():
    symbols = [
        {
            "name": f"f{i}",
            "kind": "function",
            "line": i * 10,
            "end_line": i * 10 + 5,
            "complexity": i % 50,
            "callees": ["x"],
            "bare_callees": ["x"],
            "decorators": [],
            "doc": None,
            "signature": "()",
        }
        for i in range(200)
    ]
    shaped = shape_file_facts({"big.py": symbols}, {"big.py": {"purpose": "Big.", "purpose_source": "doc"}})["big.py"]

    assert shaped["truncated"] is True and len(shaped["symbols"]) == MAX_SYMBOLS_PER_FILE
    assert min(s["complexity"] for s in shaped["symbols"]) == 40  # complexities 40..49, four of each
    lines = [s["line"] for s in shaped["symbols"]]
    assert lines == sorted(lines)
    assert set(shaped["symbols"][0]) == {"name", "kind", "line", "end_line", "doc", "signature", "complexity"}
    assert shaped["purpose"] == "Big."


def test_a_file_with_a_purpose_and_no_symbols_still_has_an_entry():
    shaped = shape_file_facts({}, {"README.py": {"purpose": "Notes.", "purpose_source": "doc"}})
    assert shaped == {"README.py": {"purpose": "Notes.", "purpose_source": "doc", "symbols": [], "truncated": False}}


def test_a_reused_analysis_reads_its_origins_facts():
    assert facts_repo_id({"_origin_repo_id": "origin123456"}, REPO) == "origin123456"
    assert facts_repo_id({}, REPO) == REPO
    assert facts_repo_id(None, REPO) == REPO


# ── Tiers ──


def test_memory_returns_only_the_paths_asked_for():
    store = _store()
    store.put(REPO, _facts(5))

    assert set(store.get(REPO, ["src/f1.py", "src/f3.py", "missing.py"])) == {"src/f1.py", "src/f3.py"}


def test_after_a_restart_redis_answers_with_hmget_for_just_those_paths():
    redis = FakeRedis()
    _store(redis=redis).put(REPO, _facts(300))

    restarted = _store(redis=redis)
    got = restarted.get(REPO, ["src/f7.py", "src/f9.py"])

    assert set(got) == {"src/f7.py", "src/f9.py"}
    assert redis.hmget_calls == [["src/f7.py", "src/f9.py"]]
    restarted.get(REPO, ["src/f7.py"])
    assert len(redis.hmget_calls) == 1  # now in memory


def test_a_view_asking_for_100_paths_reads_only_those_rows():
    supabase = FakeSupabase()
    _store(supabase=supabase).put(REPO, _facts(1200))
    assert [c for c in supabase.calls if c[0] == "upsert"] == [("upsert", 500), ("upsert", 500), ("upsert", 200)]

    restarted = _store(supabase=supabase)
    supabase.calls.clear()
    wanted = [f"src/f{i}.py" for i in range(0, 1000, 10)]
    got = restarted.get(REPO, wanted)

    assert set(got) == set(wanted)
    assert supabase.calls == [("select", 100)]


def test_a_missing_table_is_reported_once_and_then_skipped(caplog):
    supabase = FakeSupabase(fail_with="{'code': 'PGRST205', 'message': 'Could not find the table'}")
    store = _store(supabase=supabase)

    with caplog.at_level(logging.WARNING, logger="rune.fact_store"):
        store.put(REPO, _facts(3))
        store.put("bbbbbbbbbbbb", _facts(3))

    assert len([c for c in supabase.calls if c[0] == "upsert"]) == 1
    assert caplog.text.count("003_analysis_file_facts.sql") == 1
    assert set(store.get(REPO, ["src/f1.py"])) == {"src/f1.py"}  # memory still serves


def test_a_failed_read_is_not_remembered_as_no_facts():
    supabase = FakeSupabase()
    _store(supabase=supabase).put(REPO, _facts(3))
    restarted = _store(supabase=supabase)

    supabase.fail_with = "connection reset"
    assert restarted.get(REPO, ["src/f1.py"]) == {}
    supabase.fail_with = None
    assert set(restarted.get(REPO, ["src/f1.py"])) == {"src/f1.py"}


def test_delete_clears_every_tier():
    redis, supabase = FakeRedis(), FakeSupabase()
    store = _store(redis=redis, supabase=supabase)
    store.put(REPO, _facts(3))

    store.delete(REPO)

    assert _store(redis=redis, supabase=supabase).get(REPO, ["src/f1.py"]) == {}
    assert not supabase.rows and f"codekavi:facts:{REPO}" not in redis.hashes


def test_deleting_an_analysis_deletes_its_facts():
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    cache.facts.put(REPO, _facts(2))

    cache.delete(REPO)

    assert cache.facts.get(REPO, ["src/f0.py"]) == {}


# ── Written by the pipeline and by a re-analysis ──


def _repo(tmp_path, name: str) -> str:
    root = tmp_path / name
    (root / "app").mkdir(parents=True)
    (root / "app" / "main.py").write_text(
        '"""Starts the demo server."""\n\nfrom app import util\n\n\ndef main():\n    return util.helper()\n',
        encoding="utf-8",
    )
    (root / "app" / "util.py").write_text(
        "def helper(x=1):\n    if x:\n        return 1\n    return 0\n", encoding="utf-8"
    )
    (root / "app" / "__init__.py").write_text("", encoding="utf-8")
    return str(root)


@pytest.mark.asyncio
async def test_the_pipeline_saves_each_files_facts(tmp_path, monkeypatch):
    monkeypatch.setattr(fingerprint, "save_fingerprints", lambda *a, **k: None)
    root = _repo(tmp_path, f"demo_{REPO}")
    repo_data = traverse_repo(root)
    contents = {f.path: f.content for f in repo_data.files if f.content is not None}
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False

    result = None
    async for stage, _progress, _message, data in analyze_routes._run_pipeline(
        REPO,
        {"clone_path": root, "repo_name": "demo", "owner": "octo"},
        repo_data,
        contents,
        {},
        ChangeClassification.FULL_UPDATE,
        cache,
        "user-a",
    ):
        if stage == "__result__":
            result = data
            break

    # Never on the record: chat loads the whole record on every cache miss (P3-2).
    assert result is not None
    assert not any("purpose" in profile for profile in result.file_profiles_dicts)

    facts = cache.facts.get(REPO, ["app/main.py", "app/util.py"])
    assert facts["app/main.py"]["purpose"] == "Starts the demo server."
    assert facts["app/util.py"]["purpose"] == "Defines: helper"
    assert facts["app/util.py"]["symbols"][0] | {"doc": None} == {
        "name": "helper",
        "kind": "function",
        "line": 1,
        "end_line": 4,
        "doc": None,
        "signature": "(x=1)",
        "complexity": 2,
    }


def test_a_reanalysis_from_the_clone_saves_facts_too(tmp_path, monkeypatch):
    class RunNow:
        def __init__(self, target, daemon=None):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(session, "CLONE_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(session.threading, "Thread", RunNow)
    _repo(tmp_path, f"demo_{REPO}")
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False

    with pytest.raises(HTTPException) as raised:
        session.ensure_repo_loaded(REPO, cache, "user-a")

    assert raised.value.status_code == 202  # re-analyzing; ran inline here

    assert cache.facts.get(REPO, ["app/main.py"])["app/main.py"]["purpose"] == "Starts the demo server."
