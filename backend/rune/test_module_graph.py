"""T32: modules grouped as deep as each repo needs, not always by top-level folder.

At depth 1 CodeKAVI was four modules (frontend, backend, docs, root files) with no
links between them: every import stays inside its own half.
"""

from collections import Counter

from rune.graph import MODULE_MAX_COUNT, build_module_graph, choose_modules


def _codekavi_like() -> list[str]:
    paths = ["README.md", "docs/plan.md", "backend/main.py"]
    paths += [f"backend/rune/m{i}.py" for i in range(30)]
    paths += [f"backend/rune/routes/r{i}.py" for i in range(6)]
    paths += [f"frontend/components/report/c{i}.tsx" for i in range(25)]
    paths += [f"frontend/components/ui/u{i}.tsx" for i in range(8)]
    paths += [f"frontend/lib/l{i}.ts" for i in range(20)]
    paths += [f"frontend/app/p{i}.tsx" for i in range(6)]
    return paths


def test_a_two_halves_repo_is_split_until_no_module_dominates():
    paths = _codekavi_like()
    chosen = choose_modules(paths)
    modules = Counter(chosen.values())

    assert {"backend/rune", "backend/rune/routes", "frontend/components/report", "frontend/lib"} <= set(modules)
    assert "backend" in modules and modules["backend"] == 1  # main.py, beside the rune package
    assert "frontend" not in modules  # everything in it went to a subfolder
    # What's still above the share can't split: its files sit directly in its folder.
    for name, count in modules.items():
        if count > 0.2 * len(paths):
            assert all(path.rsplit("/", 1)[0] == name for path, module in chosen.items() if module == name)


def test_the_split_shows_links_the_top_level_hid():
    paths = _codekavi_like()
    edges = [
        {"source": "backend/rune/routes/r0.py", "target": "backend/rune/m0.py"},
        {"source": "backend/main.py", "target": "backend/rune/routes/r1.py"},
        {"source": "frontend/app/p0.tsx", "target": "frontend/lib/l0.ts"},
    ]
    before = build_module_graph({"edges": edges}, [{"path": p} for p in paths], depth=1)
    after = build_module_graph({"edges": edges}, [{"path": p} for p in paths])

    assert before["connections"] == []
    assert {(c["source"], c["target"]) for c in after["connections"]} == {
        ("backend/rune/routes", "backend/rune"),
        ("backend", "backend/rune/routes"),
        ("frontend/app", "frontend/lib"),
    }
    assert before["grouping"] == {"depth": 1}
    assert after["grouping"]["strategy"] == "split_largest"


def test_a_flat_repo_stays_at_its_top_level_folders():
    paths = [f"src/f{i}.py" for i in range(10)] + ["tests/test_f.py", "setup.py"]
    assert set(choose_modules(paths).values()) == {"src", "tests", "(root)"}


def test_a_folder_with_one_subfolder_descends_into_it():
    paths = ["pkg/core/a.py", "pkg/core/b.py", "pkg/core/io/c.py", "pkg/core/io/d.py", "docs/x.md", "README.md"]
    assert choose_modules(paths) == {
        "pkg/core/a.py": "pkg/core",
        "pkg/core/b.py": "pkg/core",
        "pkg/core/io/c.py": "pkg/core/io",
        "pkg/core/io/d.py": "pkg/core/io",
        "docs/x.md": "docs",
        "README.md": "(root)",
    }


def test_splitting_never_passes_the_module_cap():
    paths = [f"big/sub{i}/f{j}.py" for i in range(60) for j in range(3)]
    modules = set(choose_modules(paths).values())

    assert len(modules) <= MODULE_MAX_COUNT
    assert modules == {"big"}  # 60 subfolders would pass the cap, so it stays whole
