from rune.tour_generator import generate_learn_tour, generate_recall_tour


def _make_graph(n_important=20):
    layers = [{"id": "layer0", "tier": 0}]
    files = [
        {"id": f"file{i}.py", "layer_id": "layer0", "importance": n_important - i, "flags": []}
        for i in range(n_important)
    ]
    # An unimportant, unflagged file that should be dropped.
    files.append({"id": "noise.py", "layer_id": "layer0", "importance": 0, "flags": []})
    # An unimportant but flagged file that must survive the cap.
    files.append({"id": "orphan.py", "layer_id": "layer0", "importance": 0, "flags": ["orphan"]})
    return {"files": files, "layers": layers, "edges": []}


def test_learn_tour_caps_to_important_and_flagged():
    graph = _make_graph()
    steps = generate_learn_tour(graph)
    ids = {s["node_ids"][0] for s in steps}
    assert "noise.py" not in ids
    assert "orphan.py" in ids
    assert len(ids) == 16  # top 15 by importance + 1 flagged orphan


def test_recall_tour_caps_to_important_and_flagged():
    graph = _make_graph()
    steps = generate_recall_tour(graph)
    ids = {s["node_ids"][0] for s in steps}
    assert "noise.py" not in ids
    assert "orphan.py" in ids
    assert len(ids) == 16
