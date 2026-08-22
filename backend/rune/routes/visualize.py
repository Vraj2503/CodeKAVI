"""
routes/visualize.py — On-demand visualization endpoints.

All visualization data is computed from static analysis metadata.
NO LLM calls are made (except optionally for Mind Map).

Endpoints:
    GET  /visualize/dependencies/{repo_id}  — Dependency graph (nodes + edges)
    GET  /visualize/complexity/{repo_id}    — Complexity treemap data
    GET  /visualize/architecture/{repo_id}  — Module-level architecture graph
    GET  /visualize/dataflow/{repo_id}      — Data flow diagram (entry-point graph)
    POST /visualize/mindmap/{repo_id}       — Mind map (static or LLM-enhanced)
    GET  /visualize/knowledge/{repo_id}     — Symbol-level graph (+ cached concept overlay)
    POST /visualize/knowledge/{repo_id}     — Concept overlay (static or LLM-enhanced)
    POST /explain/visualization/{viz_type}  — LLM explanation for a visualization
"""

import asyncio
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from rune.analyzer import SUPPORTED_LANGUAGES
from rune.auth import verify_supabase_token
from rune.cache import AnalysisCache
from rune.config import detect_layer as _detect_layer
from rune.graph import export_graph_json
from rune.limiter import per_minute
from rune.routes._errors import internal_error
from rune.routes.dependencies import get_cache
from rune.session import ensure_repo_loaded
from rune.settings import settings
from rune.symbol_graph import select_groups
from rune.utils import run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Helpers ──


async def _load_repo(repo_id: str, cache: AnalysisCache, user_id: str):
    """Load repo analysis data. Raises HTTPException if not found."""
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache, user_id)
    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e, context="visualize: failed to load repo") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    return result, clone_path


def _layer_of(node: dict[str, Any]) -> str:
    """
    Swim-lane for one file node. The classifier's role wins when it names an
    architectural one; `leaf`, `barrel` and friends map to "other", which is no
    opinion at all — for those the path keywords get the say.
    """
    from rune.graph import ROLE_TO_LAYER

    layer = ROLE_TO_LAYER.get(node.get("role") or "")
    return layer if layer and layer != "other" else _detect_layer(node["id"])


def _disambiguate_labels(nodes: list[dict[str, Any]]) -> None:
    """
    Prefix a node's label with its parent directory when the basename alone is
    ambiguous. Twelve chips all reading `__init__.py` name nothing; the id
    carries the full path for anyone who needs it.
    """

    def clashing(labels: list[str]) -> set[str]:
        counts: dict[str, int] = {}
        for label in labels:
            counts[label] = counts.get(label, 0) + 1
        return {label for label, c in counts.items() if c > 1}

    # Grow one path segment at a time: `__init__.py` → `parser/__init__.py` →
    # `lang/parser/__init__.py`. Stops when every label is unique or no node in
    # a clashing group has another segment left to add.
    depth = 1
    while dupes := clashing([n["label"] for n in nodes]):
        grew = False
        for n in nodes:
            if n["label"] not in dupes:
                continue
            parts = n["id"].split("/")
            if depth >= len(parts):
                continue
            n["label"] = "/".join(parts[-(depth + 1) :])
            grew = True
        if not grew:
            break
        depth += 1


