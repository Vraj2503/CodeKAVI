"""
symbol_graph.py — Functions and classes as nodes, calls and inheritance as edges.

Every other graph in this codebase is file-to-file: `A.py imports B.py` tells you
the modules touch, not what either of them *does*. This one works one level down,
on the symbols `complexity.py` already matches while measuring branches — so the
whole thing costs zero extra parses and zero tokens.

Pure function, no I/O, same contract as `graph_assembler.assemble_graph`: dicts in,
graph payload out, safe to call from anywhere and trivial to test for determinism.

One flat tier: the most important symbols in the repo (by `symbol_importance`,
adaptively counted, hard exclusions applied — see "Per-symbol importance"
below), connected by their real call/inheritance relationships. A repo's symbol
graph is a hairball (665 nodes / 806 edges here) and the obvious fix is the
wrong one: ranking symbols and keeping the top 25 leaves 7 edges standing,
since the arrows ran through the mid-tier functions the cut removed.
`_contract_edges` fixes this by BFS-bridging through the cut symbols instead of
dropping what routed through them — see its docstring.

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

#: Adaptive count for the function-level "important" set — same floor/clamp
#: shape as the group selection above, retargeted at symbols. A symbol is a
#: candidate at all only if it clears the hard exclusions in `_is_excluded`;
#: among candidates, importance clearing `IMPORTANT_SYMBOL_FLOOR` of the top
#: score is marked `important: True`, clamped to `[MIN, MAX]`.
IMPORTANT_SYMBOL_FLOOR = 0.20
MIN_IMPORTANT_SYMBOLS = 15
MAX_IMPORTANT_SYMBOLS = 40

#: How far a `calls` chain may run through cut, non-important glue functions
#: before the branch is abandoned — same "cut and disclose" philosophy as
#: `MAX_GRAPH_NODES`, just applied per-branch instead of per-node.
MAX_TRANSITIVE_HOPS = 4

#: Cap on the contracted edge list `_contract_edges` returns. Direct edges are
#: kept first, then transitive ones by fewest hops, so a hairball of important
#: symbols degrades to "the closest relationships" rather than an arbitrary cut.
MAX_TRANSITIVE_EDGES = 400

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

#: Directories that mark a file as frontend UI rather than application logic —
#: cast wide per the user's call to capture as many conventions as possible,
#: not just this repo's `components/`/`hooks/`.
_FRONTEND_DIR = re.compile(r"(?:^|/)(components|pages|app|hooks|layouts|src|ui|screens|views)/")


def _node_id(path: str, name: str) -> str:
    return f"{path}::{name}"


def _http_route(decorators: list[str] | None) -> str | None:
    for decorator in decorators or []:
        match = _ROUTE_DECORATOR.search(decorator)
        if match:
            return f"{match.group(1).upper()} {match.group(2)}"
    return None


# ── Per-symbol importance ──
#
# Hard exclusions never become candidates for `important`, no matter how high
# their fan-in — a getter with twenty callers is still a getter. `role == "test"`
# is deprioritized instead (sorted last), not excluded here, mirroring the
# groups' "tests sort last, not out".


def _is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def _is_accessor(name: str, decorators: list[str], loc: int, out_degree: int) -> bool:
    if any("@property" in d or ".setter" in d or ".deleter" in d for d in decorators):
        return True
    return name.startswith(("get_", "set_", "is_")) and loc <= 2 and out_degree == 0


def _is_trivial_wrapper(node: dict) -> bool:
    return (
        node["loc"] <= 1
        and node["out_degree"] <= 1
        and node["in_degree"] == 0
        and not node["effects"]
        and not node["http"]
        and not node["doc"]
        and not node["external_calls"]
    )


def _is_isolated_leaf(node: dict) -> bool:
    return (
        node["in_degree"] == 0
        and node["out_degree"] == 0
        and not node["effects"]
        and not node["http"]
        and not node["external_calls"]
    )


def _is_ui_wrapper(node: dict) -> bool:
    """A top-level React/Next-style component: nothing calls it (it's an entry
    point the framework invokes), it does nothing effectful itself, and it
    sits in a frontend directory. Scores well on out_degree/cross_file_reach
    from the hooks and API calls it makes, but it's a shallow wrapper over
    them, not the behavior itself."""
    return (
        node["role"] in ("leaf", "internal_helper")
        and node["in_degree"] == 0
        and not node["effects"]
        and not node["http"]
        and node["label"][:1].isupper()
        and bool(_FRONTEND_DIR.search(node["file"]))
    )


def _is_excluded(node: dict, decorators: list[str]) -> bool:
    return (
        _is_dunder(node["label"])
        or _is_accessor(node["label"], decorators, node["loc"], node["out_degree"])
        or _is_trivial_wrapper(node)
        or _is_isolated_leaf(node)
        or _is_ui_wrapper(node)
    )


def _symbol_importance_maxima(candidates: list[dict]) -> tuple[int, int, int, int]:
    if not candidates:
        return (0, 0, 0, 0)
    return (
        max(n["in_degree"] for n in candidates),
        max(n["out_degree"] for n in candidates),
        max(n["cross_file_reach"] for n in candidates),
        max(n["effect_signal"] for n in candidates),
    )


def _compute_symbol_importance(
    in_degree: int,
    out_degree: int,
    cross_file_reach: int,
    effect_signal: int,
    maxima: tuple[int, int, int, int],
) -> float:
    """Four terms, 25 points each, normalized against the max of that term among
    non-excluded candidates. Filename is never a signal — reach/effects are about
    behavior, not the path string."""
    max_in, max_out, max_reach, max_effect = maxima
    score = 0.0
    score += 25 * in_degree / max_in if max_in else 0.0
    score += 25 * out_degree / max_out if max_out else 0.0
    score += 25 * cross_file_reach / max_reach if max_reach else 0.0
    score += 25 * effect_signal / max_effect if max_effect else 0.0
    return round(score, 2)


def _contract_edges(
    edges: dict[tuple[str, str, str], dict[str, str]], important_ids: set[str]
) -> tuple[list[dict], bool]:
    """
    Collapse the full call graph onto the important-symbol set without
    stranding edges that route through cut glue functions.

    For each important node `A`, BFS outward over `calls` edges. The first
    time a branch reaches another important node `B`, record `A -> B` and stop
    expanding that branch — `B` has its own BFS covering what's downstream of
    it. A branch that never reaches an important node within
    `MAX_TRANSITIVE_HOPS` is dropped, same as a symbol that misses the node
    budget. BFS visits nodes in increasing-depth order, so the first path found
    to any node is the shortest one.

    `inherits` edges are direct-only — a straight filter, no BFS.
    """
    calls_adj: dict[str, list[str]] = {}
    for source, target, label in edges:
        if label == "calls":
            calls_adj.setdefault(source, []).append(target)

    contracted: dict[tuple[str, str], dict[str, Any]] = {}
    for start in important_ids:
        visited = {start}
        queue: list[tuple[str, list[str], int]] = [(succ, [], 1) for succ in calls_adj.get(start, [])]
        head = 0
        while head < len(queue):
            node, via, hops = queue[head]
            head += 1
            if node in visited:
                continue
            visited.add(node)
            if node in important_ids:
                contracted[(start, node)] = (
                    {"source": start, "target": node, "kind": "calls_direct", "hops": 1}
                    if hops == 1
                    else {"source": start, "target": node, "kind": "calls_transitive", "hops": hops, "via": via[:3]}
                )
                continue
            if hops >= MAX_TRANSITIVE_HOPS:
                continue
            for succ in calls_adj.get(node, ()):
                if succ not in visited:
                    queue.append((succ, via + [node], hops + 1))

    for source, target, label in edges:
        if label == "inherits" and source in important_ids and target in important_ids:
            contracted[(source, target)] = {"source": source, "target": target, "kind": "inherits", "hops": 1}

    result = sorted(
        contracted.values(), key=lambda e: (e["kind"] != "calls_direct", e["hops"], e["source"], e["target"])
    )
    truncated = len(result) > MAX_TRANSITIVE_EDGES
    return result[:MAX_TRANSITIVE_EDGES], truncated


def build_symbol_graph(
    symbols_by_file: dict[str, list[dict[str, Any]]],
    file_profiles: list[dict],
    dep_data: dict,
) -> dict:
    """
    Assemble the symbol-level graph: the important symbols in the repo, connected
    by their real call/inheritance relationships (contracted through cut glue —
    see `_contract_edges`).

    Args:
        symbols_by_file: `{rel_path: [symbol record]}` from classify_files(symbols_out=...).
        file_profiles:   classify_files() output, dict-shaped — supplies role/importance.
        dep_data:        DepGraph, dict-shaped — `adjacency` drives cross-file resolution.

    Returns:
        `{nodes, edges, metadata, diagnostics}` — see the module docstring.
    """
    profile_map = {p.get("path"): p for p in file_profiles or []}
    adjacency = dep_data.get("adjacency") or {}

    # ── Symbol table ──
    nodes: dict[str, dict[str, Any]] = {}
    by_file_name: dict[tuple[str, str], str] = {}  # (path, name) → node id
    by_name: dict[str, list[str]] = {}  # name → node ids, for the repo-wide fallback
    decorators_by_id: dict[str, list[str]] = {}  # for _is_accessor; not part of the payload
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
            decorators_by_id[node_id] = symbol.get("decorators") or []

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

    # Files reached by each node's edges, in either direction — the raw material
    # for `cross_file_reach`. Built alongside degree since both walk the same
    # edge set once.
    cross_file_by_id: dict[str, set[str]] = {}
    for edge in edges.values():
        nodes[edge["source"]]["out_degree"] += 1
        nodes[edge["target"]]["in_degree"] += 1
        source_file = nodes[edge["source"]]["file"]
        target_file = nodes[edge["target"]]["file"]
        if source_file != target_file:
            cross_file_by_id.setdefault(edge["source"], set()).add(target_file)
            cross_file_by_id.setdefault(edge["target"], set()).add(source_file)

    for node_id, node in nodes.items():
        node["cross_file_reach"] = len(cross_file_by_id.get(node_id, ()))
        node["effect_signal"] = len(node["effects"]) + (1 if node["http"] else 0)

    excluded_ids = {node_id for node_id, node in nodes.items() if _is_excluded(node, decorators_by_id.get(node_id, []))}
    importance_candidates = [n for n in nodes.values() if n["id"] not in excluded_ids]
    maxima = _symbol_importance_maxima(importance_candidates)
    for node in nodes.values():
        node["symbol_importance"] = (
            0.0
            if node["id"] in excluded_ids
            else _compute_symbol_importance(
                node["in_degree"], node["out_degree"], node["cross_file_reach"], node["effect_signal"], maxima
            )
        )

    ranked_candidates = sorted(
        importance_candidates,
        key=lambda n: (n["role"] == "test", -n["symbol_importance"], -n["in_degree"], n["id"]),
    )
    top_symbol_importance = ranked_candidates[0]["symbol_importance"] if ranked_candidates else 0.0
    above_symbol_floor = sum(
        1 for n in ranked_candidates if n["symbol_importance"] >= top_symbol_importance * IMPORTANT_SYMBOL_FLOOR
    )
    important_count = min(max(above_symbol_floor, MIN_IMPORTANT_SYMBOLS), MAX_IMPORTANT_SYMBOLS, len(ranked_candidates))
    important_ids = {n["id"] for n in ranked_candidates[:important_count]}
    for node in nodes.values():
        node["important"] = node["id"] in important_ids

    # ── Cut to the important set, then bridge across what got cut ──
    # `ranked_candidates` is already sorted by the selection key (including the
    # -in_degree tiebreak that keeps importance ties from falling back to
    # alphabetical id order) — slicing it keeps that order instead of re-deriving
    # a weaker one from the id set.
    kept = ranked_candidates[:important_count]
    contracted_edges, edges_truncated = _contract_edges(edges, important_ids)

    languages_present = {p.get("language") for p in file_profiles or []}
    unsupported_languages = sorted((languages_present & SUPPORTED_LANGUAGES) - SYMBOL_LANGUAGES)

    attempts = resolved_calls + unresolved_calls
    resolution_rate = round(resolved_calls / attempts, 3) if attempts else 1.0

    return {
        "nodes": kept,
        "edges": contracted_edges,
        "metadata": {
            "total_symbols": total_symbols,
            "important_symbols": len(kept),
            "resolved_calls": resolved_calls,
            "unresolved_calls": unresolved_calls,
            "edges_truncated": edges_truncated,
            "unsupported_languages": unsupported_languages,
        },
        # Shape the existing DiagnosticsBanner already reads.
        "diagnostics": {
            "node_count": len(kept),
            "edge_count": len(contracted_edges),
            "resolution_rate": resolution_rate,
            "unsupported_languages": unsupported_languages,
        },
    }
