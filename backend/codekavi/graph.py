"""
graph.py — Dependency graph transformations and export formats.

Converts raw dependency data from analyzer.py into:
  1. Visualization-ready JSON (nodes + edges) for D3 / Cytoscape / frontend
  2. DOT format for Graphviz rendering
  3. Mermaid diagram syntax
  4. Module/package-level grouping (collapse file→file into dir→dir)
  5. Circular dependency detection (DFS-based cycle finding)
"""

import logging
import os
from collections import defaultdict
from typing import Any, cast

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 1. Visualization-ready JSON export
# ─────────────────────────────────────────────


def export_graph_json(
    dep_data: dict,
    file_profiles: list[dict] | None = None,
    max_nodes: int = 100,
) -> dict:
    """
    Convert dependency data into a { nodes, edges, metadata } structure
    suitable for visualization libraries (D3.js, Cytoscape, vis.js, etc.).

    Args:
        dep_data:       Output from analyze_dependencies().
        file_profiles:  Optional output from classify_files() for enriched nodes.
        max_nodes:      Maximum connected nodes to include. When the connected
                        set exceeds ``max_nodes``, surplus nodes are aggregated
                        into a single synthetic ``__collapsed__`` node. Edges
                        from removed source/target are routed through the
                        collapsed node and de-duplicated by (source, target).
                        Default 100; very large repos should pass a smaller
                        budget to keep payloads manageable.

    Returns:
        dict with:
          - nodes: list of { id, label, group, role, importance, in_degree, out_degree, ... }
          - edges: list of { source, target, raw, line, type }
          - metadata: { total_nodes, total_edges, connected_nodes, isolated_nodes,
                        is_truncated, truncated_count, groups }
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

    # Collect all files that participate in the graph. Seed from edge
    # endpoints plus every analyzed file, so files with no resolved imports
    # still render as standalone nodes instead of vanishing entirely.
    all_connected = set()
    for e in edges_raw:
        all_connected.add(e["source"])
        all_connected.add(e["target"])
    if file_profiles:
        for p in file_profiles:
            all_connected.add(p["path"])

    # Build nodes
    nodes = []
    for file_path in sorted(all_connected):
        profile = profile_map.get(file_path, {})
        in_deg = len(reverse_adjacency.get(file_path, []))
        out_deg = len(adjacency.get(file_path, []))

        # Determine group from top-level directory
        parts = file_path.split("/")
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

    # ──────────────────────────────────────────────────────────────────
    # T2.3 — Progressive node capping via synthetic __collapsed__ node.
    # If too many connected nodes, keep top (max_nodes - 1) by importance,
    # aggregate the rest into a single "collapsed" sentinel node, and
    # re-route edges connecting kept/removed nodes through it. Net nodes
    # after truncation == max_nodes (top kept + 1 collapsed).
    # ──────────────────────────────────────────────────────────────────
    is_truncated = False
    truncated_count = 0
    if len(nodes) > max_nodes:
        is_truncated = True
        nodes_sorted = sorted(nodes, key=lambda n: n.get("importance", 0), reverse=True)
        kept_top = nodes_sorted[: max(0, max_nodes - 1)]
        removed = nodes_sorted[max(0, max_nodes - 1) :]
        truncated_count = len(removed)
        kept_ids = {n["id"] for n in kept_top}

        # Aggregate the in/out degree of all removed nodes so the collapsed
        # sentinel carries an honest weight statistic for the UI.
        agg_in = sum(n.get("in_degree", 0) for n in removed)
        agg_out = sum(n.get("out_degree", 0) for n in removed)
        collapsed_node = {
            "id": "__collapsed__",
            "label": f"{truncated_count} more files",
            "group": "(collapsed)",
            "full_path": "__collapsed__",
            "in_degree": agg_in,
            "out_degree": agg_out,
            "role": "collapsed",
            "role_label": "Collapsed",
            "importance": 0,
            "language": "Unknown",
            "is_entry_point": False,
            "size": "xl",
        }

        # Edges that survive ONLY if both endpoints are in kept_ids OR one
        # endpoint is the collapsed sentinel. Edges whose removed endpoint
        # points at a kept node get re-routed through __collapsed__.
        collapsed_edge_set: set[tuple[str, str]] = set()
        collapsed_edges: list[dict[str, Any]] = []
        for e in deduped_edges:
            src, tgt = e["source"], e["target"]
            src_kept = src in kept_ids or src == "__collapsed__"
            tgt_kept = tgt in kept_ids or tgt == "__collapsed__"
            if src_kept and tgt_kept:
                # Both survived — keep the original edge.
                collapsed_edges.append(e)
                continue
            # One or both endpoints were removed — route through __collapsed__.
            new_src = src if src_kept else "__collapsed__"
            new_tgt = tgt if tgt_kept else "__collapsed__"
            # Skip self-loops on the collapsed sentinel entirely.
            if new_src == new_tgt:
                continue
            key = (new_src, new_tgt)
            if key in collapsed_edge_set:
                continue
            collapsed_edge_set.add(key)
            collapsed_edges.append({**e, "source": new_src, "target": new_tgt})

        nodes = [*kept_top, collapsed_node]
        deduped_edges = collapsed_edges

    logger.info(
        "graph_json.done nodes=%d edges=%d connected=%d truncated=%s (%d removed)",
        len(nodes),
        len(deduped_edges),
        len(all_connected),
        is_truncated,
        truncated_count,
    )
    if nodes and not deduped_edges:
        logger.warning("graph_json.no_edges nodes=%d — check dep_graph logs for unresolved imports", len(nodes))

    return {
        "nodes": nodes,
        "edges": deduped_edges,
        "metadata": {
            "total_nodes": len(nodes),
            "total_edges": len(deduped_edges),
            "connected_nodes": len(all_connected),
            "groups": sorted(set(n["group"] for n in nodes)),
            "is_truncated": is_truncated,
            "truncated_count": truncated_count,
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
    # L-11: backslashes must be escaped BEFORE quotes. Escaping in the
    # original quote-then-backslash order takes a literal `"` and turns it
    # into `\"` — an escaped backslash followed by a live, unescaped quote —
    # producing malformed/injectable DOT output.
    return s.replace("\\", "\\\\").replace('"', '\\"')


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
    parts = filepath.split("/")
    if len(parts) <= depth:
        # File is at root or shallower than requested depth
        if len(parts) == 1:
            return "(root)"
        return "/".join(parts[:-1])
    return "/".join(parts[:depth])


def _common_dir_label(files: list[str]) -> str | None:
    """Common parent directory shared by all files, or None if they diverge."""
    dirs = [os.path.dirname(f) for f in files if os.path.dirname(f)]
    if not dirs:
        return None
    try:
        return os.path.commonpath(dirs) or None
    except ValueError:
        return None


# ─────────────────────────────────────────────
# 4b. Semantic architecture graph (grouped by role, not directory)
# ─────────────────────────────────────────────

# Maps classifier roles to architecture swim-lane layer names. Must match
# the frontend's layerColors keys in ArchitectureGraph.tsx.
ROLE_TO_LAYER: dict[str, str] = {
    "entry_point": "routes",
    "router": "routes",
    "orchestrator": "services",
    "core_module": "services",
    "ml_pipeline": "services",
    "ml_training": "services",
    "ml_model": "models",
    "type_definition": "models",
    "data": "database",
    "shared_utility": "utils",
    "internal_helper": "utils",
    "config": "config",
    "test": "tests",
    "barrel": "other",
    "leaf": "other",
    "build": "other",
    "documentation": "other",
}


def build_semantic_module_graph(dep_data: dict, file_profiles: list[dict]) -> dict:
    """
    Group files by architectural layer (via classifier role, see
    ROLE_TO_LAYER) instead of by directory, producing correctly-typed
    swim-lane nodes for the architecture diagram. Same return shape as
    build_module_graph().
    """
    file_to_layer = {p["path"]: ROLE_TO_LAYER.get(p.get("role") or "", "other") for p in file_profiles}

    layer_files: dict[str, list[str]] = defaultdict(list)
    for path, layer in file_to_layer.items():
        layer_files[layer].append(path)

    adjacency = dep_data.get("adjacency", {})
    cross_edge_counts: dict[tuple[str, str], int] = defaultdict(int)
    internal_edges: dict[str, int] = defaultdict(int)
    for src, targets in adjacency.items():
        src_layer = file_to_layer.get(src)
        if src_layer is None:
            continue
        for tgt in targets if isinstance(targets, list) else []:
            tgt_layer = file_to_layer.get(tgt)
            if tgt_layer is None:
                continue
            if tgt_layer == src_layer:
                internal_edges[src_layer] += 1
            else:
                cross_edge_counts[(src_layer, tgt_layer)] += 1

    modules = []
    for layer, files in sorted(layer_files.items()):
        common_dir = _common_dir_label(files)
        label = f"{common_dir} — {len(files)} files" if common_dir else f"{len(files)} files"
        modules.append(
            {
                "name": layer,
                "label": label,
                "file_count": len(files),
                "files": sorted(files),
                "internal_edges": internal_edges.get(layer, 0),
            }
        )

    nodes = [{"id": m["name"], "label": m["label"], "type": m["name"], "file_count": m["file_count"]} for m in modules]
    connections = [
        {"source": src, "target": tgt, "weight": count} for (src, tgt), count in sorted(cross_edge_counts.items())
    ]

    return {
        "modules": modules,
        "connections": connections,
        "internal_edges": dict(internal_edges),
        "graph_json": {"nodes": nodes, "edges": connections},
        "mermaid": "",
    }


# ─────────────────────────────────────────────
# 5. Semantic data flow (hybrid static + LLM)
# ─────────────────────────────────────────────

# Maps each classifier role to a (tier, node_type) pair used to bucket files
# into conceptual data-flow stages. Roles absent from this map (test,
# documentation, build, barrel, leaf, unknown, ...) don't represent a stage
# in the runtime data flow and are excluded.
_ROLE_TIER_TYPE: dict[str, tuple[int, str]] = {
    "entry_point": (0, "io"),
    "router": (1, "io"),
    "orchestrator": (2, "process"),
    "core_module": (2, "process"),
    "ml_training": (2, "process"),
    "ml_pipeline": (2, "process"),
    "shared_utility": (3, "transform"),
    "internal_helper": (3, "transform"),
    "ml_model": (4, "data_store"),
    "type_definition": (4, "data_store"),
    "config": (4, "data_store"),
    "data": (4, "data_store"),
}

_ROLE_STAGE_LABELS: dict[str, str] = {
    "entry_point": "Entry Points",
    "router": "Routing",
    "orchestrator": "Orchestration",
    "core_module": "Core Logic",
    "ml_training": "Model Training",
    "ml_pipeline": "Data Pipeline",
    "shared_utility": "Shared Utilities",
    "internal_helper": "Helpers",
    "ml_model": "Model Definitions",
    "type_definition": "Types / Models",
    "config": "Configuration",
    "data": "Data / Migrations",
}

_TYPE_SHAPES: dict[str, str] = {
    "process": "rounded_rect",
    "data_store": "cylinder",
    "io": "parallelogram",
    "transform": "hexagon",
}

_VALID_DATA_TYPES = {"http", "db", "file", "event", "internal"}


def export_semantic_dataflow(
    dep_data: dict,
    file_profiles: list[dict],
    llm_enrichment: dict | None = None,
) -> dict:
    """
    Build a semantic data flow graph: conceptual stages (not individual
    files) connected by edges that describe how data moves through the app.

    Static pass groups files by role into stage nodes and draws edges from
    the real import adjacency. When ``llm_enrichment`` (parsed LLM JSON with
    the same node/edge shape) is provided and validates, it replaces the
    static result with richer semantic labels/descriptions; on validation
    failure the static result is returned so the caller can always render
    something.
    """
    static = _static_dataflow(dep_data, file_profiles)
    if llm_enrichment is None:
        return static

    merged = _merge_llm_dataflow(llm_enrichment, file_profiles)
    return merged if merged is not None else static


def _static_dataflow(dep_data: dict, file_profiles: list[dict]) -> dict:
    profile_map = {p["path"]: p for p in file_profiles}

    stage_files: dict[str, list[str]] = defaultdict(list)
    for p in file_profiles:
        if p.get("role") in _ROLE_TIER_TYPE:
            stage_files[p["role"]].append(p["path"])

    nodes = []
    for role, files in stage_files.items():
        tier, node_type = _ROLE_TIER_TYPE[role]
        nodes.append(
            {
                "id": role,
                "label": _ROLE_STAGE_LABELS[role],
                "type": node_type,
                "shape": _TYPE_SHAPES[node_type],
                "description": f"{len(files)} file(s) classified as {role.replace('_', ' ')}.",
                "source_files": files,
                "tier": tier,
            }
        )

    adjacency = dep_data.get("adjacency", {})
    edge_counts: dict[tuple[str, str], int] = defaultdict(int)
    for src, targets in adjacency.items():
        src_role = profile_map.get(src, {}).get("role")
        if src_role not in _ROLE_TIER_TYPE:
            continue
        for tgt in targets if isinstance(targets, list) else []:
            tgt_role = profile_map.get(tgt, {}).get("role")
            if tgt_role not in _ROLE_TIER_TYPE or tgt_role == src_role:
                continue
            edge_counts[(src_role, tgt_role)] += 1

    edges = [
        {
            "source": src_role,
            "target": tgt_role,
            "label": f"{count} import(s)",
            "data_type": "internal",
            "animated": False,
        }
        for (src_role, tgt_role), count in edge_counts.items()
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "is_llm_enriched": False,
            "repo_type": "unknown",
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "tiers": sorted({n["type"] for n in nodes}),
        },
    }


def _merge_llm_dataflow(llm_enrichment: dict, file_profiles: list[dict]) -> dict | None:
    """Validate + normalize LLM-generated nodes/edges. Returns None if the
    response is too malformed to trust (caller falls back to static)."""
    valid_paths = {p["path"] for p in file_profiles}
    raw_nodes = llm_enrichment.get("nodes", [])
    raw_edges = llm_enrichment.get("edges", [])
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list) or not raw_nodes or not raw_edges:
        return None

    nodes = []
    node_ids: set[str] = set()
    for n in raw_nodes[:15]:
        node_id = n.get("id") if isinstance(n, dict) else None
        if not node_id or node_id in node_ids:
            continue
        node_ids.add(node_id)
        node_type = n.get("type") if n.get("type") in _TYPE_SHAPES else "process"
        source_files = [f for f in n.get("source_files", []) or [] if f in valid_paths]
        nodes.append(
            {
                "id": node_id,
                "label": n.get("label") or node_id,
                "type": node_type,
                "shape": _TYPE_SHAPES[node_type],
                "description": n.get("description") or "",
                "source_files": source_files,
                "tier": 0,
            }
        )
    if not nodes:
        return None

    edges = []
    seen_edges: set[tuple[str, str]] = set()
    for e in raw_edges[:25]:
        if not isinstance(e, dict):
            continue
        src, tgt = e.get("source"), e.get("target")
        if src not in node_ids or tgt not in node_ids or src == tgt or (src, tgt) in seen_edges:
            continue
        seen_edges.add((src, tgt))
        data_type = e.get("data_type") if e.get("data_type") in _VALID_DATA_TYPES else "internal"
        edges.append(
            {
                "source": src,
                "target": tgt,
                "label": e.get("label") or "",
                "data_type": data_type,
                "animated": True,
            }
        )
    if not edges:
        return None

    tiers = _topological_tiers(node_ids, edges)
    for n in nodes:
        n["tier"] = tiers.get(n["id"], 0)

    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "is_llm_enriched": True,
            "repo_type": llm_enrichment.get("repo_type", "unknown"),
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "tiers": sorted({n["type"] for n in nodes}),
        },
    }


def _topological_tiers(node_ids: set[str], edges: list[dict]) -> dict[str, int]:
    """Longest-path-from-source layering so left-to-right layout follows
    the actual edge direction. Bounded iteration count tolerates cycles
    (LLM output isn't guaranteed to be a DAG) by simply stopping early."""
    tier = {node_id: 0 for node_id in node_ids}
    for _ in range(len(node_ids) + 1):
        changed = False
        for e in edges:
            src, tgt = e["source"], e["target"]
            if tier[tgt] <= tier[src]:
                tier[tgt] = tier[src] + 1
                changed = True
        if not changed:
            break
    return tier


# ─────────────────────────────────────────────
# 6. Circular dependency detection
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


if __name__ == "__main__":

    def _profile(path: str, role: str) -> dict:
        return {"path": path, "role": role}

    file_profiles = [
        _profile("api/handlers.py", "router"),
        _profile("services/user.py", "core_module"),
        _profile("db/models.py", "type_definition"),
    ]
    dep_data = {"adjacency": {"api/handlers.py": ["services/user.py"], "services/user.py": ["db/models.py"]}}

    static = export_semantic_dataflow(dep_data, file_profiles)
    assert static["metadata"]["is_llm_enriched"] is False
    assert {n["id"] for n in static["nodes"]} == {"router", "core_module", "type_definition"}
    assert len(static["edges"]) == 2

    valid_llm = {
        "repo_type": "web_app",
        "nodes": [
            {"id": "api", "label": "API", "type": "io", "source_files": ["api/handlers.py"]},
            {"id": "db", "label": "DB", "type": "data_store", "source_files": ["db/models.py"]},
        ],
        "edges": [{"source": "api", "target": "db", "data_type": "db"}],
    }
    enriched = export_semantic_dataflow(dep_data, file_profiles, llm_enrichment=valid_llm)
    assert enriched["metadata"]["is_llm_enriched"] is True
    assert enriched["metadata"]["repo_type"] == "web_app"
    assert enriched["nodes"][0]["tier"] == 0 and enriched["nodes"][1]["tier"] == 1

    malformed_llm: dict[str, list] = {"nodes": [], "edges": []}
    fallback = export_semantic_dataflow(dep_data, file_profiles, llm_enrichment=malformed_llm)
    assert fallback["metadata"]["is_llm_enriched"] is False

    print("export_semantic_dataflow: all checks passed")

    semantic = build_semantic_module_graph(dep_data, file_profiles)
    assert {n["id"] for n in semantic["graph_json"]["nodes"]} == {"routes", "services", "models"}
    assert all(n["type"] == n["id"] for n in semantic["graph_json"]["nodes"])
    edge_pairs = {(e["source"], e["target"]) for e in semantic["graph_json"]["edges"]}
    assert edge_pairs == {("routes", "services"), ("services", "models")}

    print("build_semantic_module_graph: all checks passed")
