"""
concept_graph.py — Per-function purpose descriptions, grounded in real symbols.

`symbol_graph.py` answers "what calls what" for the important-symbol set.
This answers "what does each of those symbols do" — one LLM pass reads the
Layer 1 evidence for each symbol and writes a short purpose description.
Everything either side of that call lives here and is pure:
`build_evidence_digest` renders the prompt input, `merge_descriptions` folds
the per-chunk answers back together.

The whole reason this module is a pair of pure functions is
`merge_descriptions`'s second job: a description citing a symbol id the graph
doesn't contain is a hallucination, and it gets dropped rather than rendered.
`dropped_ungrounded` in the metadata is how often that happened.
"""

from __future__ import annotations

from typing import Any

#: Symbols per prompt chunk, and chunks per repo. The input is already the
#: bounded important-symbol set (<= MAX_IMPORTANT_SYMBOLS), so this just
#: keeps each individual prompt a manageable size.
MAX_SYMBOLS_PER_CHUNK = 25
MAX_CHUNKS = 3

#: Evidence trimming, so a single symbol line can't blow up a chunk's prompt size.
MAX_DOC_CHARS = 120
MAX_EXTERNAL_CALLS_IN_LINE = 5

#: LLM descriptions are unbounded prose otherwise — cap so a node card doesn't overflow.
MAX_DESCRIPTION_CHARS = 140


def _symbol_line(node: dict[str, Any]) -> str:
    """One digest line: identity, then whatever evidence Layer 1 found."""
    parts = [f"{node['id']} ({node.get('type', 'function')}, {node.get('role') or 'unknown'})"]
    if node.get("http"):
        parts.append(f"route: {node['http']}")
    if node.get("doc"):
        doc = str(node["doc"])
        parts.append(doc if len(doc) <= MAX_DOC_CHARS else doc[:MAX_DOC_CHARS].rstrip() + "…")
    if node.get("signature"):
        parts.append(str(node["signature"]))
    if node.get("external_calls"):
        parts.append("calls: " + ", ".join(node["external_calls"][:MAX_EXTERNAL_CALLS_IN_LINE]))
    if node.get("effects"):
        parts.append("effects: " + ", ".join(node["effects"]))
    return " | ".join(parts)


def build_evidence_digest(
    symbol_graph: dict,
    max_per_chunk: int = MAX_SYMBOLS_PER_CHUNK,
    max_chunks: int = MAX_CHUNKS,
) -> list[dict]:
    """
    Render the (already important-only) nodes as prompt-sized chunks.

    Ranked by `symbol_importance` descending, then split flatly into chunks
    of `max_per_chunk` — no directory grouping, since the input set is
    already small and every symbol in it is worth a description.

    Returns:
        `[{symbols: [line, ...]}]` — deterministic for identical input.

    # ponytail: a graph with more than max_chunks * max_per_chunk important
    # symbols loses its tail (lowest importance first). MAX_IMPORTANT_SYMBOLS
    # must stay <= max_chunks * max_per_chunk (75) for this to not truncate.
    """
    ranked = sorted(
        (n for n in symbol_graph.get("nodes") or [] if n.get("id")),
        key=lambda n: (-(n.get("symbol_importance") or 0), n["id"]),
    )
    chunks = [ranked[i : i + max_per_chunk] for i in range(0, len(ranked), max_per_chunk)]
    return [{"symbols": [_symbol_line(n) for n in chunk]} for chunk in chunks[:max_chunks]]


def merge_descriptions(chunk_results: list[dict], valid_symbol_ids: set[str]) -> dict:
    """
    Fold per-chunk LLM answers into one `{symbol_id: text}` overlay, dropping
    anything ungrounded.

    Args:
        chunk_results:    parsed `{descriptions: [{symbol_id, text}]}` dicts, one per chunk.
        valid_symbol_ids: every `path::name` in the symbol graph's important set.

    Returns:
        `{descriptions, metadata}`. A description survives only if its
        `symbol_id` is a real symbol.
    """
    descriptions: dict[str, str] = {}
    dropped = 0

    for chunk in chunk_results or []:
        for raw in chunk.get("descriptions") or []:
            symbol_id = (raw.get("symbol_id") or "").strip()
            if symbol_id not in valid_symbol_ids:
                dropped += 1
                continue
            text = (raw.get("text") or "").strip()
            if len(text) > MAX_DESCRIPTION_CHARS:
                text = text[:MAX_DESCRIPTION_CHARS].rstrip() + "…"
            if text:
                descriptions[symbol_id] = text

    return {
        "descriptions": [{"symbol_id": sid, "text": text} for sid, text in descriptions.items()],
        "metadata": {
            "is_llm_enriched": bool(descriptions),
            "chunks": len(chunk_results or []),
            "dropped_ungrounded": dropped,
            "fallback_reason": None,
        },
    }
