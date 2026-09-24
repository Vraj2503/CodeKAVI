"""Build a bounded, source-backed architecture.v2 manifest."""

from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from typing import Any

from .architecture_models import (
    ArchitectureAvailableFocus, ArchitectureCollapsed, ArchitectureDiagnostics,
    ArchitectureEdge, ArchitectureEvidence, ArchitectureGraphData, ArchitectureGroup,
    ArchitectureNode, ArchitectureRepository, ArchitectureRequest,
)
from .architecture_rules import determine_node_kind, determine_node_role, match_technologies


GROUPS = (
    ArchitectureGroup(id="actors", label="Actors & Clients", order=1, kind="client"),
    ArchitectureGroup(id="entry", label="Entry & Delivery", order=2, kind="gateway"),
    ArchitectureGroup(id="application", label="Application Capabilities", order=3, kind="service"),
    ArchitectureGroup(id="state", label="State & Infrastructure", order=4, kind="datastore"),
    ArchitectureGroup(id="external", label="External Services", order=5, kind="external"),
)


def _id(prefix: str, value: str) -> str:
    return f"{prefix}-{hashlib.sha1(value.encode()).hexdigest()[:10]}"


def _hints(path: str, file_imports: dict[str, Any]) -> set[str]:
    hints: set[str] = set()
    for item in file_imports.get(path, []) or []:
        if isinstance(item, dict):
            hints.update(str(item[key]) for key in ("module", "raw", "name") if item.get(key))
        elif item:
            hints.add(str(item))
    return hints


def _provider_kind(product: str) -> str:
    if product in {"Auth, Postgres & Storage", "Database", "Milvus", "Vector Database", "Cache & Rate Limits"}:
        return "datastore"
    if product in {"Kafka", "RabbitMQ", "SQS", "EventBridge"}:
        return "queue"
    if product in {"Local LLM", "Lambda"}:
        return "compute"
    return "external"


def _edge_label(source: ArchitectureNode, target: ArchitectureNode) -> tuple[str, str]:
    if target.kind == "datastore":
        return "Reads and writes data", "database"
    if target.kind == "queue":
        return "Publishes events", "queue"
    if target.kind in {"external", "compute"}:
        return "Uses provider", "sdk"
    if source.kind in {"gateway", "client"}:
        return "Routes request", "http"
    return "Coordinates", "internal"


def _included(node: ArchitectureNode, request: ArchitectureRequest) -> bool:
    include = request.include
    return {
        "actors": include.actors,
        "entry": include.entry_points,
        "application": include.application_capabilities,
        "state": include.state,
        "external": include.external_integrations,
    }.get(node.group_id, True)


def _apply_view(nodes: list[ArchitectureNode], edges: list[ArchitectureEdge], request: ArchitectureRequest) -> tuple[list[ArchitectureNode], list[ArchitectureEdge]]:
    ids = {node.id for node in nodes}
    if request.view == "integration_map":
        keep = {node.id for node in nodes if node.group_id == "external"}
        keep.update(edge.source for edge in edges if edge.target in keep)
    elif request.view == "data_lifecycle":
        keep = {node.id for node in nodes if node.group_id == "state"}
        keep.update(edge.source for edge in edges if edge.target in keep)
    elif request.view == "component" and request.focus and request.focus.node_id in ids:
        focus = request.focus.node_id
        keep = {focus} | {edge.source for edge in edges if edge.target == focus} | {edge.target for edge in edges if edge.source == focus}
    elif request.view == "request_flow" and request.focus and request.focus.entrypoint_id in ids:
        keep, frontier = {request.focus.entrypoint_id}, [request.focus.entrypoint_id]
        while frontier:
            current = frontier.pop()
            for edge in edges:
                if edge.source == current and edge.target not in keep:
                    keep.add(edge.target)
                    frontier.append(edge.target)
    else:
        return nodes, edges
    return [node for node in nodes if node.id in keep], [edge for edge in edges if edge.source in keep and edge.target in keep]


