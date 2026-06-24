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
"""

from __future__ import annotations

from collections import deque
from typing import Any


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
    for src, targets in adjacency.items():
        target_list = targets if isinstance(targets, list) else [targets]
        all_nodes.update(target_list)

    if not all_nodes:
        return []

    # In-degree map keyed only over known nodes (avoids KeyError if an edge
    # points at an unknown target).
    in_degree: dict[str, int] = {n: 0 for n in all_nodes}
    for src, targets in adjacency.items():
        target_list = targets if isinstance(targets, list) else [targets]
        for t in target_list:
            if t in in_degree:
                in_degree[t] += 1

    # Kahn's algorithm. Insertion order is sorted so the output is fully
    # deterministic — running this function twice on identical input yields
    # byte-identical output.
    queue: deque[str] = deque(sorted(n for n in all_nodes if in_degree[n] == 0))
    order: list[str] = []
    seen: set[str] = set()
    while queue:
        node = queue.popleft()
        if node in seen:
            continue
        seen.add(node)
        order.append(node)
        targets = adjacency.get(node, [])
        target_list = targets if isinstance(targets, list) else [targets]
        for t in sorted(target_list):  # sorted for determinism
            if t in in_degree:
                in_degree[t] -= 1
                if in_degree[t] == 0:
                    queue.append(t)

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
                "description": (
                    f"{p.get('role_label', 'File') or 'File'} that imports "
                    f"{len(dep_list)} module(s)"
                ),
                "connections": [d for d in dep_list if isinstance(d, str)][:5],
            }
        )

    return tour
