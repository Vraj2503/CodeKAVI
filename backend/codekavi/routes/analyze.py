"""
routes/analyze.py — Repo analysis, graph export, and cleanup endpoints.

Endpoints:
    POST   /analyze             — Clone a GitHub repo and return full analysis.
    GET    /graph/{repo_id}     — Get dependency graph in a specific format.
    DELETE /cleanup/{repo_id}   — Remove a previously cloned repo.
"""

import os
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from codekavi.schemas import AnalyzeRequest
from codekavi.session import active_sessions, active_results, ensure_repo_loaded
from codekavi.cloner import clone_repo, cleanup_repo, parse_github_url
from codekavi.traverser import traverse_repo
from codekavi.analyzer import analyze_dependencies
from codekavi.classifier import classify_files, summarize_roles
from codekavi.graph import (
    export_graph_json,
    export_dot,
    export_mermaid,
    build_module_graph,
    detect_cycles,
)
from codekavi.indexer import index_repository
from codekavi.file_selector import SmartFileSelector

router = APIRouter()
logger = logging.getLogger(__name__)

# Thread pool for CPU-bound / blocking I/O work inside async handlers
_executor = ThreadPoolExecutor(max_workers=4)


# ── Helpers ──

async def _run_sync(func, *args, **kwargs):
    """Run a synchronous function in the thread-pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor, partial(func, *args, **kwargs)
    )


# ── Routes ──

@router.post("/analyze")
async def analyze(body: AnalyzeRequest):
    """Clone a GitHub repo and return its file metadata."""
    github_url = body.github_url.strip()

    # Validate URL format
    try:
        parse_github_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Clone the repository (blocking I/O)
    try:
        clone_info = await _run_sync(clone_repo, github_url)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Traverse and collect metadata
    try:
        repo_data = await _run_sync(traverse_repo, clone_info["clone_path"])
    except Exception as e:
        cleanup_repo(clone_info["clone_path"])
        raise HTTPException(status_code=500, detail=f"Failed to traverse repository: {e}")

    # Analyze dependencies
    try:
        dep_data = await _run_sync(
            analyze_dependencies, clone_info["clone_path"], repo_data["files"]
        )
    except Exception as e:
        dep_data = {
            "error": f"Dependency analysis failed: {e}",
            "edges": [], "adjacency": {}, "reverse_adjacency": {},
            "entry_points": [], "central_files": [], "stats": {},
        }

    # Classify file roles
    try:
        file_profiles = await _run_sync(
            classify_files, clone_info["clone_path"], repo_data["files"], dep_data
        )
        role_summary = summarize_roles(file_profiles)
    except Exception as e:
        file_profiles = []
        role_summary = {"error": f"Classification failed: {e}"}

    # Build graph exports
    try:
        graph_json = export_graph_json(dep_data, file_profiles)
        mermaid_file = export_mermaid(graph_json)
        module_graph = build_module_graph(dep_data, file_profiles, depth=1)
        cycles = detect_cycles(dep_data)
    except Exception as e:
        graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
        mermaid_file = ""
        module_graph = {"error": f"Module graph failed: {e}"}
        cycles = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

    # Smart file selection
    selector = SmartFileSelector()
    try:
        selected_files = selector.select_files(
            repo_data["files"], dep_data, file_profiles
        )
    except Exception as e:
        logger.warning(f"Smart file selection failed: {e}")
        selected_files = []

    # Index repository for RAG (blocking network I/O)
    if "GEMINI_API_KEY" in os.environ and "ZILLIZ_URI" in os.environ:
        try:
            await _run_sync(
                index_repository,
                clone_info["repo_id"], file_profiles, clone_info["clone_path"],
            )
        except Exception as e:
            logging.error(f"Vector indexing failed: {e}")

    # Store session and results for later retrieval
    repo_id = clone_info["repo_id"]
    active_sessions[repo_id] = clone_info["clone_path"]
    active_results[repo_id] = {
        "repo_name": clone_info["repo_name"],
        "owner": clone_info["owner"],
        "repo_data": repo_data,
        "dep_data": dep_data,
        "file_profiles": file_profiles,
        "role_summary": role_summary,
        "graph_json": graph_json,
        "module_graph": module_graph,
        "selected_files": selected_files,
    }

    return {
        "success": True,
        "repo_id": repo_id,
        "repo_name": clone_info["repo_name"],
        "owner": clone_info["owner"],
        "github_url": github_url,
        **repo_data,
        "dependencies": dep_data,
        "file_profiles": file_profiles,
        "role_summary": role_summary,
        "graph": graph_json,
        "module_graph": module_graph,
        "cycles": cycles,
        "mermaid": {
            "file_level": mermaid_file,
            "module_level": module_graph.get("mermaid", "") if isinstance(module_graph, dict) else "",
        },
    }


@router.get("/graph/{repo_id}")
async def get_graph(
    repo_id: str,
    format: str = Query("json", description="Export format: json, dot, mermaid, module"),
    depth: int = Query(1, description="Directory depth for module grouping (1-3)", ge=1, le=3),
    max_nodes: int = Query(50, description="Max nodes for Mermaid diagrams", ge=10, le=200),
):
    """
    Retrieve the dependency graph for a previously analyzed repo
    in a specific export format.
    """
    try:
        result, _ = ensure_repo_loaded(repo_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    dep_data = result["dep_data"]
    file_profiles = result["file_profiles"]
    graph_json = result["graph_json"]

    if format == "json":
        return graph_json

    elif format == "dot":
        dot_str = export_dot(graph_json, title=f"Dependencies — {repo_id}")
        return PlainTextResponse(content=dot_str, media_type="text/vnd.graphviz")

    elif format == "mermaid":
        mermaid_str = export_mermaid(graph_json, max_nodes=max_nodes)
        return PlainTextResponse(content=mermaid_str, media_type="text/plain")

    elif format == "module":
        module_data = build_module_graph(dep_data, file_profiles, depth=depth)
        return module_data

    else:
        raise HTTPException(status_code=400, detail=f"Unknown format: {format}. Use json, dot, mermaid, or module.")


@router.delete("/cleanup/{repo_id}")
async def cleanup(repo_id: str):
    """Remove a previously cloned repo by its ID."""
    clone_path = active_sessions.pop(repo_id, None)
    active_results.pop(repo_id, None)
    if clone_path:
        cleanup_repo(clone_path)
        return {"success": True, "message": f"Repo {repo_id} cleaned up."}
    raise HTTPException(status_code=404, detail="Session not found")
