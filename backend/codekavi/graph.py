"""
graph.py — Dependency graph transformations and export formats.

Converts raw dependency data from analyzer.py into:
  1. Visualization-ready JSON (nodes + edges) for D3 / Cytoscape / frontend
  2. DOT format for Graphviz rendering
  3. Mermaid diagram syntax
  4. Module/package-level grouping (collapse file→file into dir→dir)
  5. Circular dependency detection (DFS-based cycle finding)
"""

import os
from collections import defaultdict
from typing import Any, cast

# ─────────────────────────────────────────────
# 1. Visualization-ready JSON export
# ─────────────────────────────────────────────


def export_graph_json(dep_data: dict, file_profiles: list[dict] | None = None) -> dict:
    """
    Convert dependency data into a { nodes, edges, metadata } structure
    suitable for visualization libraries (D3.js, Cytoscape, vis.js, etc.).

    Args:
        dep_data:       Output from analyze_dependencies().
        file_profiles:  Optional output from classify_files() for enriched nodes.

    Returns:
        dict with:
          - nodes: list of { id, label, group, role, importance, in_degree, out_degree, ... }
          - edges: list of { source, target, raw, line, type }
          - metadata: { total_nodes, total_edges, connected_nodes, isolated_nodes }
    """
    # Build a profile lookup for enrichment
    profile_map = {}
    if file_profiles:
        for p in file_profiles:
            profile_map[p["path"]] = p

    adjacency = dep_data.get("adjacency", {})
    reverse_adjacency = dep_data.get("reverse_adjacency", {})
    edges_raw = dep_data.get("edges", [])
    entry_point_set = {ep["file"] for ep in dep_data.get("entry_points", [])}

    # Collect all files that participate in the graph
    all_connected = set()
    for e in edges_raw:
        all_connected.add(e["source"])
        all_connected.add(e["target"])

    # Build nodes
    nodes = []
    for file_path in sorted(all_connected):
        profile = profile_map.get(file_path, {})
        in_deg = len(reverse_adjacency.get(file_path, []))
        out_deg = len(adjacency.get(file_path, []))

        # Determine group from top-level directory
        parts = file_path.split(os.sep)
        group = parts[0] if len(parts) > 1 else "(root)"

        node = {
            "id": file_path,
            "label": os.path.basename(file_path),
            "group": group,
            "full_path": file_path,
            "in_degree": in_deg,
            "out_degree": out_deg,
            "role": profile.get("role", "unknown"),
            "role_label": profile.get("role_label", "Unknown"),
            "importance": profile.get("importance_score", 0),
            "language": profile.get("language", "Unknown"),
            "is_entry_point": file_path in entry_point_set,
            "size": _node_size(in_deg, out_deg),
        }
        nodes.append(node)

    # Build edges
    edges = []
    for e in edges_raw:
        edges.append(
            {
                "source": e["source"],
                "target": e["target"],
                "raw": e.get("raw", ""),
                "line": e.get("line"),
                "type": e.get("type", "import"),
            }
        )

    # Deduplicate edges (same source→target may appear multiple times)
    seen_edges = set()
    deduped_edges = []
    for e in edges:
        key = (e["source"], e["target"])
        if key not in seen_edges:
            seen_edges.add(key)
            deduped_edges.append(e)

    return {
        "nodes": nodes,
        "edges": deduped_edges,
        "metadata": {
            "total_nodes": len(nodes),
            "total_edges": len(deduped_edges),
            "connected_nodes": len(all_connected),
            "groups": sorted(set(n["group"] for n in nodes)),
        },
    }


def _node_size(in_deg: int, out_deg: int) -> str:
    """Classify node visual size based on connectivity."""
    total = in_deg + out_deg
    if total >= 10:
        return "xl"
    elif total >= 6:
        return "lg"
    elif total >= 3:
        return "md"
    elif total >= 1:
        return "sm"
    return "xs"


# ─────────────────────────────────────────────
# 2. DOT format export (Graphviz)
# ─────────────────────────────────────────────

