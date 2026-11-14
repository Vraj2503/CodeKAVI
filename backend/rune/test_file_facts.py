"""T33: per-function complexity and one purpose line per file, from the parse already done."""

import pytest

from rune.classifier import classify_files
from rune.complexity import file_complexity
from rune.file_facts import MAX_PURPOSE_CHARS, derived_purpose, purpose_of
from rune.pipeline_models import DepGraph, FileEntry


def _symbols(source: str, path: str) -> dict[str, dict]:
    return {s["name"]: s for s in file_complexity(source, path, with_symbols=True)["symbols"]}


def _doc(source: str, path: str) -> str | None:
    return file_complexity(source, path, with_symbols=True)["doc"]


# ── Per-function complexity ──

_PY = """\
def f(items):
    if items:
        return 1
    for item in items:
        pass
    return 0


def g(flag):
    return flag and 1


def outer(z):
    def inner(x):
        if x:
            return 1
    if z:
        return inner(z)


if __name__ == "__main__":
    f([])
"""


def test_each_function_counts_its_own_branches():
    symbols = _symbols(_PY, "a.py")
    assert symbols["f"]["complexity"] == 3  # if + for
    assert symbols["g"]["complexity"] == 2  # `and`
    assert symbols["inner"]["complexity"] == 2  # its own `if`, not counted again for outer
    assert symbols["outer"]["complexity"] == 2


def test_the_functions_branches_plus_the_top_level_ones_are_the_files_count():
    metrics = file_complexity(_PY, "a.py", with_symbols=True)
    top_level = 1  # `if __name__ == "__main__"`
    assert sum(s["complexity"] - 1 for s in metrics["symbols"]) + top_level == metrics["complexity"] - 1


def test_js_functions_count_ternaries_and_short_circuits():
    symbols = _symbols("function pick(a, b) {\n  if (a) { return b ?? 1; }\n  return a ? 1 : 2;\n}\n", "a.ts")
    assert symbols["pick"]["complexity"] == 4  # if, ??, ?:


# ── What a file says it is for ──


def test_a_python_module_docstring_is_the_files_doc():
    src = '"""routes/chat.py — RAG chat endpoint.\n\nEndpoints:\n    POST /chat\n"""\n\nimport os\n'
    assert _doc(src, "routes/chat.py") == "routes/chat.py — RAG chat endpoint."


def test_a_python_header_comment_counts_when_there_is_no_docstring():
    assert (
        _doc("#!/usr/bin/env python\n# Clone helpers for the CLI.\nimport os\n", "cli.py")
        == "Clone helpers for the CLI."
    )


def test_a_js_header_comment_survives_a_directive_and_skips_the_license():
    src = (
        '"use client";\n\n'
        "/* Copyright 2024 Acme. Licensed under the MIT License. */\n\n"
        "// The concentric radar view.\n"
        "// Draws tiers as rings.\n"
        'import { x } from "y";\n'
    )
    assert _doc(src, "Radar.tsx") == "The concentric radar view."


def test_a_line_comment_license_is_skipped_whole():
    src = (
        "# Copyright 2024 Acme Inc.\n"
        "# Distributed WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.\n"
        "# Licensed under the Apache License, Version 2.0.\n"
        "\n"
        "# Schedules the nightly jobs.\n"
        "import os\n"
    )
    assert _doc(src, "jobs.py") == "Schedules the nightly jobs."


def test_lint_and_license_headers_alone_are_no_doc():
    src = "/* eslint-disable react/no-danger */\n// @ts-nocheck\nimport x from 'y';\n"
    assert _doc(src, "a.ts") is None


def test_a_comment_after_the_first_statement_is_not_the_files_doc():
    assert _doc("import os\n\n# This explains the next line only.\nX = 1\n", "a.py") is None


# ── Purpose lines ──


def test_the_doc_wins_and_loses_its_path_prefix():
    purpose = purpose_of("backend/rune/routes/analyze.py", "routes/analyze.py — Repo analysis endpoints.", [])
    assert purpose == ("Repo analysis endpoints.", "doc")


