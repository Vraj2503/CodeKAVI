"""
codekavi.tour_generator — Zero-LLM architecture tour via Kahn's algorithm.

Used as a deterministic fallback for the /explain endpoints when the LLM
provider (Groq, Gemini) is rate-limited, down, or slow. Produces an ordered
list of file-level tour stops that the frontend can render even when the
LLM-generated summary is missing.

Behaviour:
  * Topologically order files via Kahn's algorithm so dependencies precede
    dependents (the same precedence the LLM is asked to follow).
  * If the graph has cycles, Kahn's algorithm will not reach cyclic nodes.
    Append those nodes after the DAG-ordered ones, sorted by importance
    desc so the most-central/least-clear files surface first.
  * All insertion orderings are explicitly sorted so the output is
    deterministic across calls (asserted in test_tour_generator.py).

Public surface:
  * ``generate_deterministic_tour(dep_data, file_profiles=None, max_steps=25)``
  * ``generate_learn_tour(graph)`` — learn-mode step order for the graph tour
    (spec 2026-07-25-graph-and-tour-design.md §8): layer-tier bottom-up,
    dependency order within a tier.
  * ``generate_recall_tour(graph)`` — recall-mode step order: importance_score
    desc, then flagged files.
  * ``generate_questions(file, cycle_partners=None)`` — flag-to-template
    interview questions (spec §8); ``build_cycle_partners(cycles)`` builds
    the lookup ``in_cycle`` questions need.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any


def _kahn_order(all_nodes: set[str], adjacency: dict[str, list[str]]) -> list[str]:
    """Deterministic Kahn's topological sort. Returns only the nodes reachable
    by the sort (i.e. not part of a cycle) — the caller decides how to place
    the rest."""
    in_degree: dict[str, int] = {n: 0 for n in all_nodes}
    for _src, targets in adjacency.items():
        for t in targets if isinstance(targets, list) else [targets]:
            if t in in_degree:
                in_degree[t] += 1

    queue: deque[str] = deque(sorted(n for n in all_nodes if in_degree[n] == 0))
    order: list[str] = []
    seen: set[str] = set()
    while queue:
        node = queue.popleft()
        if node in seen:
            continue
        seen.add(node)
        order.append(node)
        for t in sorted(adjacency.get(node, [])):
            if t in in_degree:
                in_degree[t] -= 1
                if in_degree[t] == 0:
                    queue.append(t)
    return order


def generate_deterministic_tour(
    dep_data: dict,
    file_profiles: list[dict] | None = None,
    max_steps: int = 25,
) -> list[dict[str, Any]]:
    """Produce a topology-ordered architecture tour with zero LLM cost.

    Args:
        dep_data:       Output of analyze_dependencies() — must contain an
                        ``adjacency`` mapping of ``src -> list[str]``.
        file_profiles:  Optional list of classify_files() output; when present,
                        role/importance fields are joined onto each stop.
        max_steps:      Hard cap on tour length (default 25).

    Returns:
        Ordered list of ``{file, role, role_label, importance, description,
        connections}`` dicts. The first N stops follow the deterministic
        Kahn's order (acyclic); any cyclic nodes are appended after, sorted
        by importance desc.
    """
    adjacency = dep_data.get("adjacency", {}) or {}

    # Build the full node set. Kahn's needs every node — both sources and
    # targets — regardless of whether they appear as a key in adjacency.
    all_nodes: set[str] = set(adjacency.keys())
    for _src, targets in adjacency.items():
        target_list = targets if isinstance(targets, list) else [targets]
        all_nodes.update(target_list)

    if not all_nodes:
        return []

    order = _kahn_order(all_nodes, adjacency)

    # Fallthrough: cyclic nodes were never reached by Kahn's. Surface them
    # anyway so the tour covers all known files. Sort by importance desc so
    # the most-central/least-clear cyclic files come first; ties broken by
    # path (alphabetical) so the output is deterministic.
    profile_map: dict[str, dict[str, Any]] = {}
    if file_profiles:
        profile_map = {p.get("path", ""): p for p in file_profiles if p.get("path")}

    acyclic_set = set(order)
    remaining = [n for n in all_nodes if n not in acyclic_set]
    remaining.sort(
        key=lambda n: (
            -int(profile_map.get(n, {}).get("importance_score", 0) or 0),
            n,
        )
    )

    full_order = order + remaining
    truncated = full_order[:max_steps]

    tour: list[dict[str, Any]] = []
    for path in truncated:
        p = profile_map.get(path, {})
        deps = adjacency.get(path, [])
        dep_list = deps if isinstance(deps, list) else [deps]
        tour.append(
            {
                "file": path,
                "role": p.get("role", "unknown"),
                "role_label": p.get("role_label", "Unknown"),
                "importance": p.get("importance_score", 0),
                "description": (f"{p.get('role_label', 'File') or 'File'} that imports {len(dep_list)} module(s)"),
                "connections": [d for d in dep_list if isinstance(d, str)][:5],
            }
        )

    return tour


def _important_ids(files: list[dict], top_n: int = 15) -> set[str]:
    """Cap a tour to the files worth walking through: the top-N by importance,
    plus any file flagged as notable (hub/entry_point/orphan/in_cycle/god_file)
    regardless of rank."""
    by_importance = sorted(files, key=lambda f: -(f.get("importance") or 0))
    keep = {f["id"] for f in by_importance[:top_n]}
    keep |= {f["id"] for f in files if f.get("flags")}
    return keep


def generate_learn_tour(graph: dict) -> list[dict[str, Any]]:
    """Learn-mode step order (spec §8): layer-tier bottom-up — config/types
    before core logic before routes — with dependency order as the tie-break
    within a tier.

    Unlike ``generate_deterministic_tour``, every file in ``graph["files"]``
    gets a step even if it has zero edges: orphaned files are exactly what
    the flag-question mechanism needs to surface, so they can't be silently
    dropped the way an adjacency-only node set would drop them.

    Args:
        graph: Output of ``assemble_graph()`` — needs ``files`` (each with
               ``id``, ``layer_id``, ``importance``) and ``layers`` (each
               with ``id``, ``tier``), plus file-level ``edges``.

    Returns:
        Ordered list of ``{order, node_ids, layer_id}`` steps, one per file.
    """
    files = graph.get("files", [])
    if not files:
        return []

    files_by_id = {f["id"]: f for f in files}
    tier_by_layer = {layer["id"]: layer.get("tier", 0) for layer in graph.get("layers", [])}

    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in graph.get("edges", []):
        if edge.get("level") == "file":
            adjacency[edge["source"]].append(edge["target"])

    all_nodes = _important_ids(files)
    order = _kahn_order(all_nodes, adjacency)

    # Cyclic/unreached files, most important first, path as tie-break.
    remaining = [n for n in all_nodes if n not in set(order)]
    remaining.sort(key=lambda n: (-(files_by_id[n].get("importance") or 0), n))

    full_order = order + remaining
    # Stable sort: preserves the dependency/importance order above within
    # each tier, so "bottom-up by layer" and "dependency order" both hold.
    full_order.sort(key=lambda n: tier_by_layer.get(files_by_id[n].get("layer_id"), 0))

    return [
        {
            "order": i,
            "node_ids": [file_id],
            "layer_id": files_by_id[file_id].get("layer_id"),
        }
        for i, file_id in enumerate(full_order, start=1)
    ]


def generate_recall_tour(graph: dict) -> list[dict[str, Any]]:
    """Recall-mode step order (spec §8): importance_score desc, then flagged
    files — the opposite shape of learn mode. Dependency order front-loads
    plumbing, which is wrong for someone who already built the thing; what
    jogs memory is the salient and unusual file, not the one nothing depends
    on yet.

    Reuses the same tie-break seed as ``generate_deterministic_tour``'s
    cyclic fallback (``-importance, path``), extended with a flagged-first
    tie-break so a flagged file outranks an unflagged one at equal importance.

    Args:
        graph: Output of ``assemble_graph()`` — needs ``files`` (each with
               ``id``, ``layer_id``, ``importance``, ``flags``).

    Returns:
        Ordered list of ``{order, node_ids, layer_id}`` steps, one per file.
    """
    files = graph.get("files", [])
    if not files:
        return []

    important = _important_ids(files)
    order = sorted((f for f in files if f["id"] in important), key=_recall_sort_key)

    return [
        {
            "order": i,
            "node_ids": [f["id"]],
            "layer_id": f.get("layer_id"),
        }
        for i, f in enumerate(order, start=1)
    ]


def _recall_sort_key(file: dict) -> tuple[float, int, str]:
    return (-(file.get("importance") or 0), 0 if file.get("flags") else 1, file["id"])


# graph_assembler's byte-size proxy for "lines" — the pipeline never reads
# file content to count lines, so this must match GOD_FILE_MIN_SIZE's ratio.
_GOD_FILE_BYTES_PER_LINE = 40


def build_cycle_partners(cycles: list[list[str]]) -> dict[str, list[str]]:
    """path -> sorted list of other paths sharing a detected cycle with it.

    ``cycles`` is ``detect_cycles(dep_data)["cycles"]`` (graph.py) — each
    inner list is one closed loop of file paths (first == last)."""
    partners: dict[str, set[str]] = defaultdict(set)
    for cycle in cycles:
        members = set(cycle[:-1]) if len(cycle) > 1 and cycle[0] == cycle[-1] else set(cycle)
        for path in members:
            partners[path].update(m for m in members if m != path)
    return {path: sorted(others) for path, others in partners.items()}


def _file_facts(file: dict, step: dict[str, Any] | None = None) -> list[str]:
    facts = [file.get("role_label") or "File"]
    in_degree, out_degree = file.get("in_degree", 0), file.get("out_degree", 0)
    facts.append(f"{in_degree} file(s) depend on this; it depends on {out_degree}")
    return facts


def assemble_tour(graph: dict, mode: str) -> dict[str, Any]:
    """Assemble the full E5 tour response (spec §8): title/facts/questions
    layered onto the deterministic step skeleton from ``generate_learn_tour``
    / ``generate_recall_tour``. Zero LLM calls — prose is optional polish
    (E4), not the mechanism.

    Args:
        graph: Output of ``assemble_graph()``.
        mode: ``"learn"`` or ``"recall"``.
    """
    steps = generate_learn_tour(graph) if mode == "learn" else generate_recall_tour(graph)
    return _decorate_tour(graph, mode, steps)


def resolve_question_nodes(graph: dict, search_results: list[dict[str, Any]]) -> list[str]:
    """G1: zilliz search hits -> ordered, deduped graph node ids.

    ``search_results`` is ``zilliz_client.search()`` output, already sorted
    by score desc — that order IS the retrieval rank, so this just dedupes
    by file_path (a file can surface via multiple chunks) and drops hits
    whose file_path isn't a node in this graph (stale index vs. the current
    analysis, or a chunk from something the graph doesn't surface).
    """
    node_ids = {f["id"] for f in graph.get("files", [])}
    seen: set[str] = set()
    resolved: list[str] = []
    for hit in search_results:
        path = hit.get("file_path")
        if path and path in node_ids and path not in seen:
            seen.add(path)
            resolved.append(path)
    return resolved


def generate_question_tour(graph: dict, node_ids: list[str]) -> list[dict[str, Any]]:
    """G2: question-mode step order — tier order via the same Kahn's pass
    ``generate_learn_tour`` uses, restricted to ``node_ids``; nodes Kahn's
    doesn't reach (cyclic) fall back to retrieval rank, same tie-break shape
    as the learn/recall generators.
    """
    files_by_id = {f["id"]: f for f in graph.get("files", [])}
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in graph.get("edges", []):
        if edge.get("level") == "file":
            adjacency[edge["source"]].append(edge["target"])

    kahn_rank = {n: i for i, n in enumerate(_kahn_order(set(files_by_id), adjacency))}
    retrieval_rank = {n: i for i, n in enumerate(node_ids)}

    ordered = sorted(node_ids, key=lambda n: (kahn_rank.get(n, len(kahn_rank)), retrieval_rank[n]))

    return [
        {"order": i, "node_ids": [n], "layer_id": files_by_id[n].get("layer_id")}
        for i, n in enumerate(ordered, start=1)
    ]


def assemble_question_tour(graph: dict, search_results: list[dict[str, Any]]) -> dict[str, Any]:
    """G3 support: question-driven tour assembled from RAG search hits (G1+G2)."""
    node_ids = resolve_question_nodes(graph, search_results)
    steps = generate_question_tour(graph, node_ids)
    return _decorate_tour(graph, "question", steps)


def _decorate_tour(
    graph: dict,
    mode: str,
    steps: list[dict[str, Any]],
    facts_fn: Any = _file_facts,
) -> dict[str, Any]:
    files_by_id = {f["id"]: f for f in graph.get("files", [])}
    cycle_partners = build_cycle_partners(graph.get("insights", {}).get("cycles", []))

    return {
        "mode": mode,
        "steps": [
            {
                **step,
                "title": files_by_id[step["node_ids"][0]]["name"],
                "facts": facts_fn(files_by_id[step["node_ids"][0]], step),
                "questions": generate_questions(files_by_id[step["node_ids"][0]], cycle_partners),
            }
            for step in steps
        ],
    }


# H2: STRUCTURAL surfaces before COSMETIC — a changed import/export/function
# is more likely to need a look than a reformatted comment.
_DIFF_TYPE_ORDER = {"STRUCTURAL": 0, "COSMETIC": 1}


def generate_diff_tour(graph: dict, change_map: dict[str, str]) -> list[dict[str, Any]]:
    """H2: diff-tour step order — files from ``change_map`` (H1's
    ``last_change_map``) restricted to STRUCTURAL/COSMETIC changes that still
    have a node in the current graph. STRUCTURAL first, COSMETIC after;
    importance desc within each group, path as the final tie-break.

    Paths in ``change_map`` with no matching graph node — deleted since the
    last analysis — have nothing to highlight on the canvas, so they're
    dropped here; ``assemble_diff_tour`` counts them instead (H4's banner).
    """
    files_by_id = {f["id"]: f for f in graph.get("files", [])}
    changed = [
        (path, change_type)
        for path, change_type in change_map.items()
        if change_type in _DIFF_TYPE_ORDER and path in files_by_id
    ]
    changed.sort(
        key=lambda pc: (
            _DIFF_TYPE_ORDER[pc[1]],
            -(files_by_id[pc[0]].get("importance") or 0),
            pc[0],
        )
    )

    return [
        {
            "order": i,
            "node_ids": [path],
            "layer_id": files_by_id[path].get("layer_id"),
            "change_type": change_type,
        }
        for i, (path, change_type) in enumerate(changed, start=1)
    ]


def _diff_facts(file: dict, step: dict[str, Any] | None = None) -> list[str]:
    change_type = (step or {}).get("change_type")
    if change_type == "STRUCTURAL":
        return [file.get("role_label") or "File", "Structural change — imports, exports, or functions changed"]
    return [file.get("role_label") or "File", "Cosmetic change — content edited, structure unchanged"]


def assemble_diff_tour(graph: dict, change_map: dict[str, str]) -> dict[str, Any]:
    """H2/H3 support: diff tour assembled from ``change_map`` (H1's
    ``last_change_map``), decorated with change-kind facts instead of the
    usual role/fan-in line.

    ``deleted_count`` is paths present in ``change_map`` but no longer a
    graph node — H4 renders this as a one-line banner above the stepper
    rather than inventing steps with no node to highlight.
    """
    files_by_id = {f["id"]: f for f in graph.get("files", [])}
    steps = generate_diff_tour(graph, change_map)
    result = _decorate_tour(graph, "diff", steps, facts_fn=_diff_facts)
    result["deleted_count"] = sum(1 for path in change_map if path not in files_by_id)
    return result


def generate_questions(file: dict, cycle_partners: dict[str, list[str]] | None = None) -> list[str]:
    """Flag -> template interview question (spec §8, "Question anticipation").
    Zero LLM, fully deterministic — one question per active flag.

    ``file["flags"]`` is already emitted in ``graph_assembler.FLAG_ORDER``
    (graph_assembler.py), so iterating it in place keeps question order
    stable without re-importing that constant.

    Args:
        file: A ``graph["files"]`` entry — needs ``id``, ``flags``, ``size``.
        cycle_partners: Output of ``build_cycle_partners``; only needed when
            the file carries an ``in_cycle`` flag.
    """
    cycle_partners = cycle_partners or {}
    questions: list[str] = []
    for flag in file.get("flags") or []:
        if flag == "orphan":
            questions.append("Nothing imports this file. Why is it in the repo?")
        elif flag == "in_cycle":
            partners = cycle_partners.get(file["id"], [])
            other = partners[0] if partners else "another module"
            questions.append(f"This and {other} import each other — why, and would you fix it?")
        elif flag == "hub":
            questions.append("A lot depends on this. What breaks if you change it?")
        elif flag == "entry_point":
            questions.append("Walk me through what happens when a request arrives.")
        elif flag == "god_file":
            lines = max(1, (file.get("size") or 0) // _GOD_FILE_BYTES_PER_LINE)
            questions.append(f"This file is ~{lines:,} lines. How would you split it?")
    return questions
