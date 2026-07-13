"""
routes/analyze.py — Repo analysis, graph export, and cleanup endpoints.

Endpoints:
    POST   /analyze             — Clone a GitHub repo and return full analysis.
    POST   /analyze/stream      — SSE streaming version with stage-by-stage progress.
    GET    /graph/{repo_id}     — Get dependency graph in a specific format.
    DELETE /cleanup/{repo_id}   — Remove a previously cloned repo.
"""

import asyncio
import hashlib
import json
import logging
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import PlainTextResponse, StreamingResponse

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.classifier import classify_files, summarize_roles
from codekavi.cloner import cleanup_repo, clone_repo, parse_repo_url
from codekavi.file_selector import SmartFileSelector
from codekavi.fingerprint import ChangeClassification
from codekavi.graph import (
    build_module_graph,
    detect_cycles,
    export_dot,
    export_graph_json,
    export_mermaid,
)
from codekavi.indexer import index_repository
from codekavi.limiter import per_minute
from codekavi.logging_config import repo_id_ctx
from codekavi.nn_extractor import extract_all_models
from codekavi.pipeline_models import DepGraph
from codekavi.routes._errors import internal_error, scrub_message
from codekavi.routes.dependencies import get_cache
from codekavi.schemas import AnalyzeRequest
from codekavi.session import ensure_repo_loaded, save_analysis
from codekavi.settings import settings
from codekavi.traverser import traverse_repo
from codekavi.utils import BoundedContentCache
from codekavi.utils import run_sync as _run_sync


def safe_cleanup(path: str):
    """Best-effort repo cleanup. Logs a warning on failure instead of raising."""
    from codekavi.cloner import cleanup_repo

    try:
        cleanup_repo(path)
    except Exception as e:
        logging.getLogger(__name__).warning(f"Failed to cleanup repo at {path}: {e}")


router = APIRouter()
logger = logging.getLogger(__name__)


# ── Routes ──


