"""H5: determinism test for generate_diff_tour over fixture change-maps.
See Order of implementation.txt F5 H5 and tour_generator.py's H2 docstring."""

from codekavi.tour_generator import assemble_diff_tour, generate_diff_tour


def _file(path: str, importance: float = 0.0, layer_id: str = "layer-1") -> dict:
    return {"id": path, "name": path.rsplit("/", 1)[-1], "importance": importance, "layer_id": layer_id, "flags": []}


def _graph(*files: dict) -> dict:
    return {"files": list(files), "layers": [{"id": "layer-1", "tier": 0}], "edges": [], "insights": {}}


def test_structural_changes_ordered_before_cosmetic():
    graph = _graph(_file("a.py"), _file("b.py"))
    change_map = {"a.py": "COSMETIC", "b.py": "STRUCTURAL"}

    steps = generate_diff_tour(graph, change_map)

    assert [s["node_ids"][0] for s in steps] == ["b.py", "a.py"]
    assert [s["change_type"] for s in steps] == ["STRUCTURAL", "COSMETIC"]


def test_ties_broken_by_importance_desc_then_path():
    graph = _graph(
        _file("low.py", importance=0.1),
        _file("high.py", importance=0.9),
        _file("mid.py", importance=0.5),
    )
    change_map = {"low.py": "STRUCTURAL", "high.py": "STRUCTURAL", "mid.py": "STRUCTURAL"}

    steps = generate_diff_tour(graph, change_map)

    assert [s["node_ids"][0] for s in steps] == ["high.py", "mid.py", "low.py"]


def test_output_is_deterministic_regardless_of_change_map_insertion_order():
    graph = _graph(_file("a.py", importance=0.2), _file("b.py", importance=0.7), _file("c.py", importance=0.5))
    forward = {"a.py": "COSMETIC", "b.py": "STRUCTURAL", "c.py": "STRUCTURAL"}
    reversed_map = {"c.py": "STRUCTURAL", "b.py": "STRUCTURAL", "a.py": "COSMETIC"}

    assert generate_diff_tour(graph, forward) == generate_diff_tour(graph, reversed_map)


def test_repeated_calls_are_byte_identical():
    graph = _graph(_file("a.py", importance=0.3), _file("b.py", importance=0.6))
    change_map = {"a.py": "STRUCTURAL", "b.py": "COSMETIC"}

    first = generate_diff_tour(graph, change_map)
    second = generate_diff_tour(graph, change_map)

    assert first == second


def test_deleted_files_dropped_from_steps_but_counted():
    graph = _graph(_file("a.py"))
    change_map = {"a.py": "STRUCTURAL", "deleted.py": "STRUCTURAL"}

    steps = generate_diff_tour(graph, change_map)
    assert [s["node_ids"][0] for s in steps] == ["a.py"]

    payload = assemble_diff_tour(graph, change_map)
    assert payload["deleted_count"] == 1
    assert len(payload["steps"]) == 1


def test_unrecognized_change_type_is_ignored():
    graph = _graph(_file("a.py"), _file("b.py"))
    change_map = {"a.py": "STRUCTURAL", "b.py": "UNKNOWN_TYPE"}

    steps = generate_diff_tour(graph, change_map)
    assert [s["node_ids"][0] for s in steps] == ["a.py"]


if __name__ == "__main__":
    test_structural_changes_ordered_before_cosmetic()
    test_ties_broken_by_importance_desc_then_path()
    test_output_is_deterministic_regardless_of_change_map_insertion_order()
    test_repeated_calls_are_byte_identical()
    test_deleted_files_dropped_from_steps_but_counted()
    test_unrecognized_change_type_is_ignored()
    print("ok")