# ─────────────────────────────────────────
# 1. Dependency Graph (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/dependencies/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_dependencies(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build dependency graph visualization from static analysis data.
    Zero LLM cost — uses adjacency data computed during /analyze.

    Returns BOTH file-level graph (nodes/edges) AND module-level data
    (modules/connections) so the frontend can render either view.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)
    analysis = result.get("dep_data", {})
    file_profiles = result.get("file_profiles", [])

    # export_graph_json enriches nodes with role/importance/language/degree
    # and already seeds standalone (edge-less) files as nodes, so no separate
    # fallback seeding is needed here.
    graph_export = export_graph_json(analysis, file_profiles=file_profiles, max_nodes=settings.graph_max_nodes)
    nodes: list[dict[str, Any]] = [{**n, "type": _detect_layer(n["id"])} for n in graph_export["nodes"]]
    edges: list[dict[str, Any]] = [{"source": e["source"], "target": e["target"]} for e in graph_export["edges"]]

    diagnostics = _build_diagnostics(analysis, file_profiles, edge_count=len(edges), node_count=len(nodes))

    # ───── Module-level data (for hierarchical view) ─────
    module_graph = result.get("module_graph", {}) or {}
    modules: list[dict[str, Any]] = []
    connections: list[dict[str, Any]] = []
    module_graph_json: dict[str, Any] = {"nodes": [], "edges": []}

    if isinstance(module_graph, dict):
        modules = module_graph.get("modules", []) or []
        connections = module_graph.get("connections", []) or []
        gjson = module_graph.get("graph_json") or {}
        if isinstance(gjson, dict):
            module_graph_json = {
                "nodes": gjson.get("nodes", []) or [],
                "edges": gjson.get("edges", []) or [],
            }

    return {
        "type": "dependency_graph",
        "data": {
            "nodes": nodes,
            "edges": edges,
            "modules": modules,
            "connections": connections,
            "module_graph": module_graph_json,
            "diagnostics": diagnostics,
        },
    }


def _build_diagnostics(analysis: dict, file_profiles: list[dict], edge_count: int, node_count: int) -> dict[str, Any]:
    """Honest resolution stats so the frontend can distinguish 'no data' from
    'data present but unresolved' instead of always showing disconnected dots."""
    stats = analysis.get("stats", {})
    resolved = stats.get("resolved_edges", 0)
    unresolved = stats.get("unresolved_edges", 0)
    total_attempts = resolved + unresolved
    resolution_rate = round(resolved / total_attempts, 3) if total_attempts else 1.0

    languages_present = {fp.get("language", "Unknown") for fp in file_profiles}
    unsupported_languages = sorted(languages_present - SUPPORTED_LANGUAGES - {"Unknown"})

    return {
        "edge_count": edge_count,
        "node_count": node_count,
        "resolution_rate": resolution_rate,
        "unsupported_languages": unsupported_languages,
    }


# ─────────────────────────────────────────
# 2. Complexity Treemap (NO LLM)
# ─────────────────────────────────────────


#: Cap on files sent to the treemap. `file_profiles` is pre-sorted by
#: importance, so this keeps the most significant files. The response always
#: reports whether it truncated — a chart that silently shows a third of the
#: repo while looking complete is worse than one that admits the cut.
MAX_TREEMAP_FILES = 250


def _build_treemap_tree(profiles: list[dict]) -> dict:
    """
    Nest flat file profiles into a directory tree.

    A treemap whose only structure is root → leaves is a bar chart in a square;
    the containment is what shows which *directory* carries the weight. Leaves
    keep their full path, because a tile labelled `index.ts` is unactionable
    when five of them exist.
    """
    root: dict[str, Any] = {"name": "", "path": "", "_dirs": {}, "children": []}

    for fp in profiles:
        # Normalize separators once, up front. The leaf carries this path into
        # the tooltip, so it must match the directory nodes built from it.
        rel_path = (fp.get("path") or "").replace("\\", "/")
        if not rel_path:
            continue
        parts = [p for p in rel_path.split("/") if p]
        if not parts:
            continue

        node = root
        for depth, part in enumerate(parts[:-1]):
            existing = node["_dirs"].get(part)
            if existing is None:
                existing = {
                    "name": part,
                    "path": "/".join(parts[: depth + 1]),
                    "_dirs": {},
                    "children": [],
                }
                node["_dirs"][part] = existing
                node["children"].append(existing)
            node = existing

        leaf: dict[str, Any] = {
            "name": parts[-1],
            # Area stays byte size: every file has one, including the images,
            # lockfiles and manifests that have no lines of code. Mixing LOC
            # for source files with bytes for the rest would make tile areas
            # incomparable — the one thing a treemap must get right.
            "value": fp.get("size") or 1,
            "path": rel_path,
            "language": fp.get("language"),
            "role": fp.get("role_label") or fp.get("role"),
            "importance": fp.get("importance_score"),
        }

        # Color metric. Omitted entirely when the file was never measured, so
        # the frontend can grey it out instead of coloring it off a byte count
        # that shares no scale with a branch count.
        if fp.get("loc") is not None:
            leaf["loc"] = fp["loc"]
        if fp.get("complexity") is not None:
            leaf["complexity"] = fp["complexity"]
        if fp.get("complexity_source"):
            leaf["complexity_source"] = fp["complexity_source"]

        node["children"].append(leaf)

    # Collapse below the root only. Collapsing the root itself would rename it
    # to the sole top-level directory ("src"), losing the repo identity.
    for child in root["children"]:
        if "_dirs" in child:
            _collapse_single_child_dirs(child)

    _strip_dir_index(root)
    return root