@router.post("/analyze", dependencies=[Depends(per_minute(5))])
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
        # L-09: clone_repo() blocks on git subprocess I/O, not CPU, so it
        # runs on the io executor (_run_sync's default) rather than the
        # separate cpu executor reserved for parsing/analysis work.
        with analysis_stage_timer("cloning"):
            clone_info = await _run_sync(clone_repo, github_url)
        duration = (time.perf_counter() - start_time) * 1000
        logger.info(f"Stage cloning completed in {duration:.2f}ms", extra={"stage": "cloning", "duration_ms": duration})
    except Exception as e:
        raise internal_error(e, context="clone failed") from e

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
            # H-01: keep the signature pinned to the ORIGIN repo_id (the one
            # whose result is actually cached), not this request's freshly
            # cloned repo_id. Without ``_origin_repo_id`` persisted on first
            # write, this fell back to ``repo_id`` and re-pointed the shared
            # signature index at a repo_id whose result was never cached —
            # an ownership-transfer that broke dedup for every later caller.
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
                "nn_models": deduped.get("nn_models", []),
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
            safe_cleanup(clone_info["clone_path"])
            raise internal_error(e, context="traverse failed") from e

        # Build initial content cache from traverser
        content_cache_dict = {}
        for f in repo_data.files:
            if f.content is not None:
                content_cache_dict[f.path] = f.content
                f.content = None

        # Fingerprint check for incremental analysis
        from codekavi.fingerprint import compare_and_classify_repo, save_fingerprints

        fingerprints, change_class = await _run_sync(
            compare_and_classify_repo, repo_id, clone_info["clone_path"], repo_data.files, content_cache_dict
        )

        if change_class == ChangeClassification.SKIP:
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
                        **cached_result.get("repo_data", repo_data.model_dump()),
                        "dependencies": cached_result.get("dep_data", {}),
                        "file_profiles": cached_result.get("file_profiles", []),
                        "role_summary": cached_result.get("role_summary", {}),
                        "graph": cached_result.get("graph_json", {}),
                        "module_graph": cached_result.get("module_graph", {}),
                        "cycles": {"has_cycles": False, "cycles": []},  # Default fallback
                        "mermaid": {"file_level": "", "module_level": ""},
                        "nn_models": cached_result.get("nn_models", []),
                    }
            except Exception as e:
                logger.warning(f"Failed to load cached analysis despite no structural changes: {e}")

        elif change_class == ChangeClassification.PARTIAL_UPDATE:
            try:
                cached_result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
                if cached_result and "dep_data" in cached_result and "file_profiles" in cached_result:
                    logger.info(f"PARTIAL_UPDATE detected for {repo_id}. Merging changed files.")
                    changed_paths = {
                        path for path, fp in fingerprints.items() if fp.change_type in ("STRUCTURAL", "NEW")
                    }
                    deleted_paths = {
                        path for path in cached_result.get("repo_data", {}).get("files", []) if path not in fingerprints
                    }

                    partial_files = [f for f in repo_data.files if f.path in changed_paths]

                    # Analyze ONLY changed files
                    from codekavi.analyzer import analyze_dependencies, patch_dep_graph

                    partial_dep = await _run_sync(
                        analyze_dependencies, clone_info["clone_path"], partial_files, content_cache_dict
                    )

                    cached_dep_graph = DepGraph(**cached_result["dep_data"])
                    known_files = {f.path for f in repo_data.files}

                    dep_data = patch_dep_graph(
                        cached_dep_graph,
                        partial_dep,
                        changed_paths,
                        deleted_paths,
                        known_files,
                        clone_info["clone_path"],
                        content_cache_dict,
                    )

                    # We skip full dependency analysis in the next step by caching dep_data
                    content_cache = BoundedContentCache(settings.max_content_cache_bytes)
                    for k, v in content_cache_dict.items():
                        content_cache[k] = v

                else:
                    logger.warning("PARTIAL_UPDATE failed to load cache. Falling back to FULL_UPDATE.")
            except Exception as e:
                logger.warning(f"PARTIAL_UPDATE exception: {e}. Falling back to FULL_UPDATE.")

        await _run_sync(save_fingerprints, repo_id, clone_info["clone_path"], fingerprints)

        # Analyze dependencies and classify roles using a shared BoundedContentCache
        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
        # Pre-populate BoundedContentCache with already loaded content
        for k, v in content_cache_dict.items():
            content_cache[k] = v

        start_time = time.perf_counter()
        try:
            if change_class == ChangeClassification.PARTIAL_UPDATE and "dep_data" in locals() and dep_data:
                logger.info("Skipped full analyze_dependencies, using patched graph.")
            else:
                with analysis_stage_timer("analyzing"):
                    dep_data = await _run_sync(
                        analyze_dependencies, clone_info["clone_path"], repo_data.files, content_cache
                    )
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage analyzing completed in {duration:.2f}ms",
                    extra={"stage": "analyzing", "duration_ms": duration},
                )
        except Exception as e:
            dep_data = DepGraph(
                error=f"Dependency analysis failed: {e}",
                edges=[],
                adjacency={},
                reverse_adjacency={},
                file_imports={},
                entry_points=[],
                file_signals={},
                central_files=[],
                stats={},
            )

        # Classify file roles
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("classifying"):
                file_profiles = await _run_sync(
                    classify_files, clone_info["clone_path"], repo_data.files, dep_data, content_cache=content_cache
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

        # NN Model Extraction (before content_cache is cleared)
        nn_models = []
        ml_model_files = [fp for fp in file_profiles if fp.role == "ml_model"]
        try:
            if ml_model_files and content_cache:
                try:
                    nn_models = await extract_all_models(
                        ml_model_files,
                        content_cache=content_cache,
                        repo_root=clone_info["clone_path"],
                    )
                except Exception as e:
                    logger.warning(f"NN extraction failed: {e}")
        finally:
            # M-09: clear in finally so a failure/cancellation during NN
            # extraction can't skip cache cleanup and leak content_cache.
            if content_cache:
                content_cache.clear()
                del content_cache

        # Export graphs
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("exporting_graph"):
                dep_data_dict = dep_data.model_dump()
                file_profiles_dicts = [p.model_dump() for p in file_profiles]
                repo_files_dicts = [f.model_dump() for f in repo_data.files]

                graph_json_future = _run_sync(
                    export_graph_json, dep_data_dict, file_profiles_dicts, max_nodes=settings.graph_max_nodes
                )
                module_graph_future = _run_sync(build_module_graph, dep_data_dict, file_profiles_dicts)
                cycles_future = _run_sync(detect_cycles, dep_data_dict)

                results = await asyncio.gather(
                    graph_json_future, module_graph_future, cycles_future, return_exceptions=True
                )

                graph_json = (
                    results[0]
                    if not isinstance(results[0], Exception)
                    else {"error": f"Graph export failed: {results[0]}", "nodes": [], "edges": []}
                )
                module_graph = (
                    results[1]
                    if not isinstance(results[1], Exception)
                    else {"error": f"Module graph failed: {results[1]}"}
                )
                cycles_data = (
                    results[2]
                    if not isinstance(results[2], Exception)
                    else {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {results[2]}"}
                )

                try:
                    mermaid_code = await _run_sync(export_mermaid, graph_json)
                except Exception as e:
                    logger.warning(f"Mermaid export failed: {e}")
                    mermaid_code = {"file_level": "", "module_level": ""}
            duration = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Stage graphing completed in {duration:.2f}ms", extra={"stage": "graphing", "duration_ms": duration}
            )
        except Exception as e:
            logger.warning(f"Graph export failed: {e}")
            graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
            mermaid_code = {"file_level": "", "module_level": ""}
            module_graph = {"error": f"Module graph failed: {e}"}
            cycles_data = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

            dep_data_dict = dep_data.model_dump()
            file_profiles_dicts = [p.model_dump() for p in file_profiles]
            repo_files_dicts = [f.model_dump() for f in repo_data.files]

        # Smart file selection
        selector = SmartFileSelector()
        start_time = time.perf_counter()
        try:
            with analysis_stage_timer("selecting"):
                selected_files = selector.select_files(repo_files_dicts, dep_data_dict, file_profiles_dicts)
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
            "nn_models": nn_models,
            # H-01: pin this result to its origin repo_id so cross-user
            # signature dedup (T4.4) can never rebind the signature index
            # to a requester's repo_id whose result was never cached.
            "_origin_repo_id": repo_id,
        }
        # H-02: route through the task registry so shutdown can wait for this
        # to actually finish before draining the executors it runs on.
        task_registry = request.app.state.task_registry
        background_tasks.add_task(
            task_registry.wrap(save_analysis), repo_id, clone_info["clone_path"], result_data, cache
        )

        # T4.4 — register cross-user signature so subsequent callers probing
        # this commit at this SHA skip the pipeline.
        if signature:
            await _run_sync(cache.register_signature, signature, repo_id)

        # Index repository for RAG in the background (prevents proxy timeouts)
        # L-15: gate on the credentials indexing actually uses (Cloudflare
        # embeddings + Zilliz), not gemini_api_key — otherwise we schedule an
        # index task that is guaranteed to no-op when Cloudflare creds are unset.
        if settings.cloudflare_account_id and settings.cloudflare_api_token and settings.zilliz_uri:
            background_tasks.add_task(
                task_registry.wrap(index_repository), repo_id, file_profiles_dicts, clone_info["clone_path"]
            )

        final_result = {
            "success": True,
            "repo_id": repo_id,
            "repo_name": clone_info["repo_name"],
            "owner": clone_info["owner"],
            "github_url": github_url,
            **repo_data.model_dump(),
            "dependencies": dep_data_dict,
            "file_profiles": file_profiles_dicts,
            "role_summary": role_summary,
            "graph": graph_json,
            "module_graph": module_graph,
            "cycles": cycles_data,
            "mermaid": mermaid_code,
            "nn_models": nn_models,
        }
        return final_result
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
    return f"id: {seq}\ndata: {json.dumps(jsonable_encoder(payload))}\n\n"


