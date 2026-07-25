"""graph_assembler: container derivation (step 2), flags/insights (step 3),
and assembly/edge-aggregation/portals (step 4).
See docs/superpowers/plans/2026-07-25-graph-phase1-plan.md."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from codekavi.graph_assembler import (
    GOD_FILE_MIN_SIZE,
    HUB_MIN_IN_DEGREE,
    assemble_graph,
    compute_flags,
    compute_insights,
    derive_containers,
)


def test_folder_strategy_groups_by_first_segment_past_common_prefix():
    paths = [
        "src/services/auth.py",
        "src/services/billing.py",
        "src/services/user.py",
        "src/routes/api.py",
        "src/routes/webhook.py",
    ]
    containers = derive_containers("services", paths, adjacency={})

    assert {c["strategy"] for c in containers} == {"folder"}
    by_name = {c["name"]: c["file_ids"] for c in containers}
    assert by_name["services"] == ["src/services/auth.py", "src/services/billing.py", "src/services/user.py"]
    assert by_name["routes"] == ["src/routes/api.py", "src/routes/webhook.py"]


def test_community_fallback_on_flat_structure():
    # All files at repo root -> folder grouping yields exactly one bucket.
    paths = ["a.py", "b.py", "c.py", "d.py", "e.py"]
    adjacency = {
        "a.py": ["b.py"],
        "b.py": ["a.py"],
        "c.py": ["d.py"],
        "d.py": ["c.py"],
    }
    containers = derive_containers("utils", paths, adjacency)

    assert {c["strategy"] for c in containers} == {"community"}
    by_id = {c["id"]: sorted(c["file_ids"]) for c in containers}
    assert sorted(by_id.values()) == [["a.py", "b.py"], ["c.py", "d.py"], ["e.py"]]
    # e.py has no edges -> singleton -> suppressed into "ungrouped" (5 files >= threshold of 3)
    ungrouped = next(c for c in containers if c["name"] == "ungrouped")
    assert ungrouped["file_ids"] == ["e.py"]


def test_community_fallback_when_bucket_exceeds_70_percent():
    paths = ["src/core/a.py", "src/core/b.py", "src/core/c.py", "src/core/d.py", "src/misc/e.py"]
    containers = derive_containers("services", paths, adjacency={})

    assert {c["strategy"] for c in containers} == {"community"}
    total = sum(len(c["file_ids"]) for c in containers)
    assert total == len(paths)


def test_single_child_suppression_exempt_below_three_files():
    paths = ["x/a.py", "y/b.py"]
    containers = derive_containers("misc", paths, adjacency={})

    assert len(containers) == 2
    assert {c["name"] for c in containers} == {"x", "y"}
    assert all(c["strategy"] == "folder" for c in containers)


def test_single_child_suppression_applies_at_three_files():
    paths = ["core/a.py", "core/b.py", "misc/c.py"]
    containers = derive_containers("misc", paths, adjacency={})

    by_name = {c["name"]: c["file_ids"] for c in containers}
    assert by_name["core"] == ["core/a.py", "core/b.py"]
    assert by_name["ungrouped"] == ["misc/c.py"]
    assert "misc" not in by_name


def test_empty_layer_yields_no_containers():
    assert derive_containers("empty", [], adjacency={}) == []


def test_community_assignment_is_stable_across_repeated_runs():
    paths = ["a.py", "b.py", "c.py", "d.py", "e.py"]
    adjacency = {
        "a.py": ["b.py"],
        "b.py": ["a.py"],
        "c.py": ["d.py"],
        "d.py": ["c.py"],
    }
    first = derive_containers("utils", paths, adjacency)
    for _ in range(100):
        assert derive_containers("utils", paths, adjacency) == first


def _profile(path: str, in_degree: int = 0, size: int = 0) -> dict:
    return {"path": path, "in_degree": in_degree, "size": size}


def test_orphan_flag_requires_zero_in_degree_and_not_an_entry_point():
    profiles = [_profile("orphan.py", in_degree=0), _profile("entry.py", in_degree=0)]
    dep_data = {"adjacency": {}, "entry_points": [{"file": "entry.py"}]}

    flags = compute_flags(profiles, dep_data)

    assert flags["orphan.py"] == ["orphan"]
    assert flags["entry.py"] == ["entry_point"]


def test_hub_flag_at_one_below_and_one_above_threshold():
    # 10 filler files at in_degree=12 push the top-5% percentile floor to 12,
    # so min(HUB_MIN_IN_DEGREE, floor) clamps to HUB_MIN_IN_DEGREE == 10.
    filler = [_profile(f"filler{i}.py", in_degree=12) for i in range(10)]
    filler += [_profile(f"low{i}.py", in_degree=1) for i in range(90)]
    boundary = [
        _profile("below.py", in_degree=HUB_MIN_IN_DEGREE - 1),
        _profile("at.py", in_degree=HUB_MIN_IN_DEGREE),
        _profile("above.py", in_degree=HUB_MIN_IN_DEGREE + 1),
    ]
    dep_data: dict = {"adjacency": {}, "entry_points": []}

    flags = compute_flags(filler + boundary, dep_data)

    assert "hub" not in flags["below.py"]
    assert "hub" in flags["at.py"]
    assert "hub" in flags["above.py"]


def test_god_file_flag_at_one_below_and_one_above_threshold():
    # One large filler file pins the top-2% size percentile floor above
    # GOD_FILE_MIN_SIZE, so min(GOD_FILE_MIN_SIZE, floor) clamps to GOD_FILE_MIN_SIZE.
    filler = [_profile(f"filler{i}.py", size=100) for i in range(50)]
    filler.append(_profile("huge.py", size=GOD_FILE_MIN_SIZE * 2))
    boundary = [
        _profile("below.py", size=GOD_FILE_MIN_SIZE - 1),
        _profile("at.py", size=GOD_FILE_MIN_SIZE),
        _profile("above.py", size=GOD_FILE_MIN_SIZE + 1),
    ]
    dep_data: dict = {"adjacency": {}, "entry_points": []}

    flags = compute_flags(filler + boundary, dep_data)

    assert "god_file" not in flags["below.py"]
    assert "god_file" in flags["at.py"]
    assert "god_file" in flags["above.py"]


def test_in_cycle_flag_matches_detected_cycles():
    # in_degree=1 on each so the orphan check doesn't also fire here — that's
    # covered separately by test_orphan_flag_requires_zero_in_degree_and_not_an_entry_point.
    # Filler keeps the hub percentile floor from trivially catching these low-in_degree files.
    filler = [_profile(f"filler{i}.py", in_degree=12) for i in range(10)]
    profiles = [
        *filler,
        _profile("a.py", in_degree=1),
        _profile("b.py", in_degree=1),
        _profile("c.py", in_degree=1),
    ]
    dep_data = {
        "adjacency": {"a.py": ["b.py"], "b.py": ["a.py"], "c.py": []},
        "entry_points": [],
    }

    flags = compute_flags(profiles, dep_data)

    assert flags["a.py"] == ["in_cycle"]
    assert flags["b.py"] == ["in_cycle"]
    assert flags["c.py"] == []


def test_file_with_no_active_flags_yields_empty_list():
    # Filler population needed: percentile thresholds computed over a single
    # profile trivially flag that same profile as top-5%/top-2%.
    filler = [_profile(f"filler{i}.py", in_degree=12) for i in range(10)]
    filler += [_profile(f"low{i}.py", in_degree=1, size=100) for i in range(90)]
    filler.append(_profile("huge.py", size=GOD_FILE_MIN_SIZE * 2))
    plain = _profile("plain.py", in_degree=1, size=10)
    dep_data: dict = {"adjacency": {}, "entry_points": []}

    flags = compute_flags([*filler, plain], dep_data)

    assert flags["plain.py"] == []


def test_flag_order_is_stable_regardless_of_which_flags_are_active():
    profiles = [_profile(f"filler{i}.py", in_degree=12) for i in range(10)]
    profiles.append(_profile("multi.py", in_degree=HUB_MIN_IN_DEGREE, size=GOD_FILE_MIN_SIZE))
    dep_data = {
        "adjacency": {"multi.py": ["filler0.py"], "filler0.py": ["multi.py"]},
        "entry_points": [],
    }

    flags = compute_flags(profiles, dep_data)

    assert flags["multi.py"] == ["in_cycle", "hub", "god_file"]


def test_compute_insights_rolls_up_cycles_orphans_central_and_entry_points():
    dep_data = {
        "adjacency": {"a.py": ["b.py"], "b.py": ["a.py"], "c.py": []},
        "entry_points": [{"file": "c.py"}],
        "central_files": [{"file": "a.py"}],
    }
    flags_by_path = {"a.py": ["in_cycle"], "b.py": ["in_cycle"], "orphan.py": ["orphan"]}

    insights = compute_insights(dep_data, flags_by_path)

    assert insights["cycles"] == [["a.py", "b.py", "a.py"]]
    assert insights["orphans"] == ["orphan.py"]
    assert insights["central"] == ["a.py"]
    assert insights["entry_points"] == ["c.py"]


def _assembler_profile(path: str, role: str, in_degree: int = 0, out_degree: int = 0) -> dict:
    return {
        "path": path,
        "name": path.rsplit("/", 1)[-1],
        "role": role,
        "role_label": role,
        "size": 100,
        "in_degree": in_degree,
        "out_degree": out_degree,
        "importance_score": 0.5,
        "language": "python",
    }


def test_assemble_graph_scopes_containers_per_layer_and_attaches_flags():
    # Step 4 work items 3 & 4: "containers per layer" and "files with flags".
    file_profiles = [
        _assembler_profile("api/routes/a.py", "router", in_degree=1),
        _assembler_profile("api/routes/b.py", "router", in_degree=0, out_degree=1),
        _assembler_profile("api/utils/c.py", "shared_utility", in_degree=1),
    ]
    dep_data = {
        "edges": [{"source": "api/routes/b.py", "target": "api/routes/a.py"}],
        "adjacency": {"api/routes/b.py": ["api/routes/a.py"]},
        "reverse_adjacency": {"api/routes/a.py": ["api/routes/b.py"]},
        "entry_points": [],
        "central_files": [],
    }

    result = assemble_graph({"dep_data": dep_data, "file_profiles": file_profiles})
    files_by_path = {f["path"]: f for f in result["files"]}

    # Containers are derived per layer: the two "routes" files share a container
    # that is distinct from the "utils" file's container, even though a naive
    # global grouping could have merged them.
    assert files_by_path["api/routes/a.py"]["layer_id"] == "routes"
    assert files_by_path["api/utils/c.py"]["layer_id"] == "utils"
    routes_container = files_by_path["api/routes/a.py"]["container_id"]
    utils_container = files_by_path["api/utils/c.py"]["container_id"]
    assert files_by_path["api/routes/b.py"]["container_id"] == routes_container
    assert routes_container != utils_container
    assert {c["id"] for c in result["containers"]} == {routes_container, utils_container}

    # Per-file flags (step 3) are carried onto each file entry.
    assert "orphan" in files_by_path["api/routes/b.py"]["flags"]
    assert "orphan" not in files_by_path["api/routes/a.py"]["flags"]


def _cross_layer_result() -> dict:
    file_profiles = [
        _assembler_profile("api/routes/a.py", "router", in_degree=1),
        _assembler_profile("api/routes/b.py", "router", in_degree=0, out_degree=1),
        _assembler_profile("api/utils/c.py", "shared_utility", in_degree=1),
    ]
    dep_data = {
        "edges": [
            {"source": "api/routes/b.py", "target": "api/routes/a.py"},  # same layer, same container
            {"source": "api/routes/a.py", "target": "api/utils/c.py"},  # crosses layer + container
            {"source": "api/routes/a.py", "target": "api/utils/c.py"},  # duplicate raw edge -> count 2
            {"source": "api/routes/a.py", "target": "api/routes/a.py"},  # self-edge, must be dropped
        ],
        "adjacency": {"api/routes/b.py": ["api/routes/a.py"]},
        "reverse_adjacency": {"api/routes/a.py": ["api/routes/b.py"]},
        "entry_points": [],
        "central_files": [],
    }
    return assemble_graph({"dep_data": dep_data, "file_profiles": file_profiles})


def test_assemble_graph_aggregates_edges_at_all_three_levels_without_self_or_duplicate_edges():
    # Step 4 work item 5: edges pre-aggregated at file, container, and layer level.
    result = _cross_layer_result()

    assert not any(e["source"] == e["target"] for e in result["edges"])
    keys = [(e["source"], e["target"], e["level"]) for e in result["edges"]]
    assert len(keys) == len(set(keys))

    by_level = {level: [e for e in result["edges"] if e["level"] == level] for level in ("file", "container", "layer")}
    assert {(e["source"], e["target"], e["count"]) for e in by_level["file"]} == {
        ("api/routes/b.py", "api/routes/a.py", 1),
        ("api/routes/a.py", "api/utils/c.py", 2),
    }
    # container/layer level count == sum of the underlying file edges that cross them;
    # the routes-internal b->a edge doesn't cross either boundary, so it contributes nothing.
    assert [(e["source"], e["target"], e["count"]) for e in by_level["container"]] == [
        (
            next(f["container_id"] for f in result["files"] if f["path"] == "api/routes/a.py"),
            next(f["container_id"] for f in result["files"] if f["path"] == "api/utils/c.py"),
            2,
        )
    ]
    assert [(e["source"], e["target"], e["count"]) for e in by_level["layer"]] == [("routes", "utils", 2)]


def test_assemble_graph_portals_mirror_layer_level_edge_counts():
    # Step 4 work item 6: portals are the cross-layer connection counts.
    result = _cross_layer_result()

    assert result["portals"] == [{"from_layer": "routes", "to_layer": "utils", "connection_count": 2}]


def test_assemble_graph_every_file_has_exactly_one_existing_layer_and_container():
    result = _cross_layer_result()

    layer_ids = {layer["id"] for layer in result["layers"]}
    container_ids = {c["id"] for c in result["containers"]}
    for f in result["files"]:
        assert f["layer_id"] in layer_ids
        assert f["container_id"] in container_ids


def test_assemble_graph_fingerprint_present_with_no_generated_at():
    # Step 4 work item 7: fingerprint from fingerprint.py, no generated_at anywhere
    # in the payload -- a timestamp would break byte-determinism and the ETag.
    result = _cross_layer_result()

    assert isinstance(result["fingerprint"], str) and result["fingerprint"]
    assert "generated_at" not in result
    assert all("generated_at" not in f for f in result["files"])
    assert _cross_layer_result() == result


_DETERMINISM_PAYLOAD = {
    "dep_data": {
        "edges": [
            {"source": "a.py", "target": "b.py"},
            {"source": "b.py", "target": "a.py"},
            {"source": "c.py", "target": "d.py"},
            {"source": "d.py", "target": "c.py"},
            {"source": "e.py", "target": "a.py"},
        ],
        "adjacency": {
            "a.py": ["b.py"],
            "b.py": ["a.py"],
            "c.py": ["d.py"],
            "d.py": ["c.py"],
            "e.py": ["a.py"],
        },
        "reverse_adjacency": {"b.py": ["a.py"], "a.py": ["b.py", "e.py"], "d.py": ["c.py"], "c.py": ["d.py"]},
        "entry_points": [{"file": "e.py"}],
        "central_files": [{"file": "a.py"}],
    },
    "file_profiles": [
        _assembler_profile("a.py", "shared_utility", in_degree=2, out_degree=1),
        _assembler_profile("b.py", "shared_utility", in_degree=1, out_degree=1),
        _assembler_profile("c.py", "shared_utility", in_degree=1, out_degree=1),
        _assembler_profile("d.py", "shared_utility", in_degree=1, out_degree=1),
        _assembler_profile("e.py", "shared_utility", in_degree=0, out_degree=1),
    ],
}


def _run_assemble_in_subprocess(seed: str) -> str:
    backend_root = Path(__file__).resolve().parents[1]
    script = (
        "import json, sys\n"
        "from codekavi.graph_assembler import assemble_graph\n"
        "payload = json.loads(sys.stdin.read())\n"
        "print(json.dumps(assemble_graph(payload), sort_keys=True))\n"
    )
    env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(backend_root)}
    proc = subprocess.run(
        [sys.executable, "-c", script],
        input=json.dumps(_DETERMINISM_PAYLOAD),
        env=env,
        cwd=backend_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout


@pytest.mark.parametrize("seed", ["0", "1", "42"])
def test_assembler_stable_across_hash_seeds(seed):
    # The determinism gate (step 4): PYTHONHASHSEED is fixed at interpreter
    # start, so asserting twice inside one process proves nothing -- this must
    # run in a subprocess per seed and compare against a baseline subprocess.
    baseline = _run_assemble_in_subprocess("0")
    output = _run_assemble_in_subprocess(seed)
    assert output == baseline
