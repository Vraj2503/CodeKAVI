"""The learn tour starts where execution starts and walks the layers in reading order.

On CodeKAVI it opened on .gitignore: every file nothing imports was a step (57 of 72),
and the steps were ordered by layer tiers that layer-to-layer import cycles had made
arbitrary (uncategorized 35, utils 36, routes 37).
"""

from rune.graph_assembler import _assign_layers
from rune.tour_generator import generate_learn_tour


def _file(path, layer, importance, flags=(), role="leaf"):
    return {"id": path, "layer_id": layer, "importance": importance, "flags": list(flags), "role": role}


def test_the_first_step_is_the_entry_point_whatever_the_layer_tiers_say():
    graph = {
        # Tiers as cycles leave them: uncategorized above utils above routes.
        "layers": [
            {"id": "other", "tier": 0},
            {"id": "utils", "tier": 1},
            {"id": "routes", "tier": 5},
            {"id": "services", "tier": 5},
        ],
        "files": [
            _file("lib/explainer.py", "other", 50, ["in_cycle"]),
            _file("lib/utils.py", "utils", 90, ["hub"]),
            _file("app/routes/chat.py", "routes", 70),
            _file("app/core.py", "services", 80),
            _file("app/main.py", "routes", 60, ["entry_point"], role="entry_point"),
        ],
        "edges": [],
    }

    order = [step["node_ids"][0] for step in generate_learn_tour(graph)]

    assert order == ["app/main.py", "app/routes/chat.py", "app/core.py", "lib/utils.py", "lib/explainer.py"]


def test_a_file_nothing_imports_needs_importance_to_get_a_step():
    files = [_file(f"app/m{i}.py", "services", 100 - i) for i in range(20)]
    files += [_file("Dockerfile", "other", 0, ["orphan"]), _file("app/dead.py", "services", 0, ["orphan", "god_file"])]

    order = [step["node_ids"][0] for step in generate_learn_tour({"layers": [], "files": files, "edges": []})]

    assert "Dockerfile" not in order  # an orphan and nothing else
    assert "app/dead.py" in order  # another flag still earns it a step


def test_a_files_own_tests_do_not_decide_its_layer():
    profiles = [
        {"path": "rune/nn_extractor.py", "role": "leaf"},
        {"path": "rune/test_nn_a.py", "role": "test"},
        {"path": "rune/test_nn_b.py", "role": "test"},
        {"path": "rune/routes/visualize.py", "role": "router"},
        {"path": "tests/helpers.py", "role": "leaf"},
        {"path": "tests/test_x.py", "role": "test"},
    ]
    dep_data = {
        "reverse_adjacency": {
            "rune/nn_extractor.py": ["rune/test_nn_a.py", "rune/test_nn_b.py", "rune/routes/visualize.py"],
            "tests/helpers.py": ["tests/test_x.py"],
        }
    }

    layers = _assign_layers(profiles, dep_data)

    assert layers["rune/nn_extractor.py"] == "routes"  # its one non-test importer, not its two tests
    assert layers["tests/helpers.py"] == "tests"  # imported only by tests: tests decide