def test_routes_are_a_handlers_purpose():
    symbols = [
        {
            "name": "chat",
            "kind": "function",
            "line": 3,
            "end_line": 9,
            "decorators": ['@router.post("/chat/{repo_id}")'],
        },
        {
            "name": "drop",
            "kind": "function",
            "line": 11,
            "end_line": 14,
            "decorators": ['@router.delete("/session/{sid}")'],
        },
    ]
    assert purpose_of("routes/chat.py", None, symbols) == (
        "Routes: POST /chat/{repo_id}, DELETE /session/{sid}",
        "derived",
    )


def test_a_license_only_tsx_file_gets_its_component_name():
    src = "/* Copyright 2024 Acme. All rights reserved. */\nexport function TreemapViz({ data }) {\n  return null;\n}\n"
    metrics = file_complexity(src, "components/TreemapViz.tsx", with_symbols=True)
    assert purpose_of("components/TreemapViz.tsx", metrics["doc"], metrics["symbols"]) == (
        "Component: TreemapViz",
        "derived",
    )


def test_hooks_and_plain_definitions():
    hook = [{"name": "useKnowledgeLayout", "kind": "function", "line": 1, "end_line": 20}]
    module = [
        {"name": "clone_repo", "kind": "function", "line": 1, "end_line": 9},
        {"name": "_retry", "kind": "function", "line": 3, "end_line": 5},  # nested and private
        {"name": "parse_repo_url", "kind": "function", "line": 11, "end_line": 15},
        {"name": "RepoInfo", "kind": "class", "line": 17, "end_line": 30},
        {"name": "url", "kind": "method", "line": 20, "end_line": 22},
    ]
    assert derived_purpose("hooks/useKnowledgeLayout.ts", hook) == "Hook: useKnowledgeLayout"
    assert derived_purpose("rune/cloner.py", module) == "Defines: clone_repo, parse_repo_url, RepoInfo"


def test_a_purpose_is_one_short_line():
    long_doc = "Does " + "many things, " * 30 + "really."
    purpose, _ = purpose_of("a.py", long_doc, [])
    assert purpose is not None
    assert len(purpose) == MAX_PURPOSE_CHARS and purpose.endswith("…")


def test_a_file_with_nothing_to_say_has_no_purpose():
    assert purpose_of("a.py", None, []) == (None, None)


# ── Through the classifier ──


def _entry(path: str, content: str, language: str) -> FileEntry:
    return FileEntry(
        path=path,
        name=path.rsplit("/", 1)[-1],
        extension="." + path.rsplit(".", 1)[-1],
        language=language,
        size=len(content),
        size_formatted=f"{len(content)} B",
        depth=path.count("/"),
        mtime=0.0,
        content=content,
    )


@pytest.mark.parametrize("with_symbols", [True, False])
def test_classify_files_fills_facts_out_for_parsed_files(tmp_path, with_symbols):
    files = [
        _entry("app/routes.py", '"""Serves the public API."""\n\ndef ping():\n    return 1\n', "Python"),
        _entry("ui/Chart.tsx", "export function Chart() {\n  return null;\n}\n", "TypeScript"),
        _entry("notes.md", "# Notes\n", "Markdown"),
    ]
    facts: dict[str, dict] = {}
    symbols: dict[str, list] | None = {} if with_symbols else None
    empty = DepGraph(
        edges=[],
        adjacency={},
        reverse_adjacency={},
        file_imports={},
        entry_points=[],
        file_signals={},
        central_files=[],
        stats={},
    )
    classify_files(str(tmp_path), files, empty, symbols_out=symbols, facts_out=facts)

    assert facts == {
        "app/routes.py": {"purpose": "Serves the public API.", "purpose_source": "doc"},
        "ui/Chart.tsx": {"purpose": "Component: Chart", "purpose_source": "derived"},
    }


def test_classify_files_records_the_routes_a_file_serves(tmp_path):
    src = '"""Chat endpoints."""\n\n\n@router.post("/chat/{repo_id}")\nasync def chat(repo_id):\n    return 1\n'
    facts: dict[str, dict] = {}
    empty = DepGraph(
        edges=[],
        adjacency={},
        reverse_adjacency={},
        file_imports={},
        entry_points=[],
        file_signals={},
        central_files=[],
        stats={},
    )
    classify_files(str(tmp_path), [_entry("routes/chat.py", src, "Python")], empty, facts_out=facts)

    assert facts["routes/chat.py"] == {
        "purpose": "Chat endpoints.",
        "purpose_source": "doc",
        "routes": ["POST /chat/{repo_id}"],
    }
