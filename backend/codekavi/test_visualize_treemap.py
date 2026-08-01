"""
Tests for the complexity treemap payload builder.

The treemap previously shipped a flat list of basenames, which made a tile
labelled `index.ts` unactionable when five of them existed and hid which
directory actually carried the weight. These cover the tree shape, the
single-child collapse, and the invariants the frontend depends on.
"""

import json

from codekavi.routes.visualize import _build_treemap_tree


def _profile(path: str, size: int = 10, **extra) -> dict:
    return {"path": path, "size": size, **extra}


def _dirs(node: dict) -> dict[str, dict]:
    return {c["name"]: c for c in node["children"] if "children" in c}


def _leaves(node: dict) -> dict[str, dict]:
    return {c["name"]: c for c in node["children"] if "children" not in c}


def test_nests_files_under_their_directories():
    tree = _build_treemap_tree(
        [
            _profile("src/api/routes.ts"),
            _profile("src/api/models.ts"),
            _profile("src/web/page.tsx"),
        ]
    )
    api = _dirs(_dirs(tree)["src"])["api"]
    assert sorted(_leaves(api)) == ["models.ts", "routes.ts"]


def test_leaves_keep_full_path_so_duplicate_basenames_stay_distinct():
    tree = _build_treemap_tree([_profile("frontend/lib/index.ts"), _profile("frontend/hooks/index.ts")])
    frontend = _dirs(tree)["frontend"]
    paths = {leaf["path"] for d in _dirs(frontend).values() for leaf in _leaves(d).values()}
    assert paths == {"frontend/lib/index.ts", "frontend/hooks/index.ts"}


def test_collapses_single_child_directory_chains():
    """`a/b/c/f.ts` with no branching becomes one node, not three header bands."""
    tree = _build_treemap_tree([_profile("backend/codekavi/routes/visualize.py")])
    assert list(_dirs(tree)) == ["backend/codekavi/routes"]


def test_does_not_collapse_a_branching_chain():
    tree = _build_treemap_tree([_profile("src/api/a.ts"), _profile("src/web/b.ts")])
    assert list(_dirs(tree)) == ["src"]
    assert sorted(_dirs(_dirs(tree)["src"])) == ["api", "web"]


def test_root_is_never_collapsed_into_its_only_child():
    """Otherwise a repo with everything under src/ loses its own identity."""
    tree = _build_treemap_tree([_profile("src/a.ts"), _profile("src/b.ts")])
    assert tree["name"] == ""  # caller fills in the repo name
    assert list(_dirs(tree)) == ["src"]


def test_normalizes_windows_separators_on_both_nodes_and_leaves():
    tree = _build_treemap_tree([_profile("frontend\\lib\\utils.ts")])
    lib = _dirs(tree)["frontend/lib"]
    assert _leaves(lib)["utils.ts"]["path"] == "frontend/lib/utils.ts"


def test_files_at_repo_root_are_leaves_of_root():
    tree = _build_treemap_tree([_profile("README.md"), _profile("src/a.ts")])
    assert "README.md" in _leaves(tree)
    assert "src" in _dirs(tree)


def test_skips_profiles_with_missing_or_empty_path():
    tree = _build_treemap_tree([_profile(""), {"size": 5}, _profile("ok.ts")])
    assert list(_leaves(tree)) == ["ok.ts"]


def test_handles_empty_input():
    assert _build_treemap_tree([])["children"] == []


def test_value_falls_back_when_size_is_missing_or_zero():
    """A zero-area tile is invisible and unhoverable — never emit one."""
    tree = _build_treemap_tree([{"path": "a.ts"}, {"path": "b.ts", "size": 0}])
    assert all(leaf["value"] >= 1 for leaf in _leaves(tree).values())


def test_build_index_never_reaches_the_wire():
    """`_dirs` is a build-time lookup; serializing it would bloat the payload."""
    tree = _build_treemap_tree([_profile("a/b/c.ts"), _profile("a/d.ts"), _profile("e.ts")])
    assert "_dirs" not in json.dumps(tree)