def build_architecture_manifest(
    repo_id: str,
    dep_data: dict[str, Any],
    file_profiles: list[dict[str, Any]],
    request_params: ArchitectureRequest | dict[str, Any] | None = None,
) -> ArchitectureGraphData:
    """Create role-level nodes and runtime-oriented, source-backed edges."""
    request = request_params if isinstance(request_params, ArchitectureRequest) else ArchitectureRequest.model_validate(request_params or {})
    file_imports = dep_data.get("file_imports") or {}
    adjacency = dep_data.get("adjacency") or {}
    nodes: dict[str, ArchitectureNode] = {}
    path_to_node: dict[str, str] = {}

    for profile in file_profiles:
        path = str(profile.get("path") or "")
        if not path:
            continue
        role = str(profile.get("role") or profile.get("role_label") or "")
        label = determine_node_role(role, path)
        kind = determine_node_kind(role)
        group_id = "entry" if kind == "gateway" else "actors" if kind == "client" else "state" if kind == "datastore" else "application"
        node_id = _id("cap", f"{group_id}:{kind}:{label}")
        path_to_node[path] = node_id
        evidence = ArchitectureEvidence(path=path, reason=f"Classified as {role or 'application code'}.")
        confidence = float(profile.get("role_confidence") or 0.72)
        if node_id not in nodes:
            nodes[node_id] = ArchitectureNode(
                id=node_id, label=label, kind=kind, group_id=group_id,
                summary=f"Provides {label.lower()} responsibilities.", confidence=confidence,
                evidence=[evidence], importance=float(profile.get("importance_score") or 0),
            )
        else:
            node = nodes[node_id]
            node.evidence.append(evidence)
            node.confidence = max(node.confidence, confidence)
            node.importance = max(node.importance, float(profile.get("importance_score") or 0))

    edges: dict[tuple[str, str], ArchitectureEdge] = {}
    for source_path, targets in adjacency.items():
        source = path_to_node.get(source_path)
        if not source:
            continue
        for target_path in targets if isinstance(targets, (list, set, tuple)) else []:
            target = path_to_node.get(target_path)
            if not target or target == source:
                continue
            key = (source, target)
            if key not in edges:
                label, kind = _edge_label(nodes[source], nodes[target])
                edges[key] = ArchitectureEdge(id=_id("edge", f"{source}:{target}"), source=source, target=target, label=label, kind=kind, confidence=0.8, evidence_count=1)
            else:
                edges[key].evidence_count += 1

    # SDK imports make explicit provider nodes. They are not guessed from names.
    for path, source in path_to_node.items():
        for tech in match_technologies(_hints(path, file_imports)):
            kind = _provider_kind(tech.product)
            group_id = "state" if kind == "datastore" else "external"
            target = _id("tech", f"{tech.vendor}:{tech.product}")
            if target not in nodes:
                nodes[target] = ArchitectureNode(
                    id=target, label=f"{tech.vendor} — {tech.product}", kind=kind, group_id=group_id,
                    summary=tech.purpose or f"Provides {tech.product.lower()}.", technologies=[tech],
                    confidence=tech.confidence, evidence=[ArchitectureEvidence(path=path, reason="Detected from an imported SDK or client.")], importance=100,
                )
            else:
                nodes[target].evidence.append(ArchitectureEvidence(path=path, reason="Detected from an imported SDK or client."))
            key = (source, target)
            if key not in edges:
                label, edge_kind = _edge_label(nodes[source], nodes[target])
                edges[key] = ArchitectureEdge(id=_id("edge", f"{source}:{target}"), source=source, target=target, label=label, kind=edge_kind, protocol="SDK", confidence=tech.confidence, evidence_count=1)
            else:
                edges[key].evidence_count += 1

    eligible = [node for node in nodes.values() if _included(node, request)]
    eligible_ids = {node.id for node in eligible}
    graph_edges = [edge for edge in edges.values() if edge.source in eligible_ids and edge.target in eligible_ids]
    eligible, graph_edges = _apply_view(eligible, graph_edges, request)
    degree = Counter(edge.source for edge in graph_edges) + Counter(edge.target for edge in graph_edges)
    ranked = sorted(eligible, key=lambda node: (node.group_id == "external", -(node.importance + degree[node.id] * 10), node.label))
    visible = ranked[:request.layout.max_nodes]
    visible_ids = {node.id for node in visible}
    hidden = [node for node in ranked if node.id not in visible_ids]
    collapsed = []
    if hidden and request.layout.collapse_supporting_components:
        by_group: dict[str, list[ArchitectureNode]] = defaultdict(list)
        for node in hidden:
            by_group[node.group_id].append(node)
        collapsed = [ArchitectureCollapsed(id=_id("collapsed", group), label=f"+ {len(members)} supporting components", member_ids=[node.id for node in members], reason="overview_density_limit") for group, members in by_group.items()]

    # ── Re-route edges from collapsed/hidden members to visible siblings ──
    # When max_nodes prunes a node, edges referencing it would be silently
    # dropped.  Instead, re-point each dangling endpoint to the highest-
    # importance visible node in the same group so the connection survives.
    hidden_ids = {node.id for node in hidden}
    hidden_group: dict[str, str] = {node.id: node.group_id for node in hidden}
    # Pick the best visible representative per group (highest importance).
    group_representative: dict[str, str] = {}
    for node in visible:
        if node.group_id not in group_representative:
            group_representative[node.group_id] = node.id

    rerouted_edges: list[ArchitectureEdge] = []
    rerouted_count = 0
    seen_keys: set[tuple[str, str]] = set()
    for edge in graph_edges:
        src = edge.source
        tgt = edge.target
        src_hidden = src in hidden_ids
        tgt_hidden = tgt in hidden_ids
        if src_hidden:
            rep = group_representative.get(hidden_group[src])
            if rep is None:
                rerouted_count += 1
                continue  # entire group pruned — drop edge
            src = rep
        if tgt_hidden:
            rep = group_representative.get(hidden_group[tgt])
            if rep is None:
                rerouted_count += 1
                continue
            tgt = rep
        if src == tgt:
            continue  # self-loop after re-routing
        key = (src, tgt)
        if key in seen_keys:
            continue  # deduplicate
        seen_keys.add(key)
        if src_hidden or tgt_hidden:
            rerouted_count += 1
            rerouted_edges.append(edge.model_copy(update={"source": src, "target": tgt}))
        else:
            rerouted_edges.append(edge)

    visible_edges = sorted(
        (edge for edge in rerouted_edges if edge.source in visible_ids and edge.target in visible_ids),
        key=lambda edge: (-edge.evidence_count, edge.id),
    )
    excluded = max(0, len(visible_edges) - request.layout.max_edges) + rerouted_count
    visible_edges = visible_edges[:request.layout.max_edges]
    groups = [group for group in GROUPS if group.id in {node.group_id for node in visible}]
    focuses = [ArchitectureAvailableFocus(id=node.id, kind="entrypoint", label=node.label) for node in visible if node.group_id == "entry"]

    # ── Regression guard: no edge may reference a non-existent node ──
    final_node_ids = {node.id for node in visible}
    for edge in visible_edges:
        assert edge.source in final_node_ids, f"Edge {edge.id} references missing source {edge.source}"
        assert edge.target in final_node_ids, f"Edge {edge.id} references missing target {edge.target}"

    return ArchitectureGraphData(
        repository=ArchitectureRepository(repo_id=repo_id, topology="web_application" if any(node.group_id in {"actors", "entry"} for node in visible) else "application", confidence=0.88 if visible else 0),
        groups=groups, nodes=visible, edges=visible_edges, collapsed=collapsed, available_focuses=focuses,
        diagnostics=ArchitectureDiagnostics(status="complete" if visible else "empty", excluded_low_confidence_edges=excluded, source_coverage=min(1, len(path_to_node) / max(1, len(file_profiles))),),
    )