def _next_seq(counter_ref: list[int]) -> int:
    """Increment-and-return helper for threading seq through event_generator."""
    counter_ref[0] += 1
    return counter_ref[0]


async def with_keepalive(async_gen_func):
    """
    Wraps an async generator to yield a keepalive comment every 15 seconds
    if the generator hasn't produced an event. Prevents proxy timeouts.
    """
    import asyncio

    q = asyncio.Queue()

    async def producer():
        try:
            async for item in async_gen_func():
                await q.put(item)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await q.put(e)
        finally:
            await q.put(None)

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=15.0)
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                yield item
            except TimeoutError:
                yield ":keepalive\n\n"
    except asyncio.CancelledError:
        task.cancel()
        raise


@router.post("/analyze/stream", dependencies=[Depends(per_minute(5))])
async def analyze_stream(
    request: Request,
    body: AnalyzeRequest,
    background_tasks: BackgroundTasks,
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
            message = scrub_message(e, context="stream clone failed")
            yield _sse_event("error", 0, f"Failed to clone repository: {message}", seq=_next_seq(seq_box))
            return

        repo_id = clone_info["repo_id"]
        signature = clone_info.get("repo_signature") if isinstance(clone_info, dict) else None
        token = repo_id_ctx.set(repo_id)

        try:
            # Stage 2: Traversing
            if await request.is_disconnected():
                logger.info(f"Client disconnected before traversing repo {repo_id}.")
                safe_cleanup(clone_info["clone_path"])
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
                safe_cleanup(clone_info["clone_path"])
                message = scrub_message(e, context="stream traverse failed")
                yield _sse_event("error", 0, f"Failed to traverse repository: {message}", seq=_next_seq(seq_box))
                return

            # Build initial content cache from traverser
            content_cache_dict = {}
            for f in repo_data.files:
                if f.content is not None:
                    content_cache_dict[f.path] = f.content
                    f.content = None

            # Fingerprint check for incremental analysis
            from codekavi.fingerprint import compare_and_classify_repo, save_fingerprints

            fingerprints, change_class = await _run_sync(
                compare_and_classify_repo, repo_id, clone_info["clone_path"], repo_data.files, content_cache_dict
            )

            if change_class == ChangeClassification.SKIP:
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
                        return
                except Exception as e:
                    logger.warning(f"Failed to load cached analysis despite no structural changes: {e}")

            elif change_class == ChangeClassification.PARTIAL_UPDATE:
                try:
                    cached_result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache)
                    if cached_result and "dep_data" in cached_result and "file_profiles" in cached_result:
                        logger.info(f"PARTIAL_UPDATE detected for {repo_id} in background. Merging changed files.")
                        changed_paths = {
                            path for path, fp in fingerprints.items() if fp.change_type in ("STRUCTURAL", "NEW")
                        }
                        deleted_paths = {
                            path
                            for path in cached_result.get("repo_data", {}).get("files", [])
                            if path not in fingerprints
                        }

                        partial_files = [f for f in repo_data.files if f.path in changed_paths]

                        from codekavi.analyzer import analyze_dependencies, patch_dep_graph

                        partial_dep = await _run_sync(
                            analyze_dependencies, clone_info["clone_path"], partial_files, content_cache_dict
                        )

                        cached_dep_graph = DepGraph(**cached_result["dep_data"])
                        known_files = {f.path for f in repo_data.files}

                        dep_data = patch_dep_graph(
                            cached_dep_graph,
                            partial_dep,
                            changed_paths,
                            deleted_paths,
                            known_files,
                            clone_info["clone_path"],
                            content_cache_dict,
                        )

                        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
                        for k, v in content_cache_dict.items():
                            content_cache[k] = v

                    else:
                        logger.warning("PARTIAL_UPDATE background failed to load cache. Falling back to FULL_UPDATE.")
                except Exception as e:
                    logger.warning(f"PARTIAL_UPDATE background exception: {e}. Falling back to FULL_UPDATE.")

            await _run_sync(save_fingerprints, repo_id, clone_info["clone_path"], fingerprints)

            # Stage 3: Analyzing dependencies
            if await request.is_disconnected():
                logger.info(f"Client disconnected before dependency analysis of {repo_id}.")
                safe_cleanup(clone_info["clone_path"])
                return

            yield _sse_event("analyzing", 40, "Analyzing dependencies…", seq=_next_seq(seq_box))

            if "content_cache" not in locals():
                content_cache = BoundedContentCache(settings.max_content_cache_bytes)
                for k, v in content_cache_dict.items():
                    content_cache[k] = v

            start_time = time.perf_counter()
            try:
                if change_class == ChangeClassification.PARTIAL_UPDATE and "dep_data" in locals() and dep_data:
                    logger.info("Skipped background full analyze_dependencies, using patched graph.")
                else:
                    with analysis_stage_timer("analyzing"):
                        dep_data = await _run_sync(
                            analyze_dependencies, clone_info["clone_path"], repo_data.files, content_cache
                        )
                    duration = (time.perf_counter() - start_time) * 1000
                    logger.info(
                        f"Stage analyzing completed in {duration:.2f}ms",
                        extra={"stage": "analyzing", "duration_ms": duration},
                    )
            except Exception as e:
                dep_data = DepGraph(
                    error=f"Dependency analysis failed: {e}",
                    edges=[],
                    adjacency={},
                    reverse_adjacency={},
                    file_imports={},
                    entry_points=[],
                    file_signals={},
                    central_files=[],
                    stats={},
                )

            # Stage 4: Classifying files
            if await request.is_disconnected():
                logger.info(f"Client disconnected before role classification of {repo_id}.")
                safe_cleanup(clone_info["clone_path"])
                return

            yield _sse_event("analyzing", 60, "Classifying file roles…", seq=_next_seq(seq_box))
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("classifying"):
                    file_profiles = await _run_sync(
                        classify_files, clone_info["clone_path"], repo_data.files, dep_data, content_cache=content_cache
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

            # NN Model Extraction
            nn_models = []
            ml_model_files = [fp for fp in file_profiles if fp.role == "ml_model"]
            try:
                if ml_model_files and content_cache:
                    try:
                        nn_models = await extract_all_models(
                            ml_model_files,
                            content_cache=content_cache,
                            repo_root=clone_info["clone_path"],
                        )
                    except Exception as e:
                        logger.warning(f"NN extraction failed: {e}")
            finally:
                # M-09: clear in finally so a failure/cancellation during NN
                # extraction can't skip cache cleanup and leak content_cache.
                if content_cache:
                    content_cache.clear()
                    del content_cache

            # Stage 5: Building graphs
            if await request.is_disconnected():
                logger.info(f"Client disconnected before graph export of {repo_id}.")
                safe_cleanup(clone_info["clone_path"])
                return

            yield _sse_event("graphing", 70, "Building dependency graphs…", seq=_next_seq(seq_box))
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("graphing"):
                    dep_data_dict = dep_data.model_dump()
                    file_profiles_dicts = [p.model_dump() for p in file_profiles]
                    repo_files_dicts = [f.model_dump() for f in repo_data.files]

                    graph_json_future = _run_sync(
                        export_graph_json, dep_data_dict, file_profiles_dicts, max_nodes=settings.graph_max_nodes
                    )
                    module_graph_future = _run_sync(build_module_graph, dep_data_dict, file_profiles_dicts)
                    cycles_future = _run_sync(detect_cycles, dep_data_dict)

                    results = await asyncio.gather(
                        graph_json_future, module_graph_future, cycles_future, return_exceptions=True
                    )

                    graph_json = (
                        results[0]
                        if not isinstance(results[0], Exception)
                        else {"error": f"Graph export failed: {results[0]}", "nodes": [], "edges": []}
                    )
                    module_graph = (
                        results[1]
                        if not isinstance(results[1], Exception)
                        else {"error": f"Module graph failed: {results[1]}"}
                    )
                    cycles_data = (
                        results[2]
                        if not isinstance(results[2], Exception)
                        else {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {results[2]}"}
                    )

                    try:
                        mermaid_code = await _run_sync(export_mermaid, graph_json)
                    except Exception as e:
                        logger.warning(f"Mermaid export failed: {e}")
                        mermaid_code = {"file_level": "", "module_level": ""}
                duration = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Stage graphing completed in {duration:.2f}ms",
                    extra={"stage": "graphing", "duration_ms": duration},
                )
            except Exception as e:
                graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
                mermaid_code = {"file_level": "", "module_level": ""}
                module_graph = {"error": f"Module graph failed: {e}"}
                cycles_data = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

                dep_data_dict = dep_data.model_dump()
                file_profiles_dicts = [p.model_dump() for p in file_profiles]
                repo_files_dicts = [f.model_dump() for f in repo_data.files]

            # Stage 6: Smart file selection
            if await request.is_disconnected():
                logger.info(f"Client disconnected before file selection of {repo_id}.")
                safe_cleanup(clone_info["clone_path"])
                return

            yield _sse_event("selecting", 80, "Selecting key files…", seq=_next_seq(seq_box))
            selector = SmartFileSelector()
            start_time = time.perf_counter()
            try:
                with analysis_stage_timer("selecting"):
                    selected_files = selector.select_files(repo_files_dicts, dep_data_dict, file_profiles_dicts)
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
                "nn_models": nn_models,
                # H-01: see non-streaming /analyze — pins dedup to the origin repo_id.
                "_origin_repo_id": repo_id,
            }
            # H-02: route through the task registry so shutdown can wait for
            # this to actually finish before draining the executors it runs on.
            task_registry = request.app.state.task_registry
            background_tasks.add_task(
                task_registry.wrap(save_analysis), repo_id, clone_info["clone_path"], stream_result_data, cache
            )

            # Stage 7: Indexing (embedding) — move to background task
            # L-15: gate on the credentials indexing actually uses.
            if settings.cloudflare_account_id and settings.cloudflare_api_token and settings.zilliz_uri:
                background_tasks.add_task(
                    task_registry.wrap(index_repository), repo_id, file_profiles, clone_info["clone_path"]
                )
                yield _sse_event("indexing", 90, "Creating embeddings for RAG in background…", seq=_next_seq(seq_box))

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
                **repo_data.model_dump(),
                "dependencies": dep_data,
                "file_profiles": file_profiles,
                "role_summary": role_summary,
                "graph": graph_json,
                "module_graph": module_graph,
                "cycles": cycles_data,
                "mermaid": {
                    "file_level": mermaid_code,
                    "module_level": module_graph.get("mermaid", "") if isinstance(module_graph, dict) else "",
                },
                "nn_models": nn_models,
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
        with_keepalive(event_generator),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/graph/{repo_id}", dependencies=[Depends(per_minute(30))])
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
        raise internal_error(e, context="get_graph: failed to load repo") from e

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