_ROLE_COLORS = {
    "entry_point": "#34d399",  # green
    "orchestrator": "#fbbf24",  # amber
    "core_module": "#a78bfa",  # violet
    "shared_utility": "#06b6d4",  # cyan
    "internal_helper": "#8b95a5",  # gray
    "router": "#f472b6",  # pink
    "config": "#fb923c",  # orange
    "test": "#94a3b8",  # slate
    "type_definition": "#818cf8",  # indigo
    "leaf": "#64748b",  # dim gray
    "documentation": "#a1a1aa",  # zinc
    "build": "#78716c",  # stone
    "barrel": "#7dd3fc",  # light blue
    "data": "#d4d4d8",  # light gray
}


def export_dot(graph_json: dict, title: str = "CodeKavi Dependency Graph") -> str:
    """
    Convert graph JSON to Graphviz DOT format.

    Args:
        graph_json: Output from export_graph_json().
        title:      Graph title.

    Returns:
        DOT format string.
    """
    lines = [
        f'digraph "{_dot_escape(title)}" {{',
        "    rankdir=LR;",
        '    bgcolor="transparent";',
        '    node [shape=box, style="rounded,filled", fontname="Inter", fontsize=10];',
        '    edge [color="#555555", arrowsize=0.7];',
        "",
    ]

    # Group nodes by directory using subgraphs
    groups: dict[str, list] = defaultdict(list)
    for node in graph_json["nodes"]:
        groups[node["group"]].append(node)

    for group_name, group_nodes in sorted(groups.items()):
        cluster_name = _dot_escape(group_name).replace(".", "_").replace("/", "_")
        lines.append(f"    subgraph cluster_{cluster_name} {{")
        lines.append(f'        label="{_dot_escape(group_name)}";')
        lines.append('        style="rounded,dashed";')
        lines.append('        color="#444444";')
        lines.append('        fontname="Inter";')
        lines.append("        fontsize=11;")
        lines.append('        fontcolor="#888888";')
        lines.append("")

        for node in group_nodes:
            color = _ROLE_COLORS.get(node["role"], "#64748b")
            lines.append(
                f'        "{_dot_escape(node["id"])}" '
                f'[label="{_dot_escape(node["label"])}", '
                f'fillcolor="{color}", fontcolor="white", '
                f'tooltip="{_dot_escape(node["role_label"])}"];'
            )
        lines.append("    }")
        lines.append("")

    # Edges
    for edge in graph_json["edges"]:
        lines.append(f'    "{_dot_escape(edge["source"])}" -> "{_dot_escape(edge["target"])}";')

    lines.append("}")
    return "\n".join(lines)


def _dot_escape(s: str) -> str:
    """Escape special characters for DOT format."""
    return s.replace('"', '\\"').replace("\\", "\\\\")


# ─────────────────────────────────────────────
# 3. Mermaid diagram export
# ─────────────────────────────────────────────

_MERMAID_ROLE_STYLES = {
    "entry_point": "fill:#34d399,stroke:#059669,color:#000",
    "orchestrator": "fill:#fbbf24,stroke:#d97706,color:#000",
    "core_module": "fill:#a78bfa,stroke:#7c3aed,color:#fff",
    "shared_utility": "fill:#06b6d4,stroke:#0891b2,color:#fff",
    "internal_helper": "fill:#8b95a5,stroke:#64748b,color:#fff",
    "router": "fill:#f472b6,stroke:#db2777,color:#000",
    "config": "fill:#fb923c,stroke:#ea580c,color:#000",
    "test": "fill:#94a3b8,stroke:#64748b,color:#000",
    "type_definition": "fill:#818cf8,stroke:#6366f1,color:#fff",
    "leaf": "fill:#64748b,stroke:#475569,color:#fff",
}


