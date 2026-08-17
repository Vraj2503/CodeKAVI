"""Pure graph assembly: analysis result dict in, graph payload dict out.

No I/O, no FastAPI imports, no cache access — safe to call from anywhere and
trivial to test for determinism. See docs/superpowers/specs/2026-07-25-graph-and-tour-design.md.
"""

from __future__ import annotations

import math
import posixpath
import re
from collections import Counter, defaultdict

from rune.fingerprint import _hash_sorted
from rune.graph import ROLE_TO_LAYER, _topological_tiers, detect_cycles

# Container derivation thresholds (spec section "Containers").
FOLDER_FALLBACK_MIN_BUCKETS = 2
FOLDER_FALLBACK_MAX_BUCKET_SHARE = 0.70
SINGLE_CHILD_SUPPRESSION_MIN_FILES = 3
LABEL_PROPAGATION_MAX_ITERATIONS = 20

# Flag thresholds (spec section "flags"). Module constants, not magic numbers,
# so they can be tuned against real repos without hunting through the code.
HUB_MIN_IN_DEGREE = 10
HUB_TOP_PERCENTILE = 0.05
# FileProfile.size is byte size (see traverser.py), not a line count — the
# pipeline never reads file content to count lines. 40 bytes/line approximates
# the spec's "1000 lines" against the data that actually exists.
# ponytail: byte-size proxy for line count; swap in a real line count if the
# pipeline ever tracks one.
GOD_FILE_MIN_SIZE = 40_000
GOD_FILE_TOP_PERCENTILE = 0.02

# Fixed so flag lists render in the same order for every file, every run.
FLAG_ORDER = ("orphan", "in_cycle", "hub", "entry_point", "god_file")

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text.lower()).strip("-")
    return slug or "root"


def _dirname(path: str) -> str:
    return posixpath.dirname(path)


def _folder_buckets(paths: list[str]) -> dict[str, list[str]]:
    """Group paths by their first directory segment past the common prefix.
    Files sitting directly at the prefix are named after that folder itself,
    so no bucket ends up unnamed."""
    dirs = [_dirname(p) for p in paths]
    try:
        # A file at the repo root means there is no shared prefix at all.
        common = "" if not dirs or "" in dirs else posixpath.commonpath(sorted(set(dirs)))
    except ValueError:
        common = ""

    buckets: dict[str, list[str]] = defaultdict(list)
    for p, d in zip(paths, dirs, strict=True):
        if common and (d == common or d.startswith(common + "/")):
            rel_dir = d[len(common) :].lstrip("/")
        else:
            rel_dir = d
        segment = rel_dir.split("/", 1)[0] if rel_dir else ""
        buckets[segment].append(p)

    at_prefix = buckets.pop("", None)
    if at_prefix is not None:
        name = posixpath.basename(common) or "root"
        while name in buckets:  # a subdirectory already claims that name
            name += "-files"
        buckets[name] = at_prefix
    return dict(buckets)


def _needs_community_fallback(buckets: dict[str, list[str]], total: int) -> bool:
    if len(buckets) < FOLDER_FALLBACK_MIN_BUCKETS:
        return True
    return any(len(members) / total > FOLDER_FALLBACK_MAX_BUCKET_SHARE for members in buckets.values())


def _community_buckets(paths: list[str], adjacency: dict[str, list[str]]) -> dict[str, list[str]]:
    """Deterministic label propagation over the subgraph induced by ``paths``.
    Sorted iteration order and lowest-node-id tie-breaking make it order-stable,
    unlike standard Louvain. Fixed iteration cap, not run-to-convergence."""
    nodes = sorted(set(paths))
    node_set = set(nodes)

    neighbors: dict[str, set[str]] = {n: set() for n in nodes}
    for src in nodes:
        for tgt in adjacency.get(src, []):
            if tgt in node_set and tgt != src:
                neighbors[src].add(tgt)
                neighbors[tgt].add(src)

    labels = {n: n for n in nodes}
    for _ in range(LABEL_PROPAGATION_MAX_ITERATIONS):
        changed = False
        for n in nodes:
            nbrs = neighbors[n]
            if not nbrs:
                continue
            counts: dict[str, int] = defaultdict(int)
            for nb in nbrs:
                counts[labels[nb]] += 1
            max_count = max(counts.values())
            new_label = min(label for label, c in counts.items() if c == max_count)
            if new_label != labels[n]:
                labels[n] = new_label
                changed = True
        if not changed:
            break

    buckets: dict[str, list[str]] = defaultdict(list)
    for n in nodes:
        buckets[labels[n]].append(n)
    return dict(buckets)


