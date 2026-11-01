"""The imports the dataflow LLM is shown (T20).

They used to be the first 30 files in dict order with only the first import of
each (`[:1]`), as bare `a -> b` pairs: on CodeKAVI, 30 of 383 edges, chosen
alphabetically, saying nothing about what any file does, while the prompt
asked the model to cite files "from the provided file roles" — which listed
counts, not paths.
"""

from typing import Any

from rune.llm.prompts import build_dataflow_prompt
from rune.routes.visualize import (
    DATAFLOW_MAX_IMPORT_LINES,
    DATAFLOW_MAX_IMPORTS_PER_FILE,
    _dataflow_import_lines,
)

ROLE_LABELS = {
    "entry_point": "Entry Point",
    "router": "Router / Routes",
    "core_module": "Core Module",
    "type_definition": "Type / Model Definition",
    "leaf": "Standalone / Leaf",
    "test": "Test",
}


def _profile(path: str, role: str = "leaf", importance: float = 0.0) -> dict[str, Any]:
    return {"path": path, "role": role, "role_label": ROLE_LABELS[role], "importance_score": importance}


def test_a_source_with_three_targets_contributes_three_labelled_lines():
    dep_data = {"adjacency": {"api/routes.py": ["src/fmt.py", "services/billing.py", "app/models.py"]}}
    profiles = [
        _profile("api/routes.py", "router", 9),
        _profile("services/billing.py", "core_module", 3),
        _profile("app/models.py", "type_definition", 2),
        _profile("src/fmt.py", "leaf", 1),  # no architectural role, no layer word
    ]

    assert _dataflow_import_lines(dep_data, profiles) == [
        "api/routes.py [Router / Routes] -> services/billing.py [Core Module]",
        "api/routes.py [Router / Routes] -> app/models.py [Type / Model Definition]",
        "api/routes.py [Router / Routes] -> src/fmt.py",
    ]


def test_a_leaf_role_falls_back_to_the_layer_its_path_names():
    dep_data = {"adjacency": {"backend/routes/chat.py": ["backend/utils/text.py"]}}
    profiles = [_profile("backend/routes/chat.py"), _profile("backend/utils/text.py")]

    assert _dataflow_import_lines(dep_data, profiles) == [
        "backend/routes/chat.py [routes] -> backend/utils/text.py [utils]"
    ]


def test_entry_points_come_first_then_files_by_importance():
    dep_data = {
        "adjacency": {"a.py": ["x.py"], "b.py": ["x.py"], "main.py": ["x.py"]},
        "entry_points": [{"file": "main.py"}],
    }
    profiles = [_profile("a.py", importance=1), _profile("b.py", importance=5), _profile("main.py", "entry_point")]

    sources = [line.split(" ")[0] for line in _dataflow_import_lines(dep_data, profiles)]

    assert sources == ["main.py", "b.py", "a.py"]


def test_test_files_are_left_out_at_both_ends():
    dep_data = {
        "adjacency": {
            "tests/test_app.py": ["app.py"],  # a test as the importer
            "app.py": ["tests/helpers.py", "db.py"],  # a test as the imported
        },
        "entry_points": [{"file": "tests/test_app.py"}],  # analyzers mark runnable tests as entry points
    }
    profiles = [_profile("app.py"), _profile("db.py")]

    assert _dataflow_import_lines(dep_data, profiles) == ["app.py -> db.py [database]"]


def test_each_file_shows_its_most_important_imports_up_to_the_cap():
    targets = [f"lib/m{i}.py" for i in range(DATAFLOW_MAX_IMPORTS_PER_FILE + 4)]
    dep_data = {"adjacency": {"app.py": targets}}
    profiles = [_profile("app.py")] + [_profile(t, importance=i) for i, t in enumerate(targets)]

    lines = _dataflow_import_lines(dep_data, profiles)

    assert len(lines) == DATAFLOW_MAX_IMPORTS_PER_FILE
    assert lines[0] == f"app.py -> {targets[-1]} [utils]"  # the most important target first


def test_the_whole_sample_is_capped():
    adjacency = {f"src/f{i:03}.py": [f"src/g{i:03}.py", f"src/h{i:03}.py"] for i in range(DATAFLOW_MAX_IMPORT_LINES)}

    assert len(_dataflow_import_lines({"adjacency": adjacency}, [])) == DATAFLOW_MAX_IMPORT_LINES


def test_unserialized_sets_of_targets_give_a_stable_order():
    dep_data = {"adjacency": {"app.py": {"c.py", "a.py", "b.py"}}}

    assert _dataflow_import_lines(dep_data, []) == ["app.py -> a.py", "app.py -> b.py", "app.py -> c.py"]


def test_the_prompt_carries_every_line_it_is_given_and_asks_for_those_paths():
    lines = [f"src/f{i:03}.py -> src/g{i:03}.py" for i in range(DATAFLOW_MAX_IMPORT_LINES)]

    prompt = build_dataflow_prompt(
        entry_points=["main.py"],
        role_summary={"core_module": 3},
        adjacency_summary=lines,
        languages=["Python"],
        repo_type="web_app",
    )

    assert all(f"  - {line}" in prompt for line in lines)  # no longer cut at 30
    assert "exactly as they appear in the entry points and imports above" in prompt
