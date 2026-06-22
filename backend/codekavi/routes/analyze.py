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
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from codekavi.analyzer import analyze_dependencies
from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.classifier import classify_files, summarize_roles
from codekavi.cloner import cleanup_repo, clone_repo, parse_repo_url
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
from codekavi.logging_config import repo_id_ctx
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
        parse_repo_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Clone the repository (blocking I/O)
    from codekavi.metrics import analysis_stage_timer  # T4.3 — Prometheus stage timing

    start_time = time.perf_counter()
    try:
        with analysis_stage_timer("cloning"):
            clone_info = await _run_sync(clone_repo, github_url)
        duration = (time.perf_counter() - start_time) * 1000
        logger.info(f"Stage cloning completed in {duration:.2f}ms", extra={"stage": "cloning", "duration_ms": duration})
    except Exception as e:
        message = getattr(e, "message", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to clone repository: {message}") from e

    repo_id = clone_info["repo_id"]
    token = repo_id_ctx.set(repo_id)

    # T4.4 — cross-user dedup. If another user (with a different repo_id)
    # already produced an analysis for this exact commit, short-circuit
    # the pipeline and hand back the cached result. The new repo_id is the
    # freshly-allocated UUID — clients should treat it as opaque; the
    # clone dir + L2 Redis index are aligned via the signature.
    signature = clone_info.get("repo_signature") if isinstance(clone_info, dict) else None
    if signature:
        deduped = await _run_sync(cache.lookup_by_signature, signature)
        if deduped:
            logger.info(
                f"T4.4 commit-cache hit for {signature}; reusing cached repo result "
                f"(repo_name={deduped.get('repo_name', '')})."
            )
            # Register this fresh repo_id against the signature index too, so
            # treat the cache key as the linkage. No L1/L2 result re-write is
            # needed; ``deduped`` already references the original repo_id.
            await _run_sync(cache.register_signature, signature, deduped.get("_origin_repo_id", repo_id))
            repo_data_for_response = deduped.get("repo_data", {}) or {
                "total_files": 0,
                "total_size": 0,
                "total_size_formatted": "0 B",
                "languages": {},
                "tree": [],
                "files": [],
                "skipped_files": [],
            }
            return {
                "success": True,
                "repo_id": repo_id,
                "repo_name": clone_info["repo_name"],
                "owner": clone_info["owner"],
                "github_url": github_url,
                "deduplicated": True,
                "signature": signature,
                **repo_data_for_response,
                "dependencies": deduped.get("dep_data", {}),
                "file_profiles": deduped.get("file_profiles", []),
                "role_summary": deduped.get("role_summary", {}),
                "graph": deduped.get("graph_json", {}),
                "module_graph": deduped.get("module_graph", {}),
                "cycles": {"has_cycles": False, "cycles": []},
                "mermaid": {"file_level": "", "module_level": ""},
            }

    try:
        # Traverse and collect metadata
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("traversing"):
                repo_data = await _run_sync(traverse_repo, clone_info["clone_path"])
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage traversing completed in {duration:.2f}ms",
                extra={"stage": "traversing", "duration_ms": duration},
            )
        except Exception as e:
            cleanup_repo(clone_info["clone_path"])
            raise HTTPException(status_code=500, detail=f"Failed to traverse repository: {e}") from e

        # Fingerprint check for incremental analysis
        from codekavi.fingerprint import compare_and_classify_repo, save_fingerprints
        fingerprints, has_structural = await _run_sync(compare_and_classify_repo, repo_id, clone_info["clone_path"], repo_data["files"])
        
        if not has_structural:
            try:
                cached_result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
                if cached_result:
                    logger.info(f"Skipping analysis for {repo_id}: NO STRUCTURAL CHANGES.")
                    return {
                        "success": True,
                        "repo_id": repo_id,
                        "repo_name": clone_info["repo_name"],
                        "owner": clone_info["owner"],
                        "github_url": github_url,
                        **cached_result.get("repo_data", repo_data),
                        "dependencies": cached_result.get("dep_data", {}),
                        "file_profiles": cached_result.get("file_profiles", []),
                        "role_summary": cached_result.get("role_summary", {}),
                        "graph": cached_result.get("graph_json", {}),
                        "module_graph": cached_result.get("module_graph", {}),
                        "cycles": {"has_cycles": False, "cycles": []}, # Default fallback
                        "mermaid": {"file_level": "", "module_level": ""}
                    }
            except Exception as e:
                logger.warning(f"Failed to load cached analysis despite no structural changes: {e}")
                
        await _run_sync(save_fingerprints, repo_id, fingerprints)

        # Analyze dependencies and classify roles using a shared BoundedContentCache
        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("analyzing"):
                dep_data = await _run_sync(
                    analyze_dependencies, clone_info["clone_path"], repo_data["files"], content_cache
                )
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage analyzing completed in {duration:.2f}ms", extra={"stage": "analyzing", "duration_ms": duration}
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

        # Classify file roles
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("classifying"):
                file_profiles = await _run_sync(
                    classify_files,
                    clone_info["clone_path"],
                    repo_data["files"],
                    dep_data,
                    content_cache=content_cache,
                )
                role_summary = summarize_roles(file_profiles)
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage classifying completed in {duration:.2f}ms",
                extra={"stage": "classifying", "duration_ms": duration},
            )
        except Exception as e:
            file_profiles = []
            role_summary = {"error": f"Classification failed: {e}"}
        finally:
            content_cache.clear()
            del content_cache

        # Build graph exports
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("graphing"):
                graph_json = export_graph_json(dep_data, file_profiles, max_nodes=settings.graph_max_nodes)
                mermaid_file = export_mermaid(graph_json)
                module_graph = build_module_graph(dep_data, file_profiles, depth=1)
                cycles = detect_cycles(dep_data)
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage graphing completed in {duration:.2f}ms", extra={"stage": "graphing", "duration_ms": duration}
            )
        except Exception as e:
            graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
            mermaid_file = ""
            module_graph = {"error": f"Module graph failed: {e}"}
            cycles = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

        # Smart file selection
        selector = SmartFileSelector()
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("selecting"):
                selected_files = selector.select_files(repo_data["files"], dep_data, file_profiles)
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage selecting completed in {duration:.2f}ms", extra={"stage": "selecting", "duration_ms": duration}
            )
        except Exception as e:
            logger.warning(f"Smart file selection failed: {e}")
            selected_files = []

        # Store session and results in 3-tier cache (memory + Redis + Supabase)
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

        # T4.4 — register cross-user signature so subsequent callers probing
        # this commit at this SHA skip the pipeline.
        if signature:
            await _run_sync(cache.register_signature, signature, repo_id)

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
    finally:
        repo_id_ctx.reset(token)


