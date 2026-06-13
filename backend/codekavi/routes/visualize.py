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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from codekavi.cache import AnalysisCache
from codekavi.config import detect_layer as _detect_layer
from codekavi.routes.dependencies import get_cache
from codekavi.session import ensure_repo_loaded
from codekavi.utils import run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Helpers ──

async def _load_repo(repo_id: str, cache: AnalysisCache):
    """Load repo analysis data. Raises HTTPException if not found."""
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    return result, clone_path





# ─────────────────────────────────────────
# 1. Dependency Graph (NO LLM)
# ─────────────────────────────────────────

@router.get("/visualize/dependencies/{repo_id}")
async def visualize_dependencies(repo_id: str, cache: AnalysisCache = Depends(get_cache)):
    """
    Build dependency graph visualization from static analysis data.
    Zero LLM cost — uses adjacency data computed during /analyze.
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
            nodes.append({
                "id": src,
                "label": os.path.basename(src),
                "type": _detect_layer(src),
            })
        target_list = targets if isinstance(targets, list) else [targets]
        for t in target_list:
            if len(edges) >= 100:
                break
            if t not in seen_nodes and len(nodes) < 60:
                seen_nodes.add(t)
                nodes.append({
                    "id": t,
                    "label": os.path.basename(t),
                    "type": _detect_layer(t),
                })
            if t in seen_nodes:
                edges.append({"source": src, "target": t})

    return {
        "type": "dependency_graph",
        "data": {"nodes": nodes, "edges": edges},
    }


# ─────────────────────────────────────────
# 2. Complexity Treemap (NO LLM)
# ─────────────────────────────────────────

@router.get("/visualize/complexity/{repo_id}")
async def visualize_complexity(repo_id: str, cache: AnalysisCache = Depends(get_cache)):
    """
    Build complexity treemap from file classifications.
    Zero LLM cost — uses importance scores from /analyze.
    """
    result, _ = await _load_repo(repo_id, cache)
    classification = result.get("file_profiles", [])

    children = []
    for fp in classification[:80]:
        children.append({
            "name": os.path.basename(fp.get("path", "")),
            "value": fp.get("importance_score", 1),
        })

    return {
        "type": "treemap",
        "data": {"name": "Complexity", "children": children},
    }


# ─────────────────────────────────────────
# 3. Architecture Graph (NO LLM)
# ─────────────────────────────────────────

@router.get("/visualize/architecture/{repo_id}")
async def visualize_architecture(repo_id: str, cache: AnalysisCache = Depends(get_cache)):
    """
    Build module-level architecture graph from module_graph data.
    Zero LLM cost — uses module groupings from /analyze.
    """
    result, _ = await _load_repo(repo_id, cache)
    module_graph = result.get("module_graph", {})

    if isinstance(module_graph, dict) and "graph_json" in module_graph:
        graph_json = module_graph["graph_json"]
        nodes = graph_json.get("nodes", [])
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
        viz_edges = [
            {"source": e.get("source", ""), "target": e.get("target", "")}
            for e in edges
        ]
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

    return {
        "type": "architecture_graph",
        "data": {"nodes": viz_nodes, "edges": viz_edges},
    }


# ─────────────────────────────────────────
# 4. Data Flow Diagram (NO LLM)
# ─────────────────────────────────────────

@router.get("/visualize/dataflow/{repo_id}")
async def visualize_dataflow(repo_id: str, cache: AnalysisCache = Depends(get_cache)):
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

    # Start from entry points and follow dependencies (BFS, depth=3)
    queue = [(ep.get("file", ""), 0) for ep in entry_points[:5]]

    while queue and len(nodes) < 50:
        file_path, depth = queue.pop(0)
        if file_path in seen or depth > 3:
            continue
        seen.add(file_path)
        nodes.append({
            "id": file_path,
            "label": os.path.basename(file_path),
            "type": "entry_point" if depth == 0 else _detect_layer(file_path),
        })
        for target in (adjacency.get(file_path, []) if isinstance(adjacency.get(file_path), list) else []):
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


@router.post("/visualize/mindmap/{repo_id}")
async def visualize_mindmap(repo_id: str, body: MindmapRequest, cache: AnalysisCache = Depends(get_cache)):
    """
    Build mind map. Static by default (zero LLM cost).
    Set use_llm=true for LLM-enhanced categorization.
    """
    result, _clone_path = await _load_repo(repo_id, cache)
    classification = result.get("file_profiles", [])

    if body.use_llm:
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
            "Return JSON: {\"root\": {\"name\": \"Root\", \"children\": [{\"name\": \"Category\", \"children\": [{\"name\": \"Item\"}]}]}}\n"
            "Categories: Tech Stack, Architecture, Core Modules, Data Flow, Patterns."
        )

        try:
            response = await provider.generate(
                system_prompt="You are a code analyst. Return ONLY valid JSON.",
                user_prompt=prompt,
                temperature=0.2,
                max_tokens=2000,
                json_mode=True,
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
        children.append({
            "name": role,
            "id": role,
            "label": role,
            "children": role_children,
        })

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


@router.post("/explain/visualization/{viz_type}")
async def explain_visualization(viz_type: str, body: ExplainVizRequest, cache: AnalysisCache = Depends(get_cache)):
    """
    Generate an LLM explanation for a specific visualization type.
    This is a SEPARATE endpoint from the visualization data itself.
    Only called when user explicitly clicks "Explain This Graph".
    """
    result, _clone_path = await _load_repo(body.repo_id, cache)

    api_key = os.environ.get("GEMINI_API_KEY", "")
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
        response = await provider.generate(
            system_prompt=(
                "You are a senior software architect. Explain the visualization data "
                "in 3-5 concise paragraphs. Highlight key patterns, risks, and recommendations. "
                "Use markdown formatting."
            ),
            user_prompt=prompt,
            temperature=0.3,
            max_tokens=2000,
        )
        return {
            "explanation": response,
            "tokens_used": len(response.split()) * 2,  # rough estimate
            "model": "gemini",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Explanation failed: {e}") from e


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
        f"Architecture graph: {len(modules)} modules.\n"
        + "\n".join(items) + "\n"
        "Explain the architectural pattern, module responsibilities, and communication."
    )


def _explain_prompt_dataflow(analysis: dict) -> str:
    entry_points = analysis.get("entry_points", [])[:5]
    items = [f"- {ep.get('file', '')}" for ep in entry_points]
    return (
        f"Data flow from {len(entry_points)} entry points:\n"
        + "\n".join(items) + "\n"
        "Trace the main data flows and explain how requests are processed."
    )


def _explain_prompt_mindmap(classification: list) -> str:
    roles: dict[str, int] = {}
    for fp in classification[:30]:
        role = fp.get("role_label", "Unknown")
        roles[role] = roles.get(role, 0) + 1
    items = [f"- {r}: {c} files" for r, c in sorted(roles.items(), key=lambda x: -x[1])]
    return (
        f"Codebase mind map — {len(classification)} files classified:\n"
        + "\n".join(items) + "\n"
        "Explain the codebase organization and key categories."
    )
