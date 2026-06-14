"""
routes/analyze.py — Repo analysis, graph export, and cleanup endpoints.

Endpoints:
    POST   /analyze             — Clone a GitHub repo and return full analysis.
    POST   /analyze/stream      — SSE streaming version with stage-by-stage progress.
    GET    /graph/{repo_id}     — Get dependency graph in a specific format.
    DELETE /cleanup/{repo_id}   — Remove a previously cloned repo.
"""

import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from codekavi.analyzer import analyze_dependencies
from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.classifier import classify_files, summarize_roles
from codekavi.cloner import cleanup_repo, clone_repo, parse_github_url
from codekavi.file_selector import SmartFileSelector
from codekavi.graph import (
    build_module_graph,
    detect_cycles,
    export_dot,
    export_graph_json,
    export_mermaid,
)
from codekavi.indexer import index_repository
from codekavi.limiter import limiter
from codekavi.routes.dependencies import get_cache
from codekavi.schemas import AnalyzeRequest
from codekavi.session import ensure_repo_loaded, save_analysis
from codekavi.settings import settings
from codekavi.traverser import traverse_repo
from codekavi.utils import BoundedContentCache
from codekavi.utils import run_sync as _run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Routes ──


@router.post("/analyze")
@limiter.limit("5/minute")
async def analyze(
    request: Request,
    body: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Clone a GitHub repo and return its file metadata."""
    github_url = body.github_url.strip()

    # Validate URL format
    try:
        parse_github_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Clone the repository (blocking I/O)
    try:
        clone_info = await _run_sync(clone_repo, github_url)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Traverse and collect metadata
    try:
        repo_data = await _run_sync(traverse_repo, clone_info["clone_path"])
    except Exception as e:
        cleanup_repo(clone_info["clone_path"])
        raise HTTPException(status_code=500, detail=f"Failed to traverse repository: {e}") from e

    # Analyze dependencies and classify roles using a shared BoundedContentCache
    content_cache = BoundedContentCache(settings.max_content_cache_bytes)
    try:
        dep_data = await _run_sync(analyze_dependencies, clone_info["clone_path"], repo_data["files"], content_cache)
    except Exception as e:
        dep_data = {
            "error": f"Dependency analysis failed: {e}",
            "edges": [],
            "adjacency": {},
            "reverse_adjacency": {},
            "entry_points": [],
            "central_files": [],
            "stats": {},
        }

    # Classify file roles
    try:
        file_profiles = await _run_sync(
            classify_files,
            clone_info["clone_path"],
            repo_data["files"],
            dep_data,
            content_cache=content_cache,
        )
        role_summary = summarize_roles(file_profiles)
    except Exception as e:
        file_profiles = []
        role_summary = {"error": f"Classification failed: {e}"}
    finally:
        content_cache.clear()
        del content_cache

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
        selected_files = selector.select_files(repo_data["files"], dep_data, file_profiles)
    except Exception as e:
        logger.warning(f"Smart file selection failed: {e}")
        selected_files = []

    # Store session and results in 3-tier cache (memory + Redis + Supabase)
    repo_id = clone_info["repo_id"]
    result_data = {
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
    save_analysis(repo_id, clone_info["clone_path"], result_data, cache)

    # Index repository for RAG in the background (prevents proxy timeouts)
    if settings.gemini_api_key and settings.zilliz_uri:
        background_tasks.add_task(index_repository, repo_id, file_profiles, clone_info["clone_path"])

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


# ── SSE Streaming Analysis ──


def _sse_event(stage: str, progress: int, message: str, data: dict | None = None) -> str:
    """Format a single SSE event."""
    payload = {"stage": stage, "progress": progress, "message": message}
    if data is not None:
        payload["data"] = data
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/analyze/stream")
@limiter.limit("5/minute")
async def analyze_stream(
    request: Request,
    body: AnalyzeRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    SSE streaming version of /analyze.
    Yields progress events as each stage completes, then the final result.
    """
    github_url = body.github_url.strip()

    try:
        parse_github_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async def event_generator():
        # Stage 1: Cloning
        yield _sse_event("cloning", 10, "Cloning repository…")
        try:
            clone_info = await _run_sync(clone_repo, github_url)
        except RuntimeError as e:
            yield _sse_event("error", 0, str(e))
            return

        # Stage 2: Traversing
        yield _sse_event("traversing", 25, "Scanning file structure…")
        try:
            repo_data = await _run_sync(traverse_repo, clone_info["clone_path"])
        except Exception as e:
            cleanup_repo(clone_info["clone_path"])
            yield _sse_event("error", 0, f"Failed to traverse repository: {e}")
            return

        # Stage 3: Analyzing dependencies
        yield _sse_event("analyzing", 40, "Analyzing dependencies…")
        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
        try:
            dep_data = await _run_sync(
                analyze_dependencies, clone_info["clone_path"], repo_data["files"], content_cache
            )
        except Exception as e:
            dep_data = {
                "error": f"Dependency analysis failed: {e}",
                "edges": [],
                "adjacency": {},
                "reverse_adjacency": {},
                "entry_points": [],
                "central_files": [],
                "stats": {},
            }

        # Stage 4: Classifying files
        yield _sse_event("classifying", 55, "Classifying file roles…")
        try:
            file_profiles = await _run_sync(
                classify_files,
                clone_info["clone_path"],
                repo_data["files"],
                dep_data,
                content_cache=content_cache,
            )
            role_summary = summarize_roles(file_profiles)
        except Exception as e:
            file_profiles = []
            role_summary = {"error": f"Classification failed: {e}"}
        finally:
            content_cache.clear()
            del content_cache

        # Stage 5: Building graphs
        yield _sse_event("graphing", 70, "Building dependency graphs…")
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

        # Stage 6: Smart file selection
        yield _sse_event("selecting", 80, "Selecting key files…")
        selector = SmartFileSelector()
        try:
            selected_files = selector.select_files(repo_data["files"], dep_data, file_profiles)
        except Exception as e:
            logger.warning(f"Smart file selection failed: {e}")
            selected_files = []

        # Store session and results in 3-tier cache
        repo_id = clone_info["repo_id"]
        stream_result_data = {
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
        save_analysis(repo_id, clone_info["clone_path"], stream_result_data, cache)

        # Stage 7: Indexing (embedding) — done INLINE so chat is ready
        yield _sse_event("indexing", 90, "Creating embeddings for RAG…")
        if settings.gemini_api_key and settings.zilliz_uri:
            try:
                await _run_sync(index_repository, repo_id, file_profiles, clone_info["clone_path"])
            except Exception as e:
                logger.warning(f"Indexing failed (non-fatal): {e}")

        # Stage 8: Complete — include full result data
        result = {
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
        yield _sse_event("complete", 100, "Analysis complete!", result)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/graph/{repo_id}")
@limiter.limit("30/minute")
async def get_graph(
    request: Request,
    repo_id: str,
    format: str = Query("json", description="Export format: json, dot, mermaid, module"),
    depth: int = Query(1, description="Directory depth for module grouping (1-3)", ge=1, le=3),
    max_nodes: int = Query(50, description="Max nodes for Mermaid diagrams", ge=10, le=200),
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Retrieve the dependency graph for a previously analyzed repo
    in a specific export format.
    """
    try:
        result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
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


@router.get("/restore/{repo_id}")
@limiter.limit("30/minute")
async def restore_repo(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Restore analysis results from cache chain for a previously analyzed repo."""
    try:
        result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore repo: {e}") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found or expired. Please re-analyze.")

    repo_data = result.get("repo_data", {})
    dep_data = result.get("dep_data", {})
    graph_json = result.get("graph_json", {})
    module_graph = result.get("module_graph", {})

    return {
        "success": True,
        "repo_id": repo_id,
        "repo_name": result.get("repo_name", ""),
        "owner": result.get("owner", ""),
        **repo_data,
        "dependencies": dep_data,
        "file_profiles": result.get("file_profiles", []),
        "role_summary": result.get("role_summary", {}),
        "graph": graph_json,
        "module_graph": module_graph,
    }


@router.delete("/cleanup/{repo_id}")
@limiter.limit("30/minute")
async def cleanup(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Remove a previously cloned repo by its ID."""
    clone_path = await _run_sync(cache.get_session_path, repo_id)
    await _run_sync(cache.delete, repo_id)
    await _run_sync(cache.delete_session, repo_id)
    if clone_path:
        await _run_sync(cleanup_repo, clone_path)
        return {"success": True, "message": f"Repo {repo_id} cleaned up."}
    raise HTTPException(status_code=404, detail="Session not found")
