"""
Tests for rune/concept_graph.py — the pure halves of the knowledge overlay.

No LLM here: `build_evidence_digest` is what goes into the prompt and
`merge_descriptions` is what survives coming out. The one that matters is the
grounding gate — a description citing a symbol id the graph doesn't contain
is a hallucination and must not reach the payload.
"""

from rune.concept_graph import build_evidence_digest, merge_descriptions


def node(node_id, **overrides):
    path, name = node_id.split("::")
    return {
        "id": node_id,
        "label": name,
        "type": "function",
        "file": path,
        "role": "core",
        "symbol_importance": 0,
        **overrides,
    }


def graph(*nodes):
    return {"nodes": list(nodes)}


# ── build_evidence_digest ──


def test_digest_is_ranked_by_symbol_importance_descending():
    digest = build_evidence_digest(
        graph(node("a.py::low", symbol_importance=10), node("b.py::high", symbol_importance=90))
    )
    assert len(digest) == 1
    assert digest[0]["symbols"][0].startswith("b.py::high")
    assert digest[0]["symbols"][1].startswith("a.py::low")


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


def test_digest_is_deterministic_and_chunked():
    nodes = [node(f"pkg/f{i}.py::fn{i}", symbol_importance=i) for i in range(50)]
    first = build_evidence_digest(graph(*nodes), max_per_chunk=5, max_chunks=10)
    second = build_evidence_digest(graph(*reversed(nodes)), max_per_chunk=5, max_chunks=10)
    assert first == second
    assert len(first) == 10
    assert first[0]["symbols"][0].startswith("pkg/f49.py::fn49")


def test_chunk_budget_caps_total_chunks():
    nodes = [node(f"pkg/f{i}.py::fn{i}") for i in range(30)]
    digest = build_evidence_digest(graph(*nodes), max_per_chunk=5, max_chunks=2)
    assert len(digest) == 2


def test_an_empty_graph_yields_no_chunks():
    assert build_evidence_digest({"nodes": []}) == []


# ── merge_descriptions ──

VALID_IDS = {"rune/cache.py::AnalysisCache", "rune/clone.py::clone_repo"}


def test_grounded_descriptions_are_kept():
    chunks = [
        {
            "descriptions": [
                {"symbol_id": "rune/cache.py::AnalysisCache", "text": "Caches analysis results."},
                {"symbol_id": "rune/clone.py::clone_repo", "text": "Clones a repository to disk."},
            ]
        }
    ]
    merged = merge_descriptions(chunks, VALID_IDS)
    assert {d["symbol_id"] for d in merged["descriptions"]} == VALID_IDS
    assert merged["metadata"]["is_llm_enriched"] is True
    assert merged["metadata"]["dropped_ungrounded"] == 0


def test_a_description_citing_a_symbol_that_does_not_exist_is_dropped():
    chunks = [
        {
            "descriptions": [
                {"symbol_id": "rune/cache.py::AnalysisCache", "text": "Real."},
                {"symbol_id": "rune/nowhere.py::ghost", "text": "Invented."},
            ]
        }
    ]
    merged = merge_descriptions(chunks, VALID_IDS)
    assert [d["symbol_id"] for d in merged["descriptions"]] == ["rune/cache.py::AnalysisCache"]
    assert merged["metadata"]["dropped_ungrounded"] == 1


def test_nothing_grounded_means_not_enriched():
    merged = merge_descriptions([{"descriptions": [{"symbol_id": "no/such.py::x", "text": "Ghost."}]}], VALID_IDS)
    assert merged["descriptions"] == []
    assert merged["metadata"]["is_llm_enriched"] is False
    assert merged["metadata"]["chunks"] == 1


def test_merge_survives_empty_and_malformed_chunks():
    merged = merge_descriptions([{}, {"descriptions": [{"symbol_id": "  "}]}, {"descriptions": None}], VALID_IDS)
    assert merged["descriptions"] == []
    assert merged["metadata"]["dropped_ungrounded"] == 1


def test_later_chunk_overwrites_earlier_description_for_same_symbol():
    chunks = [
        {"descriptions": [{"symbol_id": "rune/cache.py::AnalysisCache", "text": "First."}]},
        {"descriptions": [{"symbol_id": "rune/cache.py::AnalysisCache", "text": "Second."}]},
    ]
    merged = merge_descriptions(chunks, VALID_IDS)
    assert merged["descriptions"] == [{"symbol_id": "rune/cache.py::AnalysisCache", "text": "Second."}]
