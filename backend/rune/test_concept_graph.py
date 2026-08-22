"""
Tests for rune/concept_graph.py — the pure halves of the concept overlay.

No LLM here: `build_evidence_digest` is what goes into the prompt and
`merge_concepts` is what survives coming out. The one that matters is the
grounding gate — an entity citing a symbol the repo doesn't contain is a
hallucination and must not reach the payload.
"""

from rune.concept_graph import build_evidence_digest, merge_concepts


def node(node_id, **overrides):
    path, name = node_id.split("::")
    return {
        "id": node_id,
        "label": name,
        "type": "function",
        "file": path,
        "in_degree": 0,
        "out_degree": 0,
        "role": "core",
        **overrides,
    }


def graph(*nodes):
    return {"nodes": list(nodes)}


# ── build_evidence_digest ──


def test_digest_chunks_by_directory():
    digest = build_evidence_digest(
        graph(node("rune/routes/a.py::handler"), node("rune/routes/b.py::other"), node("rune/llm/p.py::build"))
    )
    assert [c["scope"] for c in digest] == ["rune/routes", "rune/llm"]
    assert len(digest[0]["symbols"]) == 2


def test_digest_line_carries_the_layer_1_evidence():
    digest = build_evidence_digest(
        graph(
            node(
                "rune/cache.py::set",
                type="method",
                doc="Store a completed analysis.",
                signature="(repo_id, result) -> None",
                external_calls=["dumps", "setex"],
                effects=["cache"],
                http="POST /analyze",
            )
        )
    )
    line = digest[0]["symbols"][0]
    assert line.startswith("rune/cache.py::set (method, core)")
    for fragment in ("POST /analyze", "Store a completed analysis.", "(repo_id, result) -> None"):
        assert fragment in line
    assert "calls: dumps, setex" in line
    assert "effects: cache" in line


def test_digest_is_deterministic_and_capped():
    nodes = [node(f"pkg/f{i}.py::fn{i}", in_degree=i) for i in range(50)]
    first = build_evidence_digest(graph(*nodes), max_per_chunk=5)
    second = build_evidence_digest(graph(*reversed(nodes)), max_per_chunk=5)
    assert first == second
    assert len(first) == 1
    # Ranked by fan-in before the cut, same as the node budget.
    assert first[0]["symbols"][0].startswith("pkg/f49.py::fn49")


def test_chunk_budget_keeps_the_biggest_packages():
    nodes = [node(f"pkg{i}/f.py::fn{i}") for i in range(10)]
    nodes.append(node("pkg0/g.py::extra"))  # makes pkg0 the largest
    digest = build_evidence_digest(graph(*nodes), max_chunks=2)
    assert [c["scope"] for c in digest] == ["pkg0", "pkg1"]


def test_an_empty_graph_yields_no_chunks():
    assert build_evidence_digest({"nodes": []}) == []


# ── merge_concepts ──

VALID_IDS = {"rune/cache.py::AnalysisCache", "rune/clone.py::clone_repo"}
VALID_FILES = {"rune/cache.py", "rune/clone.py"}


def test_entities_are_deduped_by_name_and_unioned():
    chunks = [
        {
            "entities": [
                {
                    "name": "Analysis Cache",
                    "summary": "Stores results.",
                    "symbols": ["rune/cache.py::AnalysisCache"],
                    "files": ["rune/cache.py"],
                }
            ]
        },
        {
            "entities": [
                {
                    "name": "analysis  cache",
                    "summary": "dupe",
                    "symbols": ["rune/clone.py::clone_repo"],
                    "files": ["rune/clone.py"],
                }
            ]
        },
    ]
    merged = merge_concepts(chunks, VALID_IDS, VALID_FILES)
    assert len(merged["entities"]) == 1
    entity = merged["entities"][0]
    assert entity["id"] == "entity:analysis-cache"
    assert entity["summary"] == "Stores results."
    assert entity["symbols"] == sorted(VALID_IDS)
    assert entity["files"] == sorted(VALID_FILES)


def test_an_entity_citing_a_symbol_that_does_not_exist_is_dropped():
    chunks = [
        {
            "entities": [
                {"name": "Real", "summary": "", "symbols": ["rune/cache.py::AnalysisCache"], "files": []},
                {"name": "Invented", "summary": "", "symbols": ["rune/nowhere.py::ghost"], "files": []},
            ]
        }
    ]
    merged = merge_concepts(chunks, VALID_IDS, VALID_FILES)
    assert [e["name"] for e in merged["entities"]] == ["Real"]
    assert merged["metadata"]["dropped_ungrounded"] == 1


def test_a_bogus_file_citation_is_stripped_without_dropping_the_entity():
    chunks = [
        {
            "entities": [
                {"name": "Real", "symbols": ["rune/clone.py::clone_repo"], "files": ["rune/clone.py", "made/up.py"]}
            ]
        }
    ]
    merged = merge_concepts(chunks, VALID_IDS, VALID_FILES)
    assert merged["entities"][0]["files"] == ["rune/clone.py"]


def test_relations_resolve_by_name_or_id_and_drop_dangling_ends():
    chunks = [
        {
            "entities": [
                {"name": "Cache", "symbols": ["rune/cache.py::AnalysisCache"]},
                {"name": "Clone", "symbols": ["rune/clone.py::clone_repo"]},
            ],
            "relations": [
                {"source": "Clone", "target": "entity:cache", "label": "writes to"},
                {"source": "Clone", "target": "Nonexistent", "label": "invented"},
                {"source": "Clone", "target": "Clone", "label": "self"},
            ],
        }
    ]
    merged = merge_concepts(chunks, VALID_IDS, VALID_FILES)
    assert merged["relations"] == [{"source": "entity:clone", "target": "entity:cache", "label": "writes to"}]
    assert merged["metadata"]["dropped_ungrounded"] == 2


def test_nothing_grounded_means_not_enriched():
    merged = merge_concepts([{"entities": [{"name": "Ghost", "symbols": ["no/such.py::x"]}]}], VALID_IDS, VALID_FILES)
    assert merged["entities"] == []
    assert merged["metadata"]["is_llm_enriched"] is False
    assert merged["metadata"]["chunks"] == 1


def test_merge_survives_empty_and_malformed_chunks():
    merged = merge_concepts([{}, {"entities": [{"name": "  "}], "relations": None}], VALID_IDS, VALID_FILES)
    assert merged["entities"] == []
    assert merged["metadata"]["dropped_ungrounded"] == 1