def _collapse_single_child_dirs(node: dict) -> None:
    """
    Fold `a/ -> b/ -> c/` chains into one `a/b/c` node.

    Without this, a path like frontend/components/report/viz spends four nested
    header bands to say one thing, and the tiles inside get squeezed to nothing.
    """
    for child in node.get("children", []):
        _collapse_single_child_dirs(child)

    children = node.get("children", [])
    while len(children) == 1 and "_dirs" in children[0]:
        only = children[0]
        node["name"] = f"{node['name']}/{only['name']}" if node["name"] else only["name"]
        node["path"] = only["path"]
        node["_dirs"] = only.get("_dirs", {})
        node["children"] = only.get("children", [])
        children = node["children"]


def _strip_dir_index(node: dict) -> None:
    """Drop the `_dirs` build-time index so it never reaches the wire."""
    node.pop("_dirs", None)
    for child in node.get("children", []):
        if "children" in child:
            _strip_dir_index(child)


@router.get("/visualize/complexity/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_complexity(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build the complexity treemap from file classifications.

    Zero LLM cost — reuses metadata already produced by /analyze, including the
    cyclomatic complexity computed there (rune/complexity.py). Nothing is
    parsed per request.

    Two encodings: tile area is byte size, tile color is cyclomatic complexity.
    `meta.color_metric` reports which one the color actually carries, because
    an analysis cached before complexity existed has none to show — the UI
    labels itself from this rather than assuming.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)
    classification = result.get("file_profiles", [])

    total = len(classification)
    selected = classification[:MAX_TREEMAP_FILES]
    tree = _build_treemap_tree(selected)

    repo_name = result.get("repo_name") or result.get("repo") or "Repository"
    tree["name"] = tree["name"] or repo_name

    measured = sum(1 for fp in selected if fp.get("complexity") is not None)

    return {
        "type": "treemap",
        "data": {
            **tree,
            "meta": {
                "total": total,
                "shown": len(selected),
                "truncated": total > len(selected),
                # Area metric — unchanged, and available for every file.
                "metric": "size",
                "metric_label": "File size (bytes)",
                # Color metric. "none" for pre-T3b cached analyses, where every
                # tile is unmeasured and the chart must say so.
                "color_metric": "cyclomatic" if measured else "none",
                "color_metric_label": "Cyclomatic complexity",
                "measured": measured,
            },
        },
    }


