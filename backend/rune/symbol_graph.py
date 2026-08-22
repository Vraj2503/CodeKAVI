"""
symbol_graph.py — Functions and classes as nodes, calls and inheritance as edges.

Every other graph in this codebase is file-to-file: `A.py imports B.py` tells you
the modules touch, not what either of them *does*. This one works one level down,
on the symbols `complexity.py` already matches while measuring branches — so the
whole thing costs zero extra parses and zero tokens.

Pure function, no I/O, same contract as `graph_assembler.assemble_graph`: dicts in,
graph payload out, safe to call from anywhere and trivial to test for determinism.

Two tiers come back. `groups`/`group_edges` is the overview — one node per file,
call counts aggregated onto the arrows between them — and `nodes`/`edges` is the
drill-down inside a group. The tiers exist because a repo's symbol graph is a
hairball (665 nodes / 806 edges here) and the obvious fix is the wrong one:
ranking symbols and keeping the top 25 leaves 7 edges standing, since the arrows
ran through the mid-tier functions the cut removed. Collapsing keeps them.

Resolution is by name, walking a proximity ladder (same file → an imported file →
a unique repo-wide definition). Names that survive all three are dropped and
counted, never guessed at — `metadata.unresolved_calls` is the honest half of the
`resolution_rate` the frontend banner shows.

# ponytail: name-based resolution — no type inference, so an overloaded method
# name across unrelated classes resolves by import proximity, not by receiver
# type. Upgrade path is a per-file scope table if the miss rate turns out to
# matter; `unresolved_calls` is the metric that would say so.

Concept-overlay seam (not built): the LLM pass lands as
`POST /visualize/knowledge/{repo_id}` with `{use_llm: true}`, following the mindmap
pattern in `routes/visualize.py` — `get_token_tracker()` → `check_quota(user_id)` →
429 `{error: "quota_exceeded", remaining_tokens}` → `generate_with_usage(...)` →
static fallback in `except`. It adds `type: "concept"` nodes over the same
node/edge shape, so nothing in this module has to change for it.
"""

from __future__ import annotations

import re
from typing import Any

from rune.analyzer import SUPPORTED_LANGUAGES

#: Languages complexity.py has a grammar for, named as analyzer.py labels them.
#: `.tsx`/`.jsx` are detected as TypeScript/JavaScript, so the four grammars
#: reduce to three language names.
SYMBOL_LANGUAGES: frozenset[str] = frozenset({"Python", "JavaScript", "TypeScript"})

#: Node budget. Ranked by fan-in before the cut, and the remainder is reported in
#: `metadata` — a graph that silently shows a third of the repo while looking
#: complete is the failure mode this cap exists to avoid, not to cause.
MAX_GRAPH_NODES = 150

#: How many collapsed file groups the default view draws.
#:
#: Collapsing is what makes the view legible at all: cutting *symbols* to a
#: readable count strands them — 25 top-ranked symbols on this repo keep 7 of 806
#: edges and leave 60% of nodes alone, because the arrows ran through the mid-tier
#: functions the cut removed. Two thirds of edges are intra-file, so collapsing
#: tucks the hairball inside a group instead of deleting it (15% alone).
#:
#: The count itself is not a constant, because "how many parts does this repo
#: have" is a property of the repo. A group is drawn when its importance clears
#: `OVERVIEW_IMPORTANCE_FLOOR` of the top group's — the shape of the falloff is
#: the signal, since a repo with ten real modules drops off a cliff after ten and
#: a genuinely broad one doesn't. On this codebase that picks 25 files, on
#: `rune/routes` 5, on `rune/llm` 3, with no tuning per repo.
OVERVIEW_IMPORTANCE_FLOOR = 0.15

#: Guard rails on the adaptive count. The floor keeps a repo with one dominant
#: file from rendering as a single box; the ceiling is where any layout turns
#: back into a hairball no matter how legitimate the groups are.
MIN_OVERVIEW_GROUPS = 8
MAX_OVERVIEW_GROUPS = 40

#: Groups carried in the payload regardless of what is drawn. The overview is a
#: `drawn` flag rather than a slice so the LLM pass can re-pick the selection
#: without a rebuild — a memory bound, not a display one.
MAX_STORED_GROUPS = 120

#: Symbols named on a collapsed group, so a group reads as "what's in here"
#: rather than as an opaque box the reader has to click to learn anything.
GROUP_PREVIEW_SYMBOLS = 3

#: External callee names kept per node. The names a call *fails* to resolve to —
#: `json.loads`, `logger.warning`, `subprocess.run` — are the most direct
#: statement of what a function does anywhere in the repo, and until now they
#: were counted and thrown away.
MAX_EXTERNAL_CALLS = 8