def _suppress_single_child(buckets: dict[str, list[str]], total_files: int) -> dict[str, list[str]]:
    """Single-file buckets merge into a shared "standalone" bucket — unless the
    layer is small enough that fragmentation doesn't matter."""
    if total_files < SINGLE_CHILD_SUPPRESSION_MIN_FILES:
        return buckets

    singles = sorted(members[0] for members in buckets.values() if len(members) == 1)
    if not singles:
        return buckets

    result = {name: members for name, members in buckets.items() if len(members) != 1}
    result["standalone"] = sorted({*result.get("standalone", []), *singles})
    return result


def derive_containers(layer_id: str, file_paths: list[str], adjacency: dict[str, list[str]]) -> list[dict]:
    """Group a layer's files into containers: folder structure first, falling
    back to community detection when folders don't yield a useful split."""
    paths = sorted(set(file_paths))
    if not paths:
        return []

    buckets = _folder_buckets(paths)
    strategy = "folder"
    if _needs_community_fallback(buckets, len(paths)):
        buckets = _community_buckets(paths, adjacency)
        strategy = "community"

    buckets = _suppress_single_child(buckets, len(paths))

    containers = [
        {
            "id": f"{layer_id}__{_slugify(key)}",
            "layer_id": layer_id,
            "name": key or layer_id,
            "strategy": strategy,
            "file_ids": sorted(members),
        }
        for key, members in buckets.items()
    ]
    return sorted(containers, key=lambda c: c["id"])


def _percentile_floor(values: list[int], top_fraction: float) -> int:
    """Value at which roughly the top ``top_fraction`` of positive entries sit
    at-or-above it. Zeros are excluded so a repo dominated by disconnected
    files doesn't drag the floor down to zero."""
    positive = sorted((v for v in values if v > 0), reverse=True)
    if not positive:
        return 0
    idx = max(0, math.ceil(len(positive) * top_fraction) - 1)
    return positive[idx]


def compute_flags(file_profiles: list[dict], dep_data: dict) -> dict[str, list[str]]:
    """Per-file flags, keyed by path. Pure function of ``file_profiles`` (as
    produced by classify_files) and ``dep_data`` (a DepGraph, dict-shaped)."""
    entry_point_paths = {ep["file"] for ep in dep_data.get("entry_points", []) if ep.get("file")}
    cycle_paths = {path for cycle in detect_cycles(dep_data)["cycles"] for path in cycle}

    hub_threshold = max(
        1, min(HUB_MIN_IN_DEGREE, _percentile_floor([p.get("in_degree", 0) for p in file_profiles], HUB_TOP_PERCENTILE))
    )
    god_threshold = max(
        1, min(GOD_FILE_MIN_SIZE, _percentile_floor([p.get("size", 0) for p in file_profiles], GOD_FILE_TOP_PERCENTILE))
    )

    flags_by_path: dict[str, list[str]] = {}
    for profile in file_profiles:
        path = profile["path"]
        in_degree = profile.get("in_degree", 0)
        is_entry = path in entry_point_paths
        active = {
            "orphan": in_degree == 0 and not is_entry,
            "in_cycle": path in cycle_paths,
            "hub": in_degree >= hub_threshold,
            "entry_point": is_entry,
            "god_file": profile.get("size", 0) >= god_threshold,
        }
        flags_by_path[path] = [flag for flag in FLAG_ORDER if active[flag]]
    return flags_by_path