# ─────────────────────────────────────────
# 3. Architecture Graph (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/architecture/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_architecture(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build the architecture graph: one node per file, `type` naming the
    architectural swim-lane it belongs to. Zero LLM cost — the roles come from
    /analyze's classifier, the edges from its resolved imports.

    File-level, not layer-level, on purpose: a diagram of eight fat "services —
    24 files" boxes says nothing an inventory list wouldn't. The lane is the
    grouping; the file is the unit worth pointing at.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)

    dep_data = result.get("dep_data", {})
    file_profiles = result.get("file_profiles", [])

    graph_json = export_graph_json(dep_data, file_profiles, max_nodes=settings.graph_max_nodes)
    viz_nodes = [
        {
            "id": n["id"],
            "label": n["label"],
            # Role is the better signal — it read the file. Path keywords answer
            # for the rest, including the structural roles (leaf, barrel) that
            # say where a file sits in the import tree, not what it does.
            "type": _layer_of(n),
        }
        for n in graph_json["nodes"]
    ]
    viz_edges = [{"source": e["source"], "target": e["target"]} for e in graph_json["edges"]]

    if not viz_nodes:
        # Fallback: build from dep_data adjacency (same as dependency graph)
        adjacency = dep_data.get("adjacency", {})
        viz_nodes = []
        viz_edges = []
        seen = set()
        for src, targets in list(adjacency.items())[:30]:
            if src not in seen:
                seen.add(src)
                viz_nodes.append({"id": src, "label": os.path.basename(src), "type": _detect_layer(src)})
            for t in (targets if isinstance(targets, list) else [targets])[:3]:
                if t not in seen and len(viz_nodes) < 40:
                    seen.add(t)
                    viz_nodes.append({"id": t, "label": os.path.basename(t), "type": _detect_layer(t)})
                if t in seen:
                    viz_edges.append({"source": src, "target": t})

        if not viz_nodes:
            # Final fallback: module_graph and adjacency are both empty (e.g.
            # unresolved imports across the whole repo) — group file_profiles
            # by top-level directory so the architecture view still renders.
            from rune.graph import _get_module_name

            module_counts: dict[str, int] = {}
            for fp in result.get("file_profiles", []):
                mod = _get_module_name(fp.get("path", ""), depth=1)
                module_counts[mod] = module_counts.get(mod, 0) + 1
            viz_nodes = [{"id": mod, "label": mod, "type": _detect_layer(mod)} for mod in sorted(module_counts)][:40]

    # After the fallbacks, not before: they build their own labels with
    # basename() and clash the same way the primary path does.
    _disambiguate_labels(viz_nodes)

    diagnostics = _build_diagnostics(dep_data, file_profiles, edge_count=len(viz_edges), node_count=len(viz_nodes))

    return {
        "type": "architecture_graph",
        "data": {
            "nodes": viz_nodes,
            "edges": viz_edges,
            "diagnostics": diagnostics,
        },
    }