#: Names that appear in every function and therefore distinguish none of them.
_CALL_STOPLIST: frozenset[str] = frozenset(
    """
    len str int float bool list dict set tuple range print id
    append extend insert get pop push add remove copy
    format join split strip replace startswith endswith lower upper
    items keys values sorted sort map filter reduce enumerate zip reversed
    isinstance getattr setattr hasattr super type repr
    min max sum abs round any all next iter
    slice includes indexOf toString then catch
    log warn error info debug
    """.split()
)

#: Callee tail -> effect tag. Only tails distinctive enough to mean one thing:
#: the receiver type is deliberately not inferred (same rationale as the method
#: filter in `resolve`), so `get`/`run`/`load` would tag half the repo wrongly.
#
# ponytail: hand-written keyword table, so a repo whose I/O goes through its own
# wrappers (`store.save`, `api.call`) reads as effect-free. Upgrade path is
# following resolved edges transitively - worth it only once effects are used
# for more than a badge.
_EFFECT_KEYWORDS: dict[str, str] = {
    "filesystem": """open read_text write_text read_bytes write_bytes mkdir makedirs rmtree
                     unlink listdir walk glob iterdir
                     readFile readFileSync writeFile writeFileSync existsSync""",
    "network": "fetch urlopen urlretrieve request post axios httpx",
    "db": "execute executemany commit rollback cursor fetchone fetchall fetchrow upsert",
    "cache": "setex hgetall hset expire ttl",
    "llm": "generate_with_usage generate_content create_message embed embeddings completion count_tokens",
    "subprocess": "Popen check_output check_call spawn execFile execSync",
    "concurrency": "gather run_sync to_thread create_task as_completed run_in_executor wait_for",
}

_EFFECT_BY_CALL: dict[str, str] = {call: tag for tag, calls in _EFFECT_KEYWORDS.items() for call in calls.split()}

#: `@router.post("/analyze")` → `POST /analyze`. An endpoint is the one thing a
#: reader most wants to know about a handler, and it is sitting in the decorator.
_ROUTE_DECORATOR = re.compile(
    r"""@\w+\.(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']*)["']""",
    re.IGNORECASE,
)


def select_groups(graph: dict, files: set[str]) -> dict:
    """
    Re-pick which groups the overview draws, from a set of file paths.

    The adaptive count in `build_symbol_graph` reads the importance falloff, which
    is a statement about how connected a file is — not about whether it matters to
    someone reading the repo. When the concept pass has run, the files its entities
    cite are a better answer to both "which" and "how many", and this folds that
    answer in by flipping `drawn`. Pure, and no rebuild: `groups`/`group_edges`
    are already stored wider than the default selection.

    Falls through unchanged if `files` names nothing the graph stored, so a model
    that returns paths in some other shape degrades to the adaptive count rather
    than to an empty canvas.
    """
    stored = graph.get("groups") or []
    chosen = {g["id"] for g in stored if g["id"] in files}
    if not chosen:
        return graph

    groups = [{**g, "drawn": g["id"] in chosen} for g in stored]
    return {
        **graph,
        "groups": groups,
        "metadata": {**graph.get("metadata", {}), "drawn_groups": len(chosen), "group_selection": "llm"},
        "diagnostics": {**graph.get("diagnostics", {}), "group_count": len(chosen)},
    }


def _node_id(path: str, name: str) -> str:
    return f"{path}::{name}"


def _http_route(decorators: list[str] | None) -> str | None:
    for decorator in decorators or []:
        match = _ROUTE_DECORATOR.search(decorator)
        if match:
            return f"{match.group(1).upper()} {match.group(2)}"
    return None


