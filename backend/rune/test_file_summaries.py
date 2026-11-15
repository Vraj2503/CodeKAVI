"""T34: one written sentence per important file, from the facts, once per analysis."""

import json

import pytest

from rune.cache import AnalysisCache
from rune.exceptions import RateLimitError
from rune.fact_store import file_description
from rune.file_summaries import MAX_SUMMARY_CHARS, build_prompt, parse_summaries, pick_files, summarize_files
from rune.settings import settings


def _profile(path, importance, role="core_module"):
    return {"path": path, "role": role, "role_label": role.replace("_", " ").title(), "importance_score": importance}


def _facts(path):
    stem = path.rsplit("/", 1)[-1][:-3]
    return {
        "purpose": f"Defines: run_{stem}",
        "purpose_source": "derived",
        "symbols": [
            {
                "name": "run",
                "kind": "function",
                "line": 3,
                "end_line": 9,
                "signature": "(job)",
                "doc": "Runs one job.",
                "complexity": 4,
            }
        ],
        "routes": [],
    }


def test_the_files_picked_are_the_important_ones_worth_a_sentence():
    profiles = [
        _profile("app/core.py", 90),
        _profile("tests/test_core.py", 95, role="test"),
        _profile("docs/guide.md", 94, role="documentation"),
        _profile("app/settings.py", 93, role="config"),
        _profile("app/__init__.py", 92, role="barrel"),
        _profile("app/no_facts.py", 91),
        _profile("app/jobs.py", 80),
        _profile("app/util.py", 70),
    ]
    facts: dict[str, dict] = {p["path"]: {} for p in profiles if p["path"] != "app/no_facts.py"}

    assert pick_files(profiles, facts, 2) == ["app/core.py", "app/jobs.py"]


def test_the_prompt_holds_facts_about_each_file():
    prompt = build_prompt([("app/jobs.py", {**_facts("app/jobs.py"), "routes": ["POST /jobs"]}, "Router")])

    assert "## app/jobs.py" in prompt and "Role: Router" in prompt
    assert "Routes: POST /jobs" in prompt
    assert "- function run(job): Runs one job." in prompt


def test_only_sentences_for_files_in_the_batch_are_kept():
    text = json.dumps(
        {
            "app/a.py": "  Schedules   the nightly jobs. ",
            "app/b.py": "",
            "app/c.py": "x" * (MAX_SUMMARY_CHARS + 1),
            "app/invented.py": "A file the model made up.",
            "app/d.py": ["not", "a", "sentence"],
        }
    )
    kept = parse_summaries(text, ["app/a.py", "app/b.py", "app/c.py", "app/d.py"])

    assert kept == {"app/a.py": "Schedules the nightly jobs."}
    assert parse_summaries("not json", ["app/a.py"]) == {}


class FakeProvider:
    def __init__(self, fail=False, rate_limit_on: int | None = None):
        self.batches: list[list[str]] = []
        self.fail = fail
        self.rate_limit_on = rate_limit_on  # which call (1-based) hits the limit

    async def generate_with_usage(self, system_prompt, user_prompt, **kwargs):
        paths = [line[3:] for line in user_prompt.splitlines() if line.startswith("## ")]
        self.batches.append(paths)
        if self.fail:
            raise RuntimeError("provider down")
        if self.rate_limit_on == len(self.batches):
            raise RateLimitError("Groq rate limit exceeded: 429 Too Many Requests")
        return json.dumps({p: f"Does the {p.rsplit('/', 1)[-1]} work." for p in paths}), {"total_tokens": 100}


class Quota:
    def __init__(self, ok=True):
        self.ok = ok

    def check_quota(self, user_id):
        return self.ok


def _setup(monkeypatch, n_files=60, quota=True, record_extra=None, facts_owner="r"):
    monkeypatch.setattr(settings, "file_summaries", True)
    monkeypatch.setattr(settings, "file_summary_max_files", 150)
    monkeypatch.setattr("rune.quota.get_token_tracker", lambda: Quota(quota))
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    profiles = [_profile(f"app/m{i}.py", 100 - i) for i in range(n_files)]
    record = {"file_profiles": profiles, **(record_extra or {})}
    cache.set("r", record)
    cache.facts.put(facts_owner, {p["path"]: _facts(p["path"]) for p in profiles})
    return cache, record


@pytest.mark.asyncio
async def test_60_files_take_three_calls_and_every_view_then_reads_the_sentence(monkeypatch):
    cache, record = _setup(monkeypatch)
    provider = FakeProvider()

    await summarize_files("r", record, cache, "user-a", provider=provider)

    assert [len(b) for b in provider.batches] == [25, 25, 10]
    assert cache.get("r")["summaries_status"] == {"status": "complete", "files": 60, "summarized": 60, "calls": 3}
    facts = cache.facts.get("r", ["app/m0.py"])["app/m0.py"]
    assert file_description(facts) == ("Does the m0.py work.", "summary")
    assert facts["purpose"] == "Defines: run_m0"  # the purpose line stays underneath