# ─────────────────────────────────────────
# 4. Data Flow Diagram (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/dataflow/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_dataflow(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build a semantic data flow diagram: static role-based grouping enriched
    with an LLM pass (cached after the first call). Falls back to the
    static-only result — with a `fallback_reason` on the metadata — if the
    LLM call fails, returns invalid JSON, or the user is out of quota.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)
    analysis = result.get("dep_data", {})
    file_profiles = result.get("file_profiles", [])

    from rune.classifier import detect_repo_type, summarize_roles
    from rune.graph import export_semantic_dataflow
    from rune.pipeline_models import DepGraph, FileProfile

    profile_objs = [FileProfile(**fp) for fp in file_profiles]
    dep_graph_obj = (
        DepGraph(**analysis)
        if analysis
        else DepGraph(
            edges=[],
            adjacency={},
            reverse_adjacency={},
            file_imports={},
            entry_points=[],
            file_signals={},
            central_files=[],
            stats={},
        )
    )
    repo_type = detect_repo_type(profile_objs, dep_graph_obj)

    dataflow_data = export_semantic_dataflow(analysis, file_profiles)
    fallback_reason: str | None = None

    cached_llm = result.get("dataflow_llm")
    if cached_llm:
        # Re-normalize cached LLM structure against the current analyzer output.
        # This backfills new evidence fields (such as detected technologies)
        # without spending another LLM request.
        refreshed = export_semantic_dataflow(analysis, file_profiles, llm_enrichment=cached_llm)
        dataflow_data = refreshed if refreshed["metadata"]["is_llm_enriched"] else cached_llm
    else:
        from rune.quota import get_token_tracker

        tracker = get_token_tracker()
        if not tracker.check_quota(user_id):
            fallback_reason = "quota_exceeded"
        else:
            try:
                from rune.llm.prompts import SYSTEM_DATAFLOW_ANALYST, build_dataflow_prompt
                from rune.llm.providers import get_provider

                role_summary = summarize_roles(profile_objs)["role_counts"]
                adjacency_summary = [
                    f"{src} -> {tgt}"
                    for src, targets in list(analysis.get("adjacency", {}).items())[:30]
                    for tgt in (targets if isinstance(targets, list) else [])[:1]
                ]
                languages = sorted({fp.get("language", "Unknown") for fp in file_profiles})
                entry_points = [ep.get("file", "") for ep in analysis.get("entry_points", [])]

                prompt = build_dataflow_prompt(
                    entry_points=entry_points,
                    role_summary=role_summary,
                    adjacency_summary=adjacency_summary,
                    languages=languages,
                    repo_type=repo_type,
                )
                provider = get_provider("data_flow")
                response, _usage = await provider.generate_with_usage(
                    system_prompt=SYSTEM_DATAFLOW_ANALYST,
                    user_prompt=prompt,
                    temperature=0.2,
                    max_tokens=2500,
                    json_mode=True,
                    user_id=user_id,
                )
                parsed = json.loads(response)
                enriched = export_semantic_dataflow(analysis, file_profiles, llm_enrichment=parsed)
                if enriched["metadata"]["is_llm_enriched"]:
                    dataflow_data = enriched
                    result["dataflow_llm"] = enriched
                    await run_sync(cache.set, repo_id, result)
                else:
                    fallback_reason = "invalid_llm_response"
            except Exception as e:
                logger.warning(f"Data flow LLM generation failed, using static fallback: {e}")
                fallback_reason = "llm_failed"

    if fallback_reason:
        dataflow_data = {**dataflow_data, "metadata": {**dataflow_data["metadata"], "fallback_reason": fallback_reason}}

    return {
        "type": "flow_diagram",
        "data": dataflow_data,
    }


# ─────────────────────────────────────────
# 5. Mind Map (Static by default, LLM optional)
# ─────────────────────────────────────────


class MindmapRequest(BaseModel):
    use_llm: bool = False


