"""
concept_graph.py — The domain concepts a repo is about, grounded in real symbols.

`symbol_graph.py` answers "what calls what". This answers "what is this repo
*about*" — Repository, Analysis Cache, Quota, Clone — and how those ideas relate.
That question needs judgement, so one LLM pass reads the Layer 1 evidence and
names the concepts. Everything either side of that call lives here and is pure:
`build_evidence_digest` renders the prompt input, `merge_concepts` folds the
per-chunk answers back together.

The whole reason this module is a pair of pure functions is `merge_concepts`'s
second job: an entity that cites a symbol id the repo doesn't contain is a
hallucination, and it gets dropped rather than rendered. `dropped_ungrounded`
in the metadata is how often that happened.
"""

from __future__ import annotations

import os
import re
from typing import Any

#: Symbols per prompt chunk, and chunks per repo. Two caps rather than one token
#: budget: a chunk is ~2-3k tokens, so 6 chunks is the whole pass.
MAX_SYMBOLS_PER_CHUNK = 40
MAX_CHUNKS = 6

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def _slug(name: str) -> str:
    return _SLUG_STRIP.sub("-", (name or "").lower()).strip("-")


def _symbol_line(node: dict[str, Any]) -> str:
    """One digest line: identity, then whatever evidence Layer 1 found."""
    parts = [f"{node['id']} ({node.get('type', 'function')}, {node.get('role') or 'unknown'})"]
    if node.get("http"):
        parts.append(f"route: {node['http']}")
    if node.get("doc"):
        parts.append(str(node["doc"]))
    if node.get("signature"):
        parts.append(str(node["signature"]))
    if node.get("external_calls"):
        parts.append("calls: " + ", ".join(node["external_calls"]))
    if node.get("effects"):
        parts.append("effects: " + ", ".join(node["effects"]))
    return " | ".join(parts)


def build_evidence_digest(
    symbol_graph: dict,
    max_per_chunk: int = MAX_SYMBOLS_PER_CHUNK,
    max_chunks: int = MAX_CHUNKS,
) -> list[dict]:
    """
    Render the Layer 1 nodes as prompt-sized chunks, one per package directory.

    Directories are the cheapest honest proxy for "related code", and chunking by
    them means each prompt sees a coherent slice instead of a fan-in-ranked
    scatter across the repo.

    Returns:
        `[{scope, symbols: [line, ...]}]` — deterministic for identical input.

    # ponytail: a directory holding more than `max_per_chunk` symbols loses its
    # tail (lowest fan-in first). Upgrade path is splitting the directory into
    # numbered chunks; only worth it if a real repo puts >40 ranked symbols in
    # one package.
    """
    by_scope: dict[str, list[dict]] = {}
    for node in symbol_graph.get("nodes") or []:
        if not node.get("id"):
            continue
        by_scope.setdefault(os.path.dirname(node.get("file") or "") or ".", []).append(node)

    # Biggest package first: if the chunk budget bites, it drops the thinnest
    # corners of the repo rather than its centre.
    scopes = sorted(by_scope, key=lambda s: (-len(by_scope[s]), s))[:max_chunks]

    digest = []
    for scope in scopes:
        ranked = sorted(
            by_scope[scope],
            key=lambda n: (-(n.get("in_degree") or 0), -(n.get("out_degree") or 0), n["id"]),
        )
        digest.append({"scope": scope, "symbols": [_symbol_line(n) for n in ranked[:max_per_chunk]]})
    return digest


def merge_concepts(
    chunk_results: list[dict],
    valid_symbol_ids: set[str],
    valid_files: set[str],
) -> dict:
    """
    Fold per-chunk LLM answers into one overlay, dropping anything ungrounded.

    Args:
        chunk_results:    parsed `{entities, relations}` dicts, one per chunk.
        valid_symbol_ids: every `path::name` in the symbol graph.
        valid_files:      every file path in the symbol graph.

    Returns:
        `{entities, relations, metadata}`. An entity survives only if it cites at
        least one real symbol; a relation only if both ends survived.
    """
    entities: dict[str, dict] = {}
    dropped = 0

    for chunk in chunk_results or []:
        for raw in chunk.get("entities") or []:
            name = (raw.get("name") or "").strip()
            slug = _slug(name)
            if not slug:
                dropped += 1
                continue
            symbols = [s for s in raw.get("symbols") or [] if s in valid_symbol_ids]
            if not symbols:
                # No real symbol behind it — the concept was invented, not found.
                dropped += 1
                continue
            files = [f for f in raw.get("files") or [] if f in valid_files]
            existing = entities.get(slug)
            if existing:
                existing["symbols"] = sorted(set(existing["symbols"]) | set(symbols))
                existing["files"] = sorted(set(existing["files"]) | set(files))
            else:
                entities[slug] = {
                    "id": f"entity:{slug}",
                    "name": name,
                    "summary": (raw.get("summary") or "").strip(),
                    "symbols": sorted(set(symbols)),
                    "files": sorted(set(files)),
                }

    def entity_id(ref: str) -> str | None:
        # Models cite either the id we asked for or the bare name; both slug the same.
        slug = _slug((ref or "").removeprefix("entity:"))
        return entities[slug]["id"] if slug in entities else None

    relations: dict[tuple[str, str, str], dict] = {}
    for chunk in chunk_results or []:
        for raw in chunk.get("relations") or []:
            source = entity_id(raw.get("source", ""))
            target = entity_id(raw.get("target", ""))
            if source is None or target is None or source == target:
                dropped += 1
                continue
            label = (raw.get("label") or "relates to").strip()
            relations.setdefault((source, target, label), {"source": source, "target": target, "label": label})

    return {
        "entities": sorted(entities.values(), key=lambda e: e["id"]),
        "relations": sorted(relations.values(), key=lambda r: (r["source"], r["target"], r["label"])),
        "metadata": {
            "is_llm_enriched": bool(entities),
            "chunks": len(chunk_results or []),
            "dropped_ungrounded": dropped,
            "fallback_reason": None,
        },
    }