def export_mermaid(
    graph_json: dict,
    direction: str = "LR",
    max_nodes: int = 50,
) -> str:
    """
    Convert graph JSON to Mermaid flowchart syntax.

    Args:
        graph_json: Output from export_graph_json().
        direction:  Diagram direction (LR, TB, RL, BT).
        max_nodes:  Maximum nodes to include (most important first).

    Returns:
        Mermaid flowchart string.
    """
    nodes = graph_json["nodes"]
    edges = graph_json["edges"]

    # If too many nodes, keep only the most important
    if len(nodes) > max_nodes:
        nodes = sorted(nodes, key=lambda n: n["importance"], reverse=True)[:max_nodes]
        included_ids = {n["id"] for n in nodes}
        edges = [e for e in edges if e["source"] in included_ids and e["target"] in included_ids]

    lines = [f"flowchart {direction}"]

    # Group by directory using subgraphs
    groups: dict[str, list] = defaultdict(list)
    for node in nodes:
        groups[node["group"]].append(node)

    node_alias_map = {}
    alias_counter = 0

    for group_name, group_nodes in sorted(groups.items()):
        safe_group = _mermaid_safe_id(group_name)
        lines.append(f'    subgraph {safe_group}["{group_name}"]')

        for node in group_nodes:
            alias = f"n{alias_counter}"
            alias_counter += 1
            node_alias_map[node["id"]] = alias

            label = node["label"]
            # Use different shapes based on role
            if node["role"] == "entry_point":
                lines.append(f'        {alias}(["{label}"])')
            elif node["role"] in ("core_module", "shared_utility"):
                lines.append(f'        {alias}[["{label}"]]')
            elif node["role"] == "config":
                config_label = "{" + label + "}"
                lines.append(f'        {alias}["{config_label}"]')
            else:
                lines.append(f'        {alias}["{label}"]')

        lines.append("    end")

    # Edges
    for edge in edges:
        src = node_alias_map.get(edge["source"])
        tgt = node_alias_map.get(edge["target"])
        if src and tgt:
            lines.append(f"    {src} --> {tgt}")

    # Style classes
    lines.append("")
    role_to_aliases: dict[str, list[str]] = defaultdict(list)
    for node in nodes:
        node_alias = node_alias_map.get(node["id"])
        if node_alias:
            role_to_aliases[node["role"]].append(node_alias)

    for role, style in _MERMAID_ROLE_STYLES.items():
        aliases = role_to_aliases.get(role, [])
        if aliases:
            for alias in aliases:
                lines.append(f"    style {alias} {style}")

    return "\n".join(lines)


def _mermaid_safe_id(s: str) -> str:
    """Create a Mermaid-safe identifier."""
    return "".join(c if c.isalnum() or c == "_" else "_" for c in s)


# ─────────────────────────────────────────────
# 4. Module/package-level grouping
# ─────────────────────────────────────────────