@router.post("/visualize/mindmap/{repo_id}", dependencies=[Depends(per_minute(5))])
async def visualize_mindmap(
    request: Request,
    repo_id: str,
    body: MindmapRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build mind map. Static by default (zero LLM cost).
    Set use_llm=true for LLM-enhanced categorization.
    """
    result, _clone_path = await _load_repo(repo_id, cache, user_id)
    classification = result.get("file_profiles", [])

    if body.use_llm:
        # M-22: this branch makes a real (billed) LLM call — gate it on the
        # same per-user daily quota every other LLM route enforces. Without
        # this, /visualize/mindmap?use_llm=true was a fully quota-free path.
        from rune.quota import get_token_tracker

        tracker = get_token_tracker()
        if not tracker.check_quota(user_id):
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "quota_exceeded",
                    "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                    "remaining_tokens": tracker.get_remaining(user_id),
                },
            )

        # LLM-enhanced mind map — only when explicitly requested
        from rune.llm.providers import get_provider

        provider = get_provider("mindmap_data")
        file_list = [fp.get("path", "") for fp in classification[:20]]
        languages: dict[str, int] = {}
        for fp in classification:
            lang = fp.get("language", "Unknown")
            languages[lang] = languages.get(lang, 0) + 1

        prompt = (
            f"Files: {', '.join(file_list)}\n"
            f"Languages: {json.dumps(languages)}\n"
            'Return JSON: {"root": {"name": "Root", "children": [{"name": "Category", "children": [{"name": "Item"}]}]}}\n'
            "Categories: Tech Stack, Architecture, Core Modules, Data Flow, Patterns."
        )

        try:
            # M-22: pass user_id so usage is attributed to the real caller
            # instead of silently recording as user_id=None.
            response, _usage = await provider.generate_with_usage(
                system_prompt="You are a code analyst. Return ONLY valid JSON.",
                user_prompt=prompt,
                temperature=0.2,
                max_tokens=2000,
                json_mode=True,
                user_id=user_id,
            )
            parsed = json.loads(response)
            root = parsed.get("root", parsed.get("visualization", {}))
        except Exception as e:
            logger.error(f"LLM mind map generation failed: {e}")
            root = _build_static_mindmap(classification)
    else:
        root = _build_static_mindmap(classification)

    return {
        "type": "radial_mindmap",
        "data": {"root": root},
    }


def _build_static_mindmap(classification: list) -> dict:
    """Build a mind map from static file classification data (zero LLM cost)."""
    # Group files by role
    role_groups: dict[str, list] = {}
    for fp in classification[:50]:
        role = fp.get("role_label", fp.get("role", "Other"))
        if role not in role_groups:
            role_groups[role] = []
        role_groups[role].append(fp.get("name", os.path.basename(fp.get("path", ""))))

    children = []
    for role, files in sorted(role_groups.items()):
        role_children = [{"name": f, "id": f, "label": f} for f in files[:10]]
        children.append(
            {
                "name": role,
                "id": role,
                "label": role,
                "children": role_children,
            }
        )

    return {
        "name": "Codebase",
        "id": "root",
        "label": "Codebase",
        "children": children,
    }


# ─────────────────────────────────────────
# 6. Explain Visualization (LLM — separate endpoint)
# ─────────────────────────────────────────


class ExplainVizRequest(BaseModel):
    repo_id: str


@router.post("/explain/visualization/{viz_type}", dependencies=[Depends(per_minute(5))])
async def explain_visualization(
    request: Request,
    viz_type: str,
    body: ExplainVizRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Generate an LLM explanation for a specific visualization type.
    This is a SEPARATE endpoint from the visualization data itself.
    Only called when user explicitly clicks "Explain This Graph".
    """
    result, _clone_path = await _load_repo(body.repo_id, cache, user_id)

    # M-22: this endpoint is LLM-only (no static fallback) yet never gated
    # on the per-user daily quota — mirror the check every other LLM route
    # enforces (chat.py, explain.py).
    from rune.quota import get_token_tracker

    tracker = get_token_tracker()
    if not tracker.check_quota(user_id):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": tracker.get_remaining(user_id),
            },
        )

    api_key = settings.gemini_api_key
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="GEMINI_API_KEY not set. Cannot generate explanation.",
        )

    from rune.llm.providers import get_provider

    provider = get_provider("explain")

    # Build a focused prompt based on visualization type
    classification = result.get("file_profiles", [])
    analysis = result.get("dep_data", {})

    prompts = {
        "dependencies": _explain_prompt_dependencies(analysis),
        "complexity": _explain_prompt_complexity(classification),
        "architecture": _explain_prompt_architecture(result),
        "dataflow": _explain_prompt_dataflow(analysis),
        "mindmap": _explain_prompt_mindmap(classification),
    }

    prompt = prompts.get(viz_type)
    if not prompt:
        raise HTTPException(status_code=400, detail=f"Unknown visualization type: {viz_type}")

    try:
        # M-22/L-13: thread user_id through so usage is attributed correctly,
        # and use generate_with_usage() to get the provider's real token
        # count instead of a fabricated word-count estimate.
        response, usage = await provider.generate_with_usage(
            system_prompt=(
                "You are a senior software architect. Explain the visualization data "
                "in 3-5 concise paragraphs. Highlight key patterns, risks, and recommendations. "
                "Use markdown formatting."
            ),
            user_prompt=prompt,
            temperature=0.3,
            max_tokens=2000,
            user_id=user_id,
        )
        return {
            "explanation": response,
            "tokens_used": usage.get("total_tokens", 0),
            "model": provider.name,
        }
    except Exception as e:
        raise internal_error(e, context="explain_visualization: generation failed") from e