@router.get("/restore/{repo_id}", dependencies=[Depends(per_minute(30))])
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
        raise internal_error(e, context="restore_repo: failed to load repo") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found or expired. Please re-analyze.")

    repo_data = result.get("repo_data", {})
    dep_data = result.get("dep_data", {})
    graph_json = result.get("graph_json", {})
    module_graph = result.get("module_graph", {})

    response_data = {
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
        "nn_models": result.get("nn_models", []),
    }

    response_bytes = json.dumps(response_data, separators=(",", ":")).encode("utf-8")
    etag = f'W/"{hashlib.md5(response_bytes).hexdigest()}"'

    if request.headers.get("if-none-match") == etag:
        from fastapi.responses import Response

        return Response(status_code=304)

    from fastapi.responses import Response

    return Response(
        content=response_bytes,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, max-age=300"},
    )


@router.delete("/cleanup/{repo_id}", dependencies=[Depends(per_minute(30))])
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
        try:
            await _run_sync(cleanup_repo, clone_path)
        except Exception as e:
            logger.warning(f"cleanup_repo failed for {repo_id} at {clone_path}: {e}")
            return {"success": True, "message": f"Repo {repo_id} data cleared (disk cleanup failed: {e})."}
        return {"success": True, "message": f"Repo {repo_id} cleaned up."}
    raise HTTPException(status_code=404, detail="Session not found")