# ── SSE Streaming Analysis ──


def _sse_event(
    stage: str,
    progress: int,
    message: str,
    data: dict | None = None,
    seq: int = 0,
) -> str:
    """Format a single SSE event.

    Includes ``seq`` in the JSON payload for client drop-detection AND emits
    a FrameWire ``id:`` line so SSE-aware clients can resume via the standard
    ``Last-Event-ID`` HTTP header.
    """
    payload = {"stage": stage, "progress": progress, "message": message, "seq": seq}
    if data is not None:
        payload["data"] = data
    return f"id: {seq}\ndata: {json.dumps(payload)}\n\n"


def _next_seq(counter_ref: list[int]) -> int:
    """Increment-and-return helper for threading seq through event_generator."""
    counter_ref[0] += 1
    return counter_ref[0]


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
        parse_repo_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async def event_generator():

        # T2.4 — single counter threaded through every yield so the client
        # can verify seq === total_events and resume via Last-Event-ID.
        seq_box: list[int] = [0]

        # Stage 1: Cloning
        if await request.is_disconnected():
            logger.info("Client disconnected before cloning.")
            return

        yield _sse_event("cloning", 10, "Cloning repository…", seq=_next_seq(seq_box))
        from codekavi.metrics import analysis_stage_timer  # T4.3 — Prometheus stage timing
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("cloning"):
                clone_info = await _run_sync(clone_repo, github_url)
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage cloning completed in {duration:.2f}ms", extra={"stage": "cloning", "duration_ms": duration}
            )
        except Exception as e:
            message = getattr(e, "message", str(e))
            yield _sse_event("error", 0, f"Failed to clone repository: {message}", seq=_next_seq(seq_box))
            return

        repo_id = clone_info["repo_id"]
        token = repo_id_ctx.set(repo_id)

        try:
            # Stage 2: Traversing
            if await request.is_disconnected():
                logger.info(f"Client disconnected before traversing repo {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("traversing", 25, "Scanning file structure…", seq=_next_seq(seq_box))
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("traversing"):
                    repo_data = await _run_sync(traverse_repo, clone_info["clone_path"])
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage traversing completed in {duration:.2f}ms",
                    extra={"stage": "traversing", "duration_ms": duration},
                )
            except Exception as e:
                cleanup_repo(clone_info["clone_path"])
                yield _sse_event("error", 0, f"Failed to traverse repository: {e}", seq=_next_seq(seq_box))
                return

            # Fingerprint check for incremental analysis
            from codekavi.fingerprint import compare_and_classify_repo, save_fingerprints
            fingerprints, has_structural = await _run_sync(compare_and_classify_repo, repo_id, clone_info["clone_path"], repo_data["files"])

            if not has_structural:
                try:
                    cached_result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
                    if cached_result:
                        logger.info(f"Skipping analysis for {repo_id}: NO STRUCTURAL CHANGES.")
                        yield _sse_event(
                            "analyzing",
                            100,
                            "No structural changes. Using cached analysis!",
                            seq=_next_seq(seq_box),
                        )
                        result = {
                            "success": True,
                            "repo_id": repo_id,
                            "repo_name": clone_info["repo_name"],
                            "owner": clone_info["owner"],
                            "github_url": github_url,
                            **cached_result.get("repo_data", repo_data),
                            "dependencies": cached_result.get("dep_data", {}),
                            "file_profiles": cached_result.get("file_profiles", []),
                            "role_summary": cached_result.get("role_summary", {}),
                            "graph": cached_result.get("graph_json", {}),
                            "module_graph": cached_result.get("module_graph", {}),
                            "cycles": {"has_cycles": False, "cycles": []},
                            "mermaid": {"file_level": "", "module_level": ""}
                        }
                        # T2.4 — pre-compute the final seq BEFORE building the
                        # payload so ``total_events`` matches the seq of this
                        # event (the final event).
                        final_seq = _next_seq(seq_box)
                        yield _sse_event(
                            "complete",
                            100,
                            "Analysis complete!",
                            data={"total_events": final_seq, "result": result},
                            seq=final_seq,
                        )
                        return
                except Exception as e:
                    logger.warning(f"Failed to load cached analysis despite no structural changes: {e}")

            await _run_sync(save_fingerprints, repo_id, fingerprints)

            # Stage 3: Analyzing dependencies
            if await request.is_disconnected():
                logger.info(f"Client disconnected before dependency analysis of {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("analyzing", 40, "Analyzing dependencies…", seq=_next_seq(seq_box))
            content_cache = BoundedContentCache(settings.max_content_cache_bytes)
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("analyzing"):
                    dep_data = await _run_sync(
                        analyze_dependencies, clone_info["clone_path"], repo_data["files"], content_cache
                    )
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage analyzing completed in {duration:.2f}ms",
                    extra={"stage": "analyzing", "duration_ms": duration},
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
            if await request.is_disconnected():
                logger.info(f"Client disconnected before role classification of {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("classifying", 55, "Classifying file roles…", seq=_next_seq(seq_box))
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("classifying"):
                    file_profiles = await _run_sync(
                        classify_files,
                        clone_info["clone_path"],
                        repo_data["files"],
                        dep_data,
                        content_cache=content_cache,
                    )
                    role_summary = summarize_roles(file_profiles)
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage classifying completed in {duration:.2f}ms",
                    extra={"stage": "classifying", "duration_ms": duration},
                )
            except Exception as e:
                file_profiles = []
                role_summary = {"error": f"Classification failed: {e}"}
            finally:
                content_cache.clear()
                del content_cache

            # Stage 5: Building graphs
            if await request.is_disconnected():
                logger.info(f"Client disconnected before graph export of {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("graphing", 70, "Building dependency graphs…", seq=_next_seq(seq_box))
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("graphing"):
                    graph_json = export_graph_json(dep_data, file_profiles, max_nodes=settings.graph_max_nodes)
                    mermaid_file = export_mermaid(graph_json)
                    module_graph = build_module_graph(dep_data, file_profiles, depth=1)
                    cycles = detect_cycles(dep_data)
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage graphing completed in {duration:.2f}ms",
                    extra={"stage": "graphing", "duration_ms": duration},
                )
            except Exception as e:
                graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
                mermaid_file = ""
                module_graph = {"error": f"Module graph failed: {e}"}
                cycles = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

            # Stage 6: Smart file selection
            if await request.is_disconnected():
                logger.info(f"Client disconnected before file selection of {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("selecting", 80, "Selecting key files…", seq=_next_seq(seq_box))
            selector = SmartFileSelector()
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("selecting"):
                    selected_files = selector.select_files(repo_data["files"], dep_data, file_profiles)
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage selecting completed in {duration:.2f}ms",
                    extra={"stage": "selecting", "duration_ms": duration},
                )
            except Exception as e:
                logger.warning(f"Smart file selection failed: {e}")
                selected_files = []

            # Store session and results in 3-tier cache
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
            if await request.is_disconnected():
                logger.info(f"Client disconnected before indexing repo {repo_id}.")
                cleanup_repo(clone_info["clone_path"])
                return

            yield _sse_event("indexing", 90, "Creating embeddings for RAG…", seq=_next_seq(seq_box))
            if settings.gemini_api_key and settings.zilliz_uri:
                start_time = time.perf_counter()
                try:
                    with analysis_stage_timer("indexing"):
                        await _run_sync(index_repository, repo_id, file_profiles, clone_info["clone_path"])
                    duration = (time.perf_counter() - start_time) * 1000
                    logger.info(
                        f"Stage indexing completed in {duration:.2f}ms",
                        extra={"stage": "indexing", "duration_ms": duration},
                    )
                except Exception as e:
                    logger.warning(f"Indexing failed (non-fatal): {e}")

            # Stage 8: Complete — include full result data
            # T4.4 — register the freshly-computed repo_id under its commit
            # signature so any future caller (same URL + same sha) sees the
            # dedup hit instead of re-running the whole pipeline.
            if signature:
                await _run_sync(cache.register_signature, signature, repo_id)
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
            # T2.4 — final event carries seq + total_events so the client can
            # verify completeness. Replaces the previous bare "data: [DONE]\n\n"
            # sentinel, which had no seq field.
            final_seq = _next_seq(seq_box)
            final_data = {
                "total_events": final_seq,
                "result": result,
            }
            yield _sse_event("complete", 100, "Analysis complete!", data=final_data, seq=final_seq)
        finally:
            repo_id_ctx.reset(token)

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