def _explain_prompt_dependencies(analysis: dict) -> str:
    adjacency = analysis.get("adjacency", {})
    edge_count = sum(len(v) if isinstance(v, list) else 1 for v in adjacency.values())
    central = analysis.get("central_files", [])[:5]
    return (
        f"Dependency graph: {len(adjacency)} files, {edge_count} edges.\n"
        f"Most central files: {', '.join(c.get('file', '') for c in central)}\n"
        "Explain the dependency structure, identify hubs, and assess coupling."
    )


def _explain_prompt_complexity(classification: list) -> str:
    top = classification[:10]
    items = [f"- {fp.get('path', '')}: importance={fp.get('importance_score', 0)}" for fp in top]
    return (
        f"Complexity treemap: {len(classification)} files.\n"
        f"Top files by importance:\n" + "\n".join(items) + "\n"
        "Explain complexity distribution and identify maintenance hotspots."
    )


def _explain_prompt_architecture(result: dict) -> str:
    module_graph = result.get("module_graph", {})
    modules = module_graph.get("modules", []) if isinstance(module_graph, dict) else []
    items = [f"- {m.get('name', '')}: {m.get('file_count', 0)} files" for m in modules[:10]]
    return (
        f"Architecture graph: {len(modules)} modules.\n" + "\n".join(items) + "\n"
        "Explain the architectural pattern, module responsibilities, and communication."
    )


def _explain_prompt_dataflow(analysis: dict) -> str:
    entry_points = analysis.get("entry_points", [])[:5]
    items = [f"- {ep.get('file', '')}" for ep in entry_points]
    return (
        f"Data flow from {len(entry_points)} entry points:\n" + "\n".join(items) + "\n"
        "Trace the main data flows and explain how requests are processed."
    )


def _explain_prompt_mindmap(classification: list) -> str:
    roles: dict[str, int] = {}
    for fp in classification[:30]:
        role = fp.get("role_label", "Unknown")
        roles[role] = roles.get(role, 0) + 1
    items = [f"- {r}: {c} files" for r, c in sorted(roles.items(), key=lambda x: -x[1])]
    return (
        f"Codebase mind map — {len(classification)} files classified:\n" + "\n".join(items) + "\n"
        "Explain the codebase organization and key categories."
    )


# ─────────────────────────────────────────
# 6. Neural Network Architecture (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/nn/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_neural_network(
    request: Request,
    repo_id: str,
    model: str | None = None,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Return extracted neural network model architectures for PlotNeuralNet-style rendering.

    Zero LLM cost — returns pre-extracted data from analysis cache.
    Optionally filter to a specific model with ?model=ModelName.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)

    nn_models = result.get("nn_models", [])

    if model:
        nn_models = [m for m in nn_models if m.get("name") == model]

    return {
        "type": "neural_network",
        "data": {
            "models": nn_models,
            "count": len(nn_models),
        },
    }


# ─────────────────────────────────────────
# 7. Knowledge Graph — symbols and calls (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/knowledge/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_knowledge_graph(
    request: Request,
    repo_id: str,
    file: str | None = None,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Return the symbol-level graph: functions/classes as nodes, calls and
    inheritance as edges.

    Zero LLM cost — built during analysis from the parse complexity.py already
    does. Optionally scope to one file's symbols with ?file=path/to/file.py.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)

    graph = result.get("symbol_graph") or {"nodes": [], "edges": [], "metadata": {}, "diagnostics": {}}

    if file:
        nodes = [n for n in graph.get("nodes", []) if n.get("file") == file]
        kept = {n["id"] for n in nodes}
        edges = [e for e in graph.get("edges", []) if e["source"] in kept and e["target"] in kept]
        # Drill-down is one group's insides; shipping the repo-wide overview
        # alongside it would leave the caller holding two different scopes.
        groups = [g for g in graph.get("groups", []) if g.get("id") == file]
        graph = {**graph, "nodes": nodes, "edges": edges, "groups": groups, "group_edges": []}

    concepts = result.get("knowledge_llm")
    if concepts:
        graph = _with_concepts(graph, concepts)

    return {"type": "knowledge", "data": graph}


