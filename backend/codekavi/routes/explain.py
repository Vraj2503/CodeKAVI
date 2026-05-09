"""
routes/explain.py — LLM-powered code explanation endpoints.

Endpoints:
    POST /explain/{repo_id}        — Generate architecture overview + top-N file explanations.
    POST /explain/file/{repo_id}   — Generate LLM explanation for a single file.
    POST /explain/{repo_id}/stream — SSE streaming parallel explanation.
"""

import os
import json
import logging

from fastapi import APIRouter, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse

from codekavi.schemas import ExplainRequest, ExplainFileRequest
from codekavi.session import active_sessions, active_results, ensure_repo_loaded
from codekavi.llm import get_provider, Explainer
from codekavi.orchestrator import ExplanationOrchestrator

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_explainer(model: str | None = None):
    """Create an Explainer instance. Raises HTTPException if no API key."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="GEMINI_API_KEY environment variable not set. "
                   "Set it to your Gemini API key to enable LLM explanations."
        )

    provider = get_provider("explain")
    return Explainer(provider, model=model)


@router.post("/explain/{repo_id}")
async def explain_repo(repo_id: str, body: ExplainRequest):
    """
    Generate LLM explanations for a previously analyzed repo.

    Returns:
      - architecture_overview: full architecture narrative
      - file_explanations: list of top-N file explanations
      - module_summaries: short summaries per module
      - stats: token usage, timing, etc.
    """
    try:
        result, clone_path = ensure_repo_loaded(repo_id)
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
    arch_result = explainer.explain_architecture(
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
    file_results = explainer.explain_top_files(
        file_profiles=file_profiles,
        repo_root=clone_path,
        repo_name=repo_name,
        top_n=body.top_n,
        min_importance=body.min_importance,
    )

    # 3. Module summaries
    logger.info(f"Generating module summaries for {repo_id}...")
    if isinstance(module_graph, dict) and "modules" in module_graph:
        module_summaries = explainer.explain_modules(module_graph, repo_name)
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
async def explain_single_file(repo_id: str, body: ExplainFileRequest):
    """
    Generate an LLM explanation for a single file in a previously analyzed repo.
    """
    try:
        result, clone_path = ensure_repo_loaded(repo_id)
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

    file_result = explainer.explain_file(profile, clone_path, repo_name)

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
async def explain_repo_stream(repo_id: str, body: ExplainRequest):
    """
    Stream explanation sections via Server-Sent Events (SSE).

    Each event has a type and JSON data payload:
      - stats    → instant repo statistics
      - tree     → directory structure
      - progress → generation progress
      - section  → completed explanation section
      - warning  → failed section
      - error    → fatal error
      - done     → stream complete
    """
    try:
        result, clone_path = ensure_repo_loaded(repo_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    async def event_stream():
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
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        except Exception as e:
            logger.error(f"SSE stream error for {repo_id}: {e}")
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        finally:
            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
