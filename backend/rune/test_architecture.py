from rune.architecture import build_architecture_manifest


def _profiles():
    return [
        {
            "path": "frontend/app/page.tsx",
            "role": "entry_point",
            "role_confidence": 0.95,
            "importance_score": 80,
            "language": "TypeScript",
        },
        {
            "path": "backend/rune/routes/chat.py",
            "role": "router",
            "role_confidence": 0.94,
            "importance_score": 90,
            "language": "Python",
        },
        {
            "path": "backend/rune/indexer.py",
            "role": "ml_pipeline",
            "role_confidence": 0.92,
            "importance_score": 75,
            "language": "Python",
        },
    ]


def _deps():
    return {
        "adjacency": {
            "frontend/app/page.tsx": ["backend/rune/routes/chat.py"],
            "backend/rune/routes/chat.py": ["backend/rune/indexer.py"],
        },
        "file_imports": {
            "backend/rune/routes/chat.py": [{"module": "groq"}, {"module": "pymilvus"}],
            "backend/rune/indexer.py": [{"module": "redis"}, {"module": "cloudflare"}],
        },
    }


def test_architecture_manifest_uses_responsibilities_and_explicit_products():
    manifest = build_architecture_manifest("abcdef123456", _deps(), _profiles())

    labels = {node.label for node in manifest.nodes}
    assert "routes/chat.py" not in labels
    assert all(not label.endswith((".py", ".ts", ".tsx")) for label in labels)
    assert "Groq — Llama" in labels
    assert "Zilliz Cloud — Milvus" in labels
    assert "Redis — Cache & Rate Limits" in labels
    assert all(edge.source != edge.target for edge in manifest.edges)
    assert all(edge.label for edge in manifest.edges)


def test_architecture_manifest_applies_overview_budget_and_view_filter():
    profiles = _profiles() + [
        {
            "path": f"backend/rune/helper_{index}.py",
            "role": "internal_helper",
            "role_confidence": 0.7,
            "importance_score": index,
            "language": "Python",
        }
        for index in range(12)
    ]
    manifest = build_architecture_manifest(
        "abcdef123456",
        _deps(),
        profiles,
        {"layout": {"max_nodes": 4, "max_edges": 3, "collapse_supporting_components": True}},
    )

    assert len(manifest.nodes) <= 4
    assert len(manifest.edges) <= 3
    assert manifest.collapsed

    integrations = build_architecture_manifest(
        "abcdef123456", _deps(), _profiles(), {"view": "integration_map"}
    )
    assert any(node.group_id == "external" for node in integrations.nodes)


def test_no_edge_references_pruned_or_collapsed_node():
    """Regression: edges must never reference a node that was hidden by max_nodes."""
    profiles = _profiles() + [
        {
            "path": f"backend/rune/service_{i}.py",
            "role": "service",
            "role_confidence": 0.85,
            "importance_score": 10 + i,
            "language": "Python",
        }
        for i in range(20)
    ]
    deps = _deps()
    # Add adjacency so there are edges between the new nodes
    for i in range(20):
        deps["adjacency"][f"backend/rune/service_{i}.py"] = [
            f"backend/rune/service_{(i + 1) % 20}.py"
        ]

    manifest = build_architecture_manifest(
        "test-repo",
        deps,
        profiles,
        {"layout": {"max_nodes": 6, "max_edges": 10, "collapse_supporting_components": True}},
    )

    node_ids = {node.id for node in manifest.nodes}
    collapsed_member_ids = set()
    for c in manifest.collapsed:
        collapsed_member_ids.update(c.member_ids)

    for edge in manifest.edges:
        assert edge.source in node_ids, (
            f"Edge {edge.id} source {edge.source} not in visible nodes"
        )
        assert edge.target in node_ids, (
            f"Edge {edge.id} target {edge.target} not in visible nodes"
        )
        # Neither endpoint should be a collapsed member
        assert edge.source not in collapsed_member_ids, (
            f"Edge {edge.id} source {edge.source} is a collapsed member"
        )
        assert edge.target not in collapsed_member_ids, (
            f"Edge {edge.id} target {edge.target} is a collapsed member"
        )