def build_module_graph(
    dep_data: dict,
    file_profiles: list[dict] | None = None,
    depth: int = 1,
) -> dict:
    """
    Collapse file-level dependencies into directory/module-level dependencies.

    Instead of seeing hundreds of file→file edges, this shows which
    top-level directories depend on each other.

    Args:
        dep_data:       Output from analyze_dependencies().
        file_profiles:  Optional output from classify_files() for enrichment.
        depth:          Directory depth for grouping (1 = top-level dirs,
                        2 = second-level dirs, etc.).

    Returns:
        dict with:
          - modules: list of { name, file_count, languages, roles, importance }
          - connections: list of { source, target, weight, files }
          - internal_edges: dict[module] -> edge count within module
          - graph_json: { nodes, edges } ready for visualization
          - mermaid: Mermaid syntax string
    """
    edges = dep_data.get("edges", [])

    # Build profile lookup
    profile_map = {}
    if file_profiles:
        for p in file_profiles:
            profile_map[p["path"]] = p

    # Group files into modules
    file_to_module: dict[str, str] = {}
    module_files: dict[str, set] = defaultdict(set)

    all_files = set()
    for e in edges:
        all_files.add(e["source"])
        all_files.add(e["target"])
    if file_profiles:
        for p in file_profiles:
            all_files.add(p["path"])

    for fpath in all_files:
        module_name = _get_module_name(fpath, depth)
        file_to_module[fpath] = module_name
        module_files[module_name].add(fpath)

    # Count cross-module and internal edges
    cross_edges: dict[tuple[str, str], list] = defaultdict(list)
    internal_edges: dict[str, int] = defaultdict(int)

    for edge in edges:
        src_mod = file_to_module.get(edge["source"], "(root)")
        tgt_mod = file_to_module.get(edge["target"], "(root)")

        if src_mod == tgt_mod:
            internal_edges[src_mod] += 1
        else:
            key = (src_mod, tgt_mod)
            cross_edges[key].append(
                {
                    "source_file": edge["source"],
                    "target_file": edge["target"],
                }
            )

    # Build module metadata
    modules: list[dict[str, Any]] = []
    for mod_name, files in sorted(module_files.items()):
        languages: dict[str, int] = defaultdict(int)
        roles: dict[str, int] = defaultdict(int)
        total_importance = 0

        for fpath in files:
            profile = profile_map.get(fpath, {})
            lang = profile.get("language", "Unknown")
            role = profile.get("role", "unknown")
            languages[lang] += 1
            roles[role] += 1
            total_importance += profile.get("importance_score", 0)

        modules.append(
            {
                "name": mod_name,
                "file_count": len(files),
                "files": sorted(files),
                "languages": dict(sorted(languages.items(), key=lambda x: x[1], reverse=True)),
                "roles": dict(sorted(roles.items(), key=lambda x: x[1], reverse=True)),
                "importance": round(total_importance / len(files), 2) if files else 0,
                "internal_edges": internal_edges.get(mod_name, 0),
            }
        )

    modules.sort(key=lambda m: cast(float, m["importance"]), reverse=True)  # type: ignore[arg-type]

    # Build connections list
    connections: list[dict[str, Any]] = []
    for (src_mod, tgt_mod), file_pairs in sorted(cross_edges.items()):
        connections.append(
            {
                "source": src_mod,
                "target": tgt_mod,
                "weight": len(file_pairs),
                "files": file_pairs,
            }
        )

    connections.sort(key=lambda c: cast(int, c["weight"]), reverse=True)  # type: ignore[arg-type]

    # Build visualization-ready graph for modules
    mod_nodes = []
    for mod in modules:
        in_weight = sum(c["weight"] for c in connections if c["target"] == mod["name"])  # type: ignore[operator]
        out_weight = sum(c["weight"] for c in connections if c["source"] == mod["name"])  # type: ignore[operator]
        languages_keys = list(mod.get("languages", {}).keys())
        primary_lang = languages_keys[0] if languages_keys else "Unknown"
        mod_nodes.append(
            {
                "id": mod["name"],
                "label": mod["name"],
                "group": mod["name"],
                "file_count": mod["file_count"],
                "importance": mod["importance"],
                "in_weight": in_weight,
                "out_weight": out_weight,
                "primary_language": primary_lang,
                "size": _node_size(in_weight, out_weight),
            }
        )

    mod_edges = [{"source": c["source"], "target": c["target"], "weight": c["weight"]} for c in connections]

    # Build Mermaid diagram for module view
    mermaid_lines = ["flowchart LR"]
    mod_alias_map = {}
    for i, mod in enumerate(modules):
        alias = f"m{i}"
        mod_alias_map[mod["name"]] = alias
        label = f"{mod['name']} ({mod['file_count']} files)"
        mermaid_lines.append(f'    {alias}["{label}"]')

    for conn in connections:
        src = mod_alias_map.get(conn["source"])
        tgt = mod_alias_map.get(conn["target"])
        if src and tgt:
            if conn["weight"] > 1:
                weight = conn["weight"]
                mermaid_lines.append(f'    {src} -- "{weight}" --> {tgt}')
            else:
                mermaid_lines.append(f"    {src} --> {tgt}")

    return {
        "modules": modules,
        "connections": connections,
        "internal_edges": dict(internal_edges),
        "graph_json": {
            "nodes": mod_nodes,
            "edges": mod_edges,
        },
        "mermaid": "\n".join(mermaid_lines),
    }


