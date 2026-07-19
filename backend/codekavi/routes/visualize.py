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
    POST /explain/visualization/{viz_type}  — LLM explanation for a visualization
"""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.config import detect_layer as _detect_layer
from codekavi.limiter import per_minute
from codekavi.routes._errors import internal_error
from codekavi.routes.dependencies import get_cache
from codekavi.session import ensure_repo_loaded
from codekavi.settings import settings
from codekavi.utils import run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Helpers ──


async def _load_repo(repo_id: str, cache: AnalysisCache):
    """Load repo analysis data. Raises HTTPException if not found."""
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache)
    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e, context="visualize: failed to load repo") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    return result, clone_path


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
    result, _ = await _load_repo(repo_id, cache)
    analysis = result.get("dep_data", {})
    adjacency = analysis.get("adjacency", {})

    from typing import Any

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_nodes = set()

    for src, targets in adjacency.items():
        if len(nodes) >= 60:
            break
        if src not in seen_nodes:
            seen_nodes.add(src)
            nodes.append(
                {
                    "id": src,
                    "label": os.path.basename(src),
                    "type": _detect_layer(src),
                }
            )
        target_list = targets if isinstance(targets, list) else [targets]
        for t in target_list:
            if len(edges) >= 100:
                break
            if t not in seen_nodes and len(nodes) < 60:
                seen_nodes.add(t)
                nodes.append(
                    {
                        "id": t,
                        "label": os.path.basename(t),
                        "type": _detect_layer(t),
                    }
                )
            if t in seen_nodes:
                edges.append({"source": src, "target": t})

    if not nodes:
        # Fallback: adjacency has no edges (unresolved imports, non-Python
        # repo, etc.) — seed standalone nodes straight from file_profiles so
        # the graph is never empty for a repo that has analyzable files.
        for fp in result.get("file_profiles", [])[:60]:
            path = fp.get("path", "")
            nodes.append({"id": path, "label": os.path.basename(path), "type": _detect_layer(path)})

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
        },
    }


# ─────────────────────────────────────────
# 2. Complexity Treemap (NO LLM)
# ─────────────────────────────────────────


@router.get("/visualize/complexity/{repo_id}", dependencies=[Depends(per_minute(30))])
async def visualize_complexity(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Build complexity treemap from file classifications.
    Zero LLM cost — uses importance scores from /analyze.
    """
    result, _ = await _load_repo(repo_id, cache)
    classification = result.get("file_profiles", [])

    children = []
    for fp in classification[:80]:
        children.append(
            {
                "name": os.path.basename(fp.get("path", "")),
                "value": fp.get("importance_score", 1),
            }
        )

    return {
        "type": "treemap",
        "data": {"name": "Complexity", "children": children},
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
    Build module-level architecture graph from module_graph data.
    Zero LLM cost — uses module groupings from /analyze.
    """
    result, _ = await _load_repo(repo_id, cache)
    module_graph = result.get("module_graph", {})
    graph_json = module_graph.get("graph_json") if isinstance(module_graph, dict) else None
    graph_json_nodes = graph_json.get("nodes", []) if isinstance(graph_json, dict) else []

    if graph_json_nodes:
        nodes = graph_json_nodes
        edges = graph_json.get("edges", [])

        # Normalize nodes for the frontend ArchitectureGraph component
        viz_nodes = [
            {
                "id": n.get("id", ""),
                "label": n.get("label", n.get("id", "")),
                "type": "module",
            }
            for n in nodes
        ]
        viz_edges = [{"source": e.get("source", ""), "target": e.get("target", "")} for e in edges]
    else:
        # Fallback: build from dep_data adjacency (same as dependency graph)
        analysis = result.get("dep_data", {})
        adjacency = analysis.get("adjacency", {})
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
            from codekavi.graph import _get_module_name

            module_counts: dict[str, int] = {}
            for fp in result.get("file_profiles", []):
                mod = _get_module_name(fp.get("path", ""), depth=1)
                module_counts[mod] = module_counts.get(mod, 0) + 1
            viz_nodes = [{"id": mod, "label": mod, "type": "module"} for mod in sorted(module_counts)][:40]

    return {
        "type": "architecture_graph",
        "data": {"nodes": viz_nodes, "edges": viz_edges},
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
    Build data flow diagram from entry points and their dependencies.
    Zero LLM cost — uses entry_points and adjacency from /analyze.
    """
    result, _ = await _load_repo(repo_id, cache)
    analysis = result.get("dep_data", {})
    adjacency = analysis.get("adjacency", {})
    entry_points = analysis.get("entry_points", [])

    from typing import Any

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen = set()

    if entry_points:
        seed_files = [ep.get("file", "") for ep in entry_points[:5]]
    else:
        # Fallback: no entry points detected — seed from the most central
        # files (ranked by in/out degree), or as a last resort the
        # top-importance file_profiles, so the flow diagram is never empty.
        central_files = analysis.get("central_files", [])
        if central_files:
            seed_files = [cf.get("file", "") for cf in central_files[:5]]
        else:
            top_files = sorted(
                result.get("file_profiles", []),
                key=lambda fp: fp.get("importance_score", 0),
                reverse=True,
            )
            seed_files = [fp.get("path", "") for fp in top_files[:5]]

    # Start from entry points and follow dependencies (BFS, depth=3)
    queue = [(f, 0) for f in seed_files]

    while queue and len(nodes) < 50:
        file_path, depth = queue.pop(0)
        if file_path in seen or depth > 3:
            continue
        seen.add(file_path)
        nodes.append(
            {
                "id": file_path,
                "label": os.path.basename(file_path),
                "type": "entry_point" if depth == 0 else _detect_layer(file_path),
            }
        )
        for target in adjacency.get(file_path, []) if isinstance(adjacency.get(file_path), list) else []:
            edges.append({"source": file_path, "target": target})
            if target not in seen:
                queue.append((target, depth + 1))

    return {
        "type": "flow_diagram",
        "data": {"nodes": nodes, "edges": edges},
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
    result, _clone_path = await _load_repo(repo_id, cache)
    classification = result.get("file_profiles", [])

    if body.use_llm:
        # M-22: this branch makes a real (billed) LLM call — gate it on the
        # same per-user daily quota every other LLM route enforces. Without
        # this, /visualize/mindmap?use_llm=true was a fully quota-free path.
        from codekavi.quota import get_token_tracker

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
        from codekavi.llm.providers import get_provider

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
    result, _clone_path = await _load_repo(body.repo_id, cache)

    # M-22: this endpoint is LLM-only (no static fallback) yet never gated
    # on the per-user daily quota — mirror the check every other LLM route
    # enforces (chat.py, explain.py).
    from codekavi.quota import get_token_tracker

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

    from codekavi.llm.providers import get_provider

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
    _user: str = Depends(verify_supabase_token),
):
    """Return extracted neural network model architectures for PlotNeuralNet-style rendering.

    Zero LLM cost — returns pre-extracted data from analysis cache.
    Optionally filter to a specific model with ?model=ModelName.
    """
    result, _ = await _load_repo(repo_id, cache)

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