def build_symbol_graph(
    symbols_by_file: dict[str, list[dict[str, Any]]],
    file_profiles: list[dict],
    dep_data: dict,
    max_nodes: int = MAX_GRAPH_NODES,
    max_groups: int | None = None,
) -> dict:
    """
    Assemble the symbol-level graph.

    Args:
        symbols_by_file: `{rel_path: [symbol record]}` from classify_files(symbols_out=...).
        file_profiles:   classify_files() output, dict-shaped — supplies role/importance.
        dep_data:        DepGraph, dict-shaped — `adjacency` drives cross-file resolution.
        max_nodes:       Node budget; the top `max_nodes` by fan-in survive.
        max_groups:      Force the overview to exactly this many groups. Default
                         `None` derives it from the importance falloff.

    Returns:
        `{nodes, edges, groups, group_edges, metadata, diagnostics}` — see the
        module docstring.
    """
    profile_map = {p.get("path"): p for p in file_profiles or []}
    adjacency = dep_data.get("adjacency") or {}

    # ── Symbol table ──
    nodes: dict[str, dict[str, Any]] = {}
    by_file_name: dict[tuple[str, str], str] = {}  # (path, name) → node id
    by_name: dict[str, list[str]] = {}  # name → node ids, for the repo-wide fallback
    total_symbols = 0

    for path in sorted(symbols_by_file):
        profile = profile_map.get(path) or {}
        for symbol in symbols_by_file[path]:
            total_symbols += 1
            name = symbol.get("name")
            if not name:
                continue
            node_id = _node_id(path, name)
            if node_id in nodes:
                # Same name twice in one file (a redefinition, or a method name
                # reused across two classes). First definition wins; splitting
                # them would need the receiver type we deliberately don't infer.
                continue
            nodes[node_id] = {
                "id": node_id,
                "label": name,
                "type": symbol.get("kind", "function"),
                "file": path,
                "line": symbol.get("line"),
                "loc": max(0, (symbol.get("end_line") or 0) - (symbol.get("line") or 0)),
                "doc": symbol.get("doc"),
                "signature": symbol.get("signature"),
                "is_async": bool(symbol.get("is_async")),
                "http": _http_route(symbol.get("decorators")),
                "external_calls": [],
                "effects": [],
                "in_degree": 0,
                "out_degree": 0,
                "role": profile.get("role"),
                "importance": profile.get("importance_score"),
            }
            by_file_name[(path, name)] = node_id
            by_name.setdefault(name, []).append(node_id)

    # ── Resolution ──
    def resolve(name: str, from_path: str) -> str | None:
        same_file = by_file_name.get((from_path, name))
        if same_file is not None:
            return same_file
        # Past the same file, a bare method name is a receiver we cannot type:
        # `some_dict.get(k)` would otherwise bind to whatever class happens to
        # define `get` in an imported module. A missing edge is honest; a
        # confidently wrong one poisons the fan-in ranking the whole view sorts by.
        for imported in sorted(adjacency.get(from_path, []) or []):
            hit = by_file_name.get((imported, name))
            if hit is not None and nodes[hit]["type"] != "method":
                return hit
        candidates = [c for c in by_name.get(name, []) if nodes[c]["type"] != "method"]
        return candidates[0] if len(candidates) == 1 else None

    edges: dict[tuple[str, str, str], dict[str, str]] = {}
    resolved_calls = 0
    unresolved_calls = 0

    for path in sorted(symbols_by_file):
        for symbol in symbols_by_file[path]:
            source = by_file_name.get((path, symbol.get("name", "")))
            if source is None:
                continue
            callees = symbol.get("callees", [])
            references = [(callee, "calls") for callee in callees]
            references += [(base, "inherits") for base in symbol.get("bases", [])]

            # Effects read the whole callee list, resolved or not: `open` says
            # "touches the filesystem" whether or not the repo defines an `open`.
            tags = {_EFFECT_BY_CALL[c] for c in callees if c in _EFFECT_BY_CALL}
            if tags:
                nodes[source]["effects"] = sorted(set(nodes[source]["effects"]) | tags)

            for target_name, label in references:
                target = resolve(target_name, path)
                if target is None:
                    unresolved_calls += 1
                    # Keep the name as vocabulary even though it isn't an edge.
                    # `callees` is already deduped per symbol and in source
                    # order, so this is deterministic without a rank pass.
                    external = nodes[source]["external_calls"]
                    if (
                        label == "calls"
                        and target_name not in _CALL_STOPLIST
                        and target_name not in external
                        and len(external) < MAX_EXTERNAL_CALLS
                    ):
                        external.append(target_name)
                    continue
                resolved_calls += 1
                # A recursive call resolves — it just draws as a loop on itself,
                # which reads as noise rather than structure.
                if target != source:
                    edges.setdefault((source, target, label), {"source": source, "target": target, "label": label})

    for edge in edges.values():
        nodes[edge["source"]]["out_degree"] += 1
        nodes[edge["target"]]["in_degree"] += 1

    # ── Budget ──
    # Rank first, then cut: the surplus is the tail of the ranking, not whatever
    # happened to be last in file order.
    ranked = sorted(nodes.values(), key=lambda n: (-n["in_degree"], -n["out_degree"], n["id"]))
    kept = ranked[:max_nodes]
    kept_ids = {n["id"] for n in kept}
    truncated_count = len(ranked) - len(kept)

    # Degrees stay as measured on the whole repo, not on the visible subgraph —
    # "9 callers" is a fact about the code, and `is_truncated` says why fewer
    # arrows are drawn.
    visible_edges = [e for e in edges.values() if e["source"] in kept_ids and e["target"] in kept_ids]
    visible_edges.sort(key=lambda e: (e["source"], e["target"], e["label"]))

    # ── Overview tier ──
    # Collapse every symbol into its file. Built from `ranked`, not from `kept`:
    # a group's counts are a fact about the file, and a collapse that quietly
    # drops the symbols the node budget already cut would be a cut wearing a
    # group's clothes. Iterating in fan-in order makes `top_symbols` fall out.
    groups: dict[str, dict[str, Any]] = {}
    for node in ranked:
        group = groups.get(node["file"])
        if group is None:
            group = groups[node["file"]] = {
                "id": node["file"],
                "label": node["file"].rsplit("/", 1)[-1],
                "file": node["file"],
                "role": node["role"],
                "importance": node["importance"] or 0.0,
                "symbol_count": 0,
                "top_symbols": [],
                "effects": [],
                "routes": [],
            }
        group["symbol_count"] += 1
        if len(group["top_symbols"]) < GROUP_PREVIEW_SYMBOLS:
            group["top_symbols"].append(node["label"])
        if node["effects"]:
            group["effects"] = sorted(set(group["effects"]) | set(node["effects"]))
        if node["http"] and node["http"] not in group["routes"]:
            group["routes"].append(node["http"])

    # Tests sort last, not out. A test file scores high on importance — it imports
    # widely and the classifier counts that — so on this repo the three heaviest
    # arrows were all test→source, which is true and is not what the overview is
    # for. Demoted rather than filtered: a repo with room to spare should still
    # show them, and a repo that is mostly tests should still draw something.
    ranked_groups = sorted(
        groups.values(),
        key=lambda g: (g["role"] == "test", -g["importance"], -g["symbol_count"], g["id"]),
    )
    stored_groups = ranked_groups[:MAX_STORED_GROUPS]

    # How many to draw: let the importance falloff say so, then clamp. `top` comes
    # from the ranked head so a test-only repo still measures against something.
    top_importance = stored_groups[0]["importance"] if stored_groups else 0.0
    above_floor = sum(1 for g in stored_groups if g["importance"] >= top_importance * OVERVIEW_IMPORTANCE_FLOOR)
    drawn_count = (
        max_groups if max_groups is not None else min(max(above_floor, MIN_OVERVIEW_GROUPS), MAX_OVERVIEW_GROUPS)
    )
    drawn_count = min(drawn_count, len(stored_groups))
    for index, group in enumerate(stored_groups):
        group["drawn"] = index < drawn_count

    # Aggregated over *all* edges rather than the visible ones: a cross-file call
    # the symbol budget dropped is exactly the arrow this view exists to show.
    # Intra-file edges are skipped — they are the two thirds of the hairball that
    # collapsing is meant to tuck away, and they would draw as self-loops.
    #
    # Computed across every stored group, not just the drawn ones, so re-picking
    # the selection later (see `select_groups`) never needs the symbol graph back.
    stored_ids = {g["id"] for g in stored_groups}
    group_edges: dict[tuple[str, str], dict[str, Any]] = {}
    for edge in edges.values():
        source = nodes[edge["source"]]["file"]
        target = nodes[edge["target"]]["file"]
        if source == target or source not in stored_ids or target not in stored_ids:
            continue
        aggregate = group_edges.setdefault((source, target), {"source": source, "target": target, "weight": 0})
        aggregate["weight"] += 1

    languages_present = {p.get("language") for p in file_profiles or []}
    unsupported_languages = sorted((languages_present & SUPPORTED_LANGUAGES) - SYMBOL_LANGUAGES)

    attempts = resolved_calls + unresolved_calls
    resolution_rate = round(resolved_calls / attempts, 3) if attempts else 1.0

    return {
        "nodes": kept,
        "edges": visible_edges,
        # The default view: draw the groups flagged `drawn`. `nodes`/`edges` are
        # the drill-down for one group.
        "groups": stored_groups,
        "group_edges": sorted(group_edges.values(), key=lambda e: (e["source"], e["target"])),
        "metadata": {
            "total_symbols": total_symbols,
            "total_groups": len(groups),
            "drawn_groups": drawn_count,
            "group_selection": "fixed" if max_groups is not None else "adaptive",
            "resolved_calls": resolved_calls,
            "unresolved_calls": unresolved_calls,
            "is_truncated": truncated_count > 0,
            "truncated_count": truncated_count,
            "unsupported_languages": unsupported_languages,
        },
        # Shape the existing DiagnosticsBanner already reads.
        "diagnostics": {
            "node_count": len(kept),
            "edge_count": len(visible_edges),
            "group_count": drawn_count,
            "group_edge_count": len(group_edges),
            "resolution_rate": resolution_rate,
            "unsupported_languages": unsupported_languages,
        },
    }