def compute_insights(dep_data: dict, flags_by_path: dict[str, list[str]]) -> dict:
    """Repo-level rollups, reusing outputs already computed upstream:
    ``detect_cycles`` (graph.py) and ``DepGraph.central_files`` /
    ``entry_points`` (analyzer.py), plus the orphan set derived from flags."""
    return {
        "cycles": detect_cycles(dep_data)["cycles"],
        "orphans": sorted(path for path, flags in flags_by_path.items() if "orphan" in flags),
        "central": [c["file"] for c in dep_data.get("central_files", []) if c.get("file")],
        "entry_points": sorted(ep["file"] for ep in dep_data.get("entry_points", []) if ep.get("file")),
    }


# Layer labels for the graph payload (spec section "Layers"). ``documentation``
# gets its own layer instead of being folded into ``other`` — see the module
# docstring on _assign_layers for the leaf/barrel half of this fix.
_LAYER_LABELS: dict[str, str] = {
    "routes": "Entry Points",
    "services": "Business Logic",
    "models": "Types & Models",
    "database": "Data & Storage",
    "utils": "Shared Utilities",
    "config": "Configuration",
    "tests": "Tests",
    "documentation": "Documentation",
    "other": "Uncategorized",
}

# Roles with no stage of their own: a leaf/barrel file is plumbing for
# whichever layer imports it, not a bucket to dump in "other".
_DYNAMIC_LAYER_ROLES = ("leaf", "barrel")


def _base_layer_for_role(role: str) -> str:
    if role == "documentation":
        return "documentation"
    return ROLE_TO_LAYER.get(role, "other")


def _assign_layers(file_profiles: list[dict], dep_data: dict) -> dict[str, str]:
    """Map every file path to a layer id. ``leaf``/``barrel`` files resolve to
    the layer that imports them most (ties broken by lowest layer name);
    orphaned ones fall back to "other". Sorted iteration keeps this stable
    across hash seeds."""
    reverse_adjacency = dep_data.get("reverse_adjacency", {})
    static_layer: dict[str, str] = {}
    dynamic_paths: list[str] = []
    for profile in file_profiles:
        role = profile.get("role") or ""
        if role in _DYNAMIC_LAYER_ROLES:
            dynamic_paths.append(profile["path"])
        else:
            static_layer[profile["path"]] = _base_layer_for_role(role)

    file_to_layer = dict(static_layer)
    for path in sorted(dynamic_paths):
        importers = sorted(reverse_adjacency.get(path, []))
        candidates = [static_layer[i] for i in importers if i in static_layer]
        if candidates:
            counts = Counter(candidates)
            top = max(counts.values())
            file_to_layer[path] = min(layer for layer, c in counts.items() if c == top)
        else:
            file_to_layer[path] = "other"
    return file_to_layer


def _layer_tiers(file_to_layer: dict[str, str], raw_edges: list[dict]) -> dict[str, int]:
    """Topological tier per layer so the canvas reads top-to-bottom in
    dependency order. Edge list is deduplicated and explicitly sorted before
    handing off, so the result doesn't depend on ``raw_edges`` order."""
    layer_ids = set(file_to_layer.values())
    pairs = {
        (file_to_layer[e["source"]], file_to_layer[e["target"]])
        for e in raw_edges
        if e.get("source") in file_to_layer
        and e.get("target") in file_to_layer
        and file_to_layer[e["source"]] != file_to_layer[e["target"]]
    }
    layer_edges = [{"source": src, "target": tgt} for src, tgt in sorted(pairs)]
    return _topological_tiers(layer_ids, layer_edges)


