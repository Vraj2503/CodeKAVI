"""
routes/explain.py — LLM-powered code explanation endpoints.

Endpoints:
    POST /explain/{repo_id}        — Generate architecture overview + top-N file explanations.
    POST /explain/file/{repo_id}   — Generate LLM explanation for a single file.
    POST /explain/{repo_id}/stream — SSE streaming parallel explanation.
"""

import asyncio
import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request

# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.exceptions import ProviderError, RateLimitError
from codekavi.limiter import limiter
from codekavi.orchestrator import ExplanationOrchestrator
from codekavi.quota import get_token_tracker
from codekavi.routes.dependencies import get_cache
from codekavi.schemas import ExplainFileRequest, ExplainRequest
from codekavi.session import ensure_repo_loaded
from codekavi.tour_generator import generate_deterministic_tour
from codekavi.utils import get_explainer as _get_explainer
from codekavi.utils import run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# T2.5 — degraded-response shapes used when the LLM provider is down.
# Each preserves the field names expected by the existing frontend caller
# so the UI degrades silently rather than crashing.
# ──────────────────────────────────────────────────────────────────────
def _arch_fallback(reason: str) -> dict:
    return {
        "overview": "Architecture analysis unavailable (LLM fallback)",
        "model": None,
        "tokens_used": 0,
        "duration_ms": 0,
        "error": reason,
    }


def _is_provider_failure(exc: BaseException) -> bool:
    """True for the LLM-side failures that should trigger the deterministic fallback."""
    return isinstance(exc, (RateLimitError, ProviderError, asyncio.TimeoutError))


def _enforce_user_quota(user_id: str | None) -> int:
    """
    T4.1 — soft-or-hard quota gate (controlled by ``settings.enforce_token_quota``).

    Always returns HTTPException-raise-on-block; if enforcement is disabled,
    just returns the user's remaining tokens and lets the request proceed.
    """
    tracker = get_token_tracker()
    remaining = tracker.get_remaining(user_id)
    if not tracker.check_quota(user_id):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": remaining,
            },
        )
    return remaining


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
    # T4.1 — gate on per-user daily token quota (raises 429 if over).
    _enforce_user_quota(user_id=user_id)

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

    # Track whether ANY LLM call fell back to a degraded response. The outer
    # response carries ``fallback: true`` if so — lets the frontend decide
    # whether to surface a banner.
    fallback_used = False
    fallback_reasons: list[str] = []

    # 1. Architecture overview
    logger.info(f"Generating architecture overview for {repo_id}...")
    try:
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
        arch_payload = {
            "overview": arch_result.overview,
            "model": arch_result.model,
            "tokens_used": arch_result.tokens_used,
            "duration_ms": arch_result.duration_ms,
            "error": arch_result.error,
        }
    except Exception as e:
        if not _is_provider_failure(e):
            raise  # non-LLM failures (programmer error, etc.) still 500
        logger.warning(f"Architecture fallback for {repo_id}: {e}")
        fallback_used = True
        fallback_reasons.append(f"architecture: {e!s}"[:200])
        arch_payload = _arch_fallback(str(e))  # type: ignore[arg-type]

    # 2. Top file explanations
    logger.info(f"Explaining top {body.top_n} files for {repo_id}...")
    try:
        file_results = await explainer.explain_top_files(
            file_profiles=file_profiles,
            repo_root=clone_path,
            repo_name=repo_name,
            top_n=body.top_n,
            min_importance=body.min_importance,
        )
    except Exception as e:
        if not _is_provider_failure(e):
            raise
        logger.warning(f"File explanations fallback for {repo_id}: {e}")
        fallback_used = True
        fallback_reasons.append(f"files: {e!s}"[:200])
        file_results = []

    # 3. Module summaries
    logger.info(f"Generating module summaries for {repo_id}...")
    module_summaries: dict = {}
    if isinstance(module_graph, dict) and "modules" in module_graph:
        try:
            module_summaries = await explainer.explain_modules(module_graph, repo_name)
        except Exception as e:
            if not _is_provider_failure(e):
                raise
            logger.warning(f"Module summaries fallback for {repo_id}: {e}")
            fallback_used = True
            fallback_reasons.append(f"modules: {e!s}"[:200])
            module_summaries = {}

    return {
        "success": True,
        "repo_id": repo_id,
        "fallback": fallback_used,
        "fallback_reasons": fallback_reasons,
        "architecture": {
            "overview": arch_payload["overview"],
            "model": arch_payload["model"],
            "tokens_used": arch_payload["tokens_used"],
            "duration_ms": arch_payload["duration_ms"],
            "error": arch_payload["error"],
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
        # T2.4 — single seq counter threaded through the orchestrator's
        # event stream so the client can verify completeness.
        seq = 0
        try:
            async for event in orchestrator.run():
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from explain stream for {repo_id}. Aborting orchestrator run.")
                    break
                seq += 1
                yield f"event: {event['type']}\nid: {seq}\ndata: {json.dumps({**event['data'], 'seq': seq})}\n\n"
        except (TimeoutError, RateLimitError, ProviderError) as e:
            # The orchestrator is LLM-bound; if Groq/Gemini is unavailable the
            # stream errors mid-flight. Emit a deterministic-tour fallback so
            # the client still gets a usable response (zero LLM cost).
            logger.warning(f"Explain stream fell back to deterministic tour for {repo_id}: {e}")
            tour = generate_deterministic_tour(
                result.get("dep_data", {}), result.get("file_profiles", [])
            )
            seq += 1
            yield (
                f"event: fallback\nid: {seq}\n"
                f"data: {json.dumps({'seq': seq, 'fallback': True, 'fallback_reason': str(e)[:200], 'tour': tour})}\n\n"
            )
        except Exception as e:
            logger.error(f"SSE stream error for {repo_id}: {e}")
            message = getattr(e, "message", str(e))
            seq += 1
            yield f"event: error\nid: {seq}\ndata: {json.dumps({'seq': seq, 'message': message})}\n\n"
        finally:
            repo_id_ctx.reset(token)
            seq += 1
            yield f"event: done\nid: {seq}\ndata: {json.dumps({'status': 'complete', 'total_events': seq, 'seq': seq})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