@pytest.mark.asyncio
async def test_a_provider_failure_leaves_the_purpose_lines_in_place(monkeypatch):
    cache, record = _setup(monkeypatch, n_files=10)

    await summarize_files("r", record, cache, "user-a", provider=FakeProvider(fail=True))

    assert cache.get("r")["summaries_status"]["status"] == "failed"
    assert file_description(cache.facts.get("r", ["app/m0.py"])["app/m0.py"]) == ("Defines: run_m0", "derived")


@pytest.mark.asyncio
async def test_a_spent_quota_makes_no_calls(monkeypatch):
    cache, record = _setup(monkeypatch, n_files=10, quota=False)
    provider = FakeProvider()

    await summarize_files("r", record, cache, "user-a", provider=provider)

    assert provider.batches == []
    assert cache.get("r")["summaries_status"]["status"] == "quota_exceeded"


@pytest.mark.asyncio
async def test_switched_off_it_does_nothing(monkeypatch):
    cache, record = _setup(monkeypatch, n_files=10)
    monkeypatch.setattr(settings, "file_summaries", False)
    provider = FakeProvider()

    await summarize_files("r", record, cache, "user-a", provider=provider)

    assert provider.batches == [] and "summaries_status" not in cache.get("r")


@pytest.mark.asyncio
async def test_a_reused_analysis_summarizes_into_its_origins_facts(monkeypatch):
    cache, record = _setup(
        monkeypatch, n_files=5, record_extra={"_origin_repo_id": "origin123456"}, facts_owner="origin123456"
    )

    await summarize_files("r", record, cache, "user-a", provider=FakeProvider())

    assert cache.facts.get("origin123456", ["app/m1.py"])["app/m1.py"]["summary"] == "Does the m1.py work."


@pytest.mark.asyncio
async def test_the_record_the_routes_pass_holds_model_objects_and_still_works(monkeypatch):
    """The routes pass the record as built, FileProfile objects and all; the job read them
    as dicts and failed before its first call, leaving no status (live check, 2026-11-15)."""
    from rune.pipeline_models import FileProfile

    cache, record = _setup(monkeypatch, n_files=3)
    record["file_profiles"] = [
        FileProfile(
            path=p["path"],
            name=p["path"].rsplit("/", 1)[-1],
            language="Python",
            size=10,
            role=p["role"],
            role_label=p["role_label"],
            role_confidence=0.9,
            depends_on=[],
            used_by=[],
            in_degree=0,
            out_degree=0,
            importance_score=p["importance_score"],
            tags=[],
        )
        for p in record["file_profiles"]
    ]
    provider = FakeProvider()

    await summarize_files("r", record, cache, "user-a", provider=provider)

    assert cache.get("r")["summaries_status"]["status"] == "complete"
    assert len(provider.batches) == 1


# ── Live check, 2026-11-15: Groq answered the first batch, then 429 with a 42 s wait ──


@pytest.mark.asyncio
async def test_a_rate_limit_stops_the_job_and_keeps_what_was_written(monkeypatch):
    cache, record = _setup(monkeypatch, n_files=60)
    provider = FakeProvider(rate_limit_on=2)

    await summarize_files("r", record, cache, "user-a", provider=provider)

    assert len(provider.batches) == 2  # no third batch queued behind the same limit
    status = cache.get("r")["summaries_status"]
    assert (status["status"], status["summarized"], status["calls"]) == ("rate_limited", 25, 1)
    kept = cache.facts.get("r", ["app/m0.py", "app/m30.py"])
    assert kept["app/m0.py"]["summary"] == "Does the m0.py work."  # the first batch, saved as it landed
    assert "summary" not in kept["app/m30.py"]


def test_each_file_shows_the_gist_of_its_symbols_not_all_of_them():
    symbols = [
        {
            "name": f"f{i}",
            "kind": "function",
            "line": i,
            "complexity": 10 - i,
            "signature": "(" + ", ".join(f"argument_{n}: int" for n in range(8)) + ")",
            "doc": "Does a great many things, " * 10,
        }
        for i in range(8)
    ]
    prompt = build_prompt([("app/big.py", {"purpose": "Big.", "symbols": symbols}, "Core")])
    symbol_lines = [line for line in prompt.splitlines() if line.startswith("- function ")]

    assert len(symbol_lines) == 5
    assert all("…" in line and len(line) < 200 for line in symbol_lines)


@pytest.mark.asyncio
async def test_the_provider_comes_from_the_setting(monkeypatch):
    cache, record = _setup(monkeypatch, n_files=3)
    monkeypatch.setattr(settings, "file_summary_provider", "gemini")
    asked: list[str] = []
    fake = FakeProvider()

    def get_provider(name):
        asked.append(name)
        return fake

    monkeypatch.setattr("rune.llm.providers.get_provider", get_provider)

    await summarize_files("r", record, cache, "user-a")

    assert asked == ["gemini"] and len(fake.batches) == 1