class KnowledgeRequest(BaseModel):
    use_llm: bool = False


@router.post("/visualize/knowledge/{repo_id}", dependencies=[Depends(per_minute(5))])
async def enrich_knowledge_graph(
    request: Request,
    repo_id: str,
    body: KnowledgeRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Overlay the symbol graph with the domain concepts it is about.

    Static by default (identical to the GET). With `use_llm: true` one billed
    pass per package directory names the concepts and grounds each in real
    symbol ids; the overlay is cached on the analysis result, so a second call
    spends nothing. Any provider failure returns the symbol graph alone with a
    `fallback_reason` — never a 500.
    """
    result, _ = await _load_repo(repo_id, cache, user_id)
    graph = result.get("symbol_graph") or {"nodes": [], "edges": [], "metadata": {}, "diagnostics": {}}

    cached = result.get("knowledge_llm")
    if cached:
        return {"type": "knowledge", "data": _with_concepts(graph, cached)}

    if not body.use_llm:
        return {"type": "knowledge", "data": graph}

    from rune.concept_graph import build_evidence_digest, merge_concepts
    from rune.quota import get_token_tracker

    tracker = get_token_tracker()
    if not tracker.check_quota(user_id):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": tracker.get_remaining(user_id),
            },
        )

    digest = build_evidence_digest(graph)
    if not digest:
        return {"type": "knowledge", "data": {**graph, "concepts": _empty_concepts("no_symbols")}}

    try:
        from rune.llm.prompts import SYSTEM_KNOWLEDGE_ANALYST, build_knowledge_prompt
        from rune.llm.providers import get_provider

        provider = get_provider("knowledge_graph")

        async def one_chunk(chunk: dict) -> dict:
            response, _usage = await provider.generate_with_usage(
                system_prompt=SYSTEM_KNOWLEDGE_ANALYST,
                user_prompt=build_knowledge_prompt(chunk),
                temperature=0.2,
                max_tokens=2000,
                json_mode=True,
                user_id=user_id,
            )
            return json.loads(response)

        # One chunk returning garbage shouldn't lose the other five.
        settled = await asyncio.gather(*(one_chunk(c) for c in digest), return_exceptions=True)
        parsed = [r for r in settled if isinstance(r, dict)]
        if not parsed:
            raise RuntimeError(f"all {len(digest)} knowledge chunks failed")

        overlay = merge_concepts(
            parsed,
            valid_symbol_ids={n["id"] for n in graph.get("nodes", [])},
            valid_files={n.get("file") for n in graph.get("nodes", []) if n.get("file")},
        )
    except Exception as e:
        logger.warning(f"Knowledge graph LLM enrichment failed, returning symbols only: {e}")
        return {"type": "knowledge", "data": {**graph, "concepts": _empty_concepts("llm_failed")}}

    if overlay["entities"]:
        result["knowledge_llm"] = overlay
        await run_sync(cache.set, repo_id, result)

    return {"type": "knowledge", "data": _with_concepts(graph, overlay)}


def _with_concepts(graph: dict, concepts: dict) -> dict:
    """Attach the concept overlay and let it re-pick which groups are drawn.

    The adaptive count reads the importance falloff, which measures how connected
    a file is. Once the concept pass has named what the repo is *about*, the files
    it cites are the better answer, so the overview follows them. Falls back to the
    adaptive pick when the overlay cites nothing the graph stored.
    """
    files = {f for e in concepts.get("entities") or [] for f in e.get("files") or []}
    return {**select_groups(graph, files), "concepts": concepts}


def _empty_concepts(reason: str) -> dict:
    return {
        "entities": [],
        "relations": [],
        "metadata": {"is_llm_enriched": False, "chunks": 0, "dropped_ungrounded": 0, "fallback_reason": reason},
    }