def _get_module_name(filepath: str, depth: int) -> str:
    """
    Get the module/directory name for a file at the given depth.

    depth=1: 'src/utils/helper.py' → 'src'
    depth=2: 'src/utils/helper.py' → 'src/utils'
    """
    parts = filepath.split(os.sep)
    if len(parts) <= depth:
        # File is at root or shallower than requested depth
        if len(parts) == 1:
            return "(root)"
        return os.sep.join(parts[:-1])
    return os.sep.join(parts[:depth])


# ─────────────────────────────────────────────
# 5. Circular dependency detection
# ─────────────────────────────────────────────


def detect_cycles(dep_data: dict) -> dict:
    """
    Detect circular dependencies using iterative DFS.

    Returns:
        dict with:
          - has_cycles:   bool
          - cycle_count:  int
          - cycles:       list of cycles, each is a list of file paths forming the loop
          - summary:      human-readable summary string
    """
    adjacency = dep_data.get("adjacency", {})
    cycles = _find_all_cycles(adjacency)

    # Deduplicate cycles (same cycle can be found starting at different nodes)
    unique_cycles = _deduplicate_cycles(cycles)

    # Build summary
    if not unique_cycles:
        summary = "No circular dependencies detected."
    elif len(unique_cycles) == 1:
        summary = f"1 circular dependency detected: {' → '.join(unique_cycles[0])}"
    else:
        summary = f"{len(unique_cycles)} circular dependencies detected."

    return {
        "has_cycles": len(unique_cycles) > 0,
        "cycle_count": len(unique_cycles),
        "cycles": unique_cycles,
        "summary": summary,
    }


def _find_all_cycles(adjacency: dict[str, list]) -> list[list[str]]:
    """
    Find all simple cycles in a directed graph using iterative DFS.
    """
    cycles = []
    visited_global = set()

    all_nodes = set(adjacency.keys())
    for targets in adjacency.values():
        all_nodes.update(targets)

    for start_node in sorted(all_nodes):
        if start_node in visited_global:
            continue

        #  Iterative DFS with explicit stack
        #  Stack items: (node, path_set, path_list, neighbor_index)
        stack: list[tuple[str, set, list, int]] = [(start_node, {start_node}, [start_node], 0)]

        while stack:
            node, path_set, path_list, idx = stack.pop()
            neighbors = adjacency.get(node, [])

            if idx < len(neighbors):
                # Push current state back with incremented index
                stack.append((node, path_set, path_list, idx + 1))

                neighbor = neighbors[idx]
                if neighbor in path_set:
                    # Found a cycle — extract it
                    cycle_start = path_list.index(neighbor)
                    cycle = [*path_list[cycle_start:], neighbor]
                    cycles.append(cycle)
                elif neighbor not in visited_global:
                    new_path_set = path_set | {neighbor}
                    new_path_list = [*path_list, neighbor]
                    stack.append((neighbor, new_path_set, new_path_list, 0))
            else:
                visited_global.add(node)

    return cycles


def _deduplicate_cycles(cycles: list[list[str]]) -> list[list[str]]:
    """
    Deduplicate cycles — two cycles are the same if they contain
    the same nodes in the same circular order.
    """
    seen = set()
    unique = []

    for cycle in cycles:
        if len(cycle) < 2:
            continue

        # Remove the repeated last node (A→B→A → becomes [A,B])
        loop = cycle[:-1]

        # Normalize: rotate so the lexicographically smallest node is first
        min_idx = loop.index(min(loop))
        normalized = tuple(loop[min_idx:] + loop[:min_idx])

        if normalized not in seen:
            seen.add(normalized)
            unique.append(cycle)

    # Sort by cycle length (shortest first, most actionable)
    unique.sort(key=len)
    return unique