def _aggregate_edges(
    raw_edges: list[dict], file_to_container: dict[str, str], file_to_layer: dict[str, str]
) -> tuple[list[dict], Counter]:
    """Pre-aggregate the raw per-import edge list at file, container, and
    layer level so the frontend never re-derives topology."""
    file_counts: Counter[tuple[str, str]] = Counter()
    for edge in raw_edges:
        src, tgt = edge.get("source"), edge.get("target")
        if src and tgt and src != tgt:
            file_counts[(src, tgt)] += 1

    container_counts: Counter[tuple[str, str]] = Counter()
    layer_counts: Counter[tuple[str, str]] = Counter()
    for (src, tgt), count in file_counts.items():
        c_src, c_tgt = file_to_container.get(src), file_to_container.get(tgt)
        if c_src and c_tgt and c_src != c_tgt:
            container_counts[(c_src, c_tgt)] += count
        l_src, l_tgt = file_to_layer.get(src), file_to_layer.get(tgt)
        if l_src and l_tgt and l_src != l_tgt:
            layer_counts[(l_src, l_tgt)] += count

    edges = [
        {"source": src, "target": tgt, "level": "file", "count": count}
        for (src, tgt), count in sorted(file_counts.items())
    ]
    edges += [
        {"source": src, "target": tgt, "level": "container", "count": count}
        for (src, tgt), count in sorted(container_counts.items())
    ]
    edges += [
        {"source": src, "target": tgt, "level": "layer", "count": count}
        for (src, tgt), count in sorted(layer_counts.items())
    ]
    return edges, layer_counts


def _compute_fingerprint(file_profiles: list[dict]) -> str:
    """Freshness signal for the ETag, not a change-classification hash — that
    machinery in fingerprint.py needs file content (I/O), which this pure
    module cannot touch. Reuses its ``_hash_sorted`` helper instead."""
    tokens = [
        f"{p['path']}:{p.get('size', 0)}:{p.get('role', '')}:{p.get('in_degree', 0)}:{p.get('out_degree', 0)}"
        for p in file_profiles
    ]
    return _hash_sorted(tokens)


def assemble_graph(result: dict) -> dict:
    """Pure: analysis result in, graph payload out. No I/O."""
    dep_data = result["dep_data"]
    file_profiles = result["file_profiles"]
    raw_edges = dep_data.get("edges", [])

    file_to_layer = _assign_layers(file_profiles, dep_data)
    tiers = _layer_tiers(file_to_layer, raw_edges)

    files_by_layer: dict[str, list[str]] = defaultdict(list)
    for path, layer in file_to_layer.items():
        files_by_layer[layer].append(path)

    containers = []
    file_to_container: dict[str, str] = {}
    for layer_id, paths in files_by_layer.items():
        layer_containers = derive_containers(layer_id, paths, dep_data.get("adjacency", {}))
        containers.extend(layer_containers)
        for container in layer_containers:
            for path in container["file_ids"]:
                file_to_container[path] = container["id"]
    containers.sort(key=lambda c: c["id"])

    layers = [
        {
            "id": layer_id,
            "name": layer_id,
            "label": _LAYER_LABELS.get(layer_id, layer_id.title()),
            "file_count": len(paths),
            "tier": tiers.get(layer_id, 0),
        }
        for layer_id, paths in sorted(files_by_layer.items())
    ]

    flags_by_path = compute_flags(file_profiles, dep_data)
    insights = compute_insights(dep_data, flags_by_path)

    files = [
        {
            "id": profile["path"],
            "path": profile["path"],
            "name": profile.get("name") or posixpath.basename(profile["path"]),
            "container_id": file_to_container.get(profile["path"]),
            "layer_id": file_to_layer.get(profile["path"]),
            "role": profile.get("role"),
            "role_label": profile.get("role_label"),
            "importance": profile.get("importance_score", 0.0),
            "in_degree": profile.get("in_degree", 0),
            "out_degree": profile.get("out_degree", 0),
            "language": profile.get("language"),
            "size": profile.get("size", 0),
            "kind": "file",
            "parent": None,
            "flags": flags_by_path.get(profile["path"], []),
        }
        for profile in sorted(file_profiles, key=lambda p: p["path"])
    ]

    edges, layer_counts = _aggregate_edges(raw_edges, file_to_container, file_to_layer)
    portals = [
        {"from_layer": src, "to_layer": tgt, "connection_count": count}
        for (src, tgt), count in sorted(layer_counts.items())
    ]

    return {
        "fingerprint": _compute_fingerprint(file_profiles),
        "layers": layers,
        "containers": containers,
        "files": files,
        "edges": edges,
        "portals": portals,
        "insights": insights,
    }
