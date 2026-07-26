"""IMPL-13 contract: /analyze and /analyze/stream both shape their response
from the same _run_pipeline() result, so for the same repo they must return
identical graph/module_graph/cycles/mermaid. See Order of implementation.txt F3.
"""

import json

import pytest
from fastapi import BackgroundTasks

from codekavi.fingerprint import ChangeClassification
from codekavi.pipeline_models import DepGraph, FileEntry, RepoData
from codekavi.routes import analyze as analyze_module
from codekavi.schemas import AnalyzeRequest


def _repo_data() -> RepoData:
    f = FileEntry(
        path="a.py",
        name="a.py",
        extension=".py",
        language="python",
        size=10,
        size_formatted="10 B",
        depth=0,
        mtime=0.0,
    )
    return RepoData(
        total_files=1,
        total_size=10,
        total_size_formatted="10 B",
        languages={"python": 1},
        tree=[],
        files=[f],
        skipped_files=[],
    )


def _dep_graph() -> DepGraph:
    return DepGraph(
        edges=[{"source": "a.py", "target": "b.py"}],
        adjacency={},
        reverse_adjacency={},
        file_imports={},
        entry_points=[],
        file_signals={},
        central_files=[],
        stats={},
    )


class _FakeTaskRegistry:
    def wrap(self, fn):
        return fn


class _FakeAppState:
    task_registry = _FakeTaskRegistry()


class _FakeApp:
    state = _FakeAppState()


class _FakeRequest:
    app = _FakeApp()

    async def is_disconnected(self) -> bool:
        return False


class _FakeCache:
    def lookup_by_signature(self, signature):
        return None

    def register_signature(self, signature, repo_id):
        pass


@pytest.fixture(autouse=True)
def _patch_pipeline_stages(monkeypatch):
    """Stub every I/O-bound stage _run_pipeline calls with fixed, deterministic
    output so both routes run the identical real pipeline code against the
    same fake repo."""
    monkeypatch.setattr(
        analyze_module,
        "clone_repo",
        lambda url: {
            "repo_id": "repo-fixed",
            "repo_name": "r",
            "owner": "o",
            "clone_path": "/tmp/fake-clone",
            "repo_signature": None,
        },
    )
    monkeypatch.setattr(analyze_module, "traverse_repo", lambda path: _repo_data())
    monkeypatch.setattr(analyze_module, "analyze_dependencies", lambda *a, **k: _dep_graph())
    monkeypatch.setattr(analyze_module, "classify_files", lambda *a, **k: [])
    monkeypatch.setattr(analyze_module, "summarize_roles", lambda profiles: {"total": 0})
    monkeypatch.setattr(analyze_module, "select_nn_candidates", lambda *a, **k: [])
    monkeypatch.setattr(
        analyze_module,
        "export_graph_json",
        lambda *a, **k: {"nodes": [{"id": "a.py"}, {"id": "b.py"}], "edges": [{"source": "a.py", "target": "b.py"}]},
    )
    monkeypatch.setattr(
        analyze_module,
        "build_module_graph",
        lambda *a, **k: {"modules": ["a", "b"], "mermaid": "graph TD; a-->b"},
    )
    monkeypatch.setattr(
        analyze_module,
        "detect_cycles",
        lambda *a, **k: {"has_cycles": False, "cycles": [], "summary": "no cycles"},
    )
    monkeypatch.setattr(analyze_module, "export_mermaid", lambda *a, **k: "graph TD; a.py-->b.py")

    class _FakeSelector:
        def select_files(self, *a, **k):
            return ["a.py"]

    monkeypatch.setattr(analyze_module, "SmartFileSelector", _FakeSelector)

    # save_fingerprints/compare_and_classify_repo are imported locally inside
    # _run_pipeline / analyze_stream at call time, so patch the source module.
    monkeypatch.setattr("codekavi.fingerprint.save_fingerprints", lambda *a, **k: None)
    monkeypatch.setattr(
        "codekavi.fingerprint.compare_and_classify_repo",
        lambda *a, **k: ({}, set(), ChangeClassification.FULL_UPDATE),
    )


async def _collect_stream_result(resp) -> dict:
    body = b""
    async for chunk in resp.body_iterator:
        body += chunk.encode() if isinstance(chunk, str) else chunk
    for line in body.decode().split("\n\n"):
        if line.startswith("id:"):
            _, _, data_line = line.partition("\n")
        else:
            data_line = line
        if not data_line.startswith("data:"):
            continue
        payload = json.loads(data_line[len("data:") :].strip())
        if payload["stage"] == "complete":
            return payload["data"]["result"]
    raise AssertionError("stream never emitted a 'complete' event")


@pytest.mark.asyncio
async def test_analyze_and_stream_return_identical_graph_and_mermaid():
    body = AnalyzeRequest(github_url="https://github.com/o/r")

    non_stream = await analyze_module.analyze(
        request=_FakeRequest(),
        body=body,
        background_tasks=BackgroundTasks(),
        cache=_FakeCache(),
        user_id="user-a",
    )

    stream_response = await analyze_module.analyze_stream(
        request=_FakeRequest(),
        body=body,
        background_tasks=BackgroundTasks(),
        cache=_FakeCache(),
        user_id="user-a",
    )
    stream_result = await _collect_stream_result(stream_response)

    for key in ("graph", "module_graph", "cycles", "mermaid"):
        assert non_stream[key] == stream_result[key], f"{key} diverged between /analyze and /analyze/stream"
