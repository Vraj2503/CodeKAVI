"""
routes/explain.py — LLM-powered code explanation endpoints.

Endpoints:
    POST /explain/{repo_id}        — Generate architecture overview + top-N file explanations.
    POST /explain/file/{repo_id}   — Generate LLM explanation for a single file.
    POST /explain/{repo_id}/stream — SSE streaming parallel explanation.
"""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request

# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.limiter import limiter
from codekavi.orchestrator import ExplanationOrchestrator
from codekavi.routes.dependencies import get_cache
from codekavi.schemas import ExplainFileRequest, ExplainRequest
from codekavi.session import ensure_repo_loaded
from codekavi.utils import get_explainer as _get_explainer
from codekavi.utils import run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/explain/{repo_id}")
@limiter.limit("5/minute")
async def explain_repo(
    request: Request,
    repo_id: str,
    body: ExplainRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Generate LLM explanations for a previously analyzed repo.
    """
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    explainer = _get_explainer(model=body.model)

    dep_data = result["dep_data"]
    file_profiles = result["file_profiles"]
    module_graph = result["module_graph"]
    repo_data = result.get("repo_data", {})
    role_summary = result.get("role_summary", {})
    repo_name = result.get("repo_name", os.path.basename(clone_path).rsplit("_", 1)[0])
    owner = result.get("owner", "")

    # 1. Architecture overview
    logger.info(f"Generating architecture overview for {repo_id}...")
    arch_result = await explainer.explain_architecture(
        repo_name=repo_name,
        owner=owner,
        total_files=repo_data.get("total_files", len(file_profiles)),
        total_size_formatted=repo_data.get("total_size_formatted", ""),
        languages=repo_data.get("languages", {}),
        role_summary=role_summary,
        entry_points=dep_data.get("entry_points", []),
        central_files=dep_data.get("central_files", []),
        module_graph=module_graph if isinstance(module_graph, dict) else {},
        file_profiles=file_profiles,
    )

    # 2. Top file explanations
    logger.info(f"Explaining top {body.top_n} files for {repo_id}...")
    file_results = await explainer.explain_top_files(
        file_profiles=file_profiles,
        repo_root=clone_path,
        repo_name=repo_name,
        top_n=body.top_n,
        min_importance=body.min_importance,
    )

    # 3. Module summaries
    logger.info(f"Generating module summaries for {repo_id}...")
    if isinstance(module_graph, dict) and "modules" in module_graph:
        module_summaries = await explainer.explain_modules(module_graph, repo_name)
    else:
        module_summaries = {}

    return {
        "success": True,
        "repo_id": repo_id,
        "architecture": {
            "overview": arch_result.overview,
            "model": arch_result.model,
            "tokens_used": arch_result.tokens_used,
            "duration_ms": arch_result.duration_ms,
            "error": arch_result.error,
        },
        "file_explanations": [
            {
                "file": r.file_path,
                "explanation": r.explanation,
                "model": r.model,
                "tokens_used": r.tokens_used,
                "duration_ms": r.duration_ms,
                "error": r.error,
            }
            for r in file_results
        ],
        "module_summaries": module_summaries,
        "stats": explainer.get_stats(),
    }


@router.post("/explain/file/{repo_id}")
@limiter.limit("5/minute")
async def explain_single_file(
    request: Request,
    repo_id: str,
    body: ExplainFileRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Generate an LLM explanation for a single file in a previously analyzed repo.
    """
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    file_profiles = result["file_profiles"]

    # Find the file profile
    profile = None
    for fp in file_profiles:
        if fp["path"] == body.file_path:
            profile = fp
            break

    if not profile:
        raise HTTPException(status_code=404, detail=f"File not found: {body.file_path}")

    explainer = _get_explainer(model=body.model)
    repo_name = os.path.basename(clone_path).rsplit("_", 1)[0]

    file_result = await explainer.explain_file(profile, clone_path, repo_name)

    return {
        "success": True,
        "file": file_result.file_path,
        "explanation": file_result.explanation,
        "model": file_result.model,
        "provider": file_result.provider,
        "tokens_used": file_result.tokens_used,
        "duration_ms": file_result.duration_ms,
        "error": file_result.error,
    }


# ─────────────────────────────────────────
# SSE Streaming Endpoint (NEW)
# ─────────────────────────────────────────


@router.post("/explain/{repo_id}/stream")
@limiter.limit("5/minute")
async def explain_repo_stream(
    request: Request,
    repo_id: str,
    body: ExplainRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    Stream explanation sections via Server-Sent Events (SSE).
    """
    try:
        result, clone_path = await run_sync(ensure_repo_loaded, repo_id, cache)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    async def event_stream():
        from codekavi.logging_config import repo_id_ctx

        token = repo_id_ctx.set(repo_id)
        orchestrator = ExplanationOrchestrator(
            repo_path=clone_path,
            tree=result.get("repo_data", {}),
            analysis=result.get("dep_data", {}),
            classification=result.get("file_profiles", []),
            selected_files=result.get("selected_files", []),
            depth=body.depth if hasattr(body, "depth") else "detailed",
        )
        try:
            async for event in orchestrator.run():
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from explain stream for {repo_id}. Aborting orchestrator run.")
                    break
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        except Exception as e:
            logger.error(f"SSE stream error for {repo_id}: {e}")
            message = getattr(e, "message", str(e))
            yield f"event: error\ndata: {json.dumps({'message': message})}\n\n"
        finally:
            repo_id_ctx.reset(token)
            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
