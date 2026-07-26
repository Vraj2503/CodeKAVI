"""
routes/graph.py — Phase 1 semantic graph endpoint.

GET /graph/semantic/{repo_id} — deterministic, two-level graph payload
(layers, containers, files, edges, portals, insights) assembled from static
analysis data. Zero LLM calls, zero cache writes; ETag only.

Namespaced under /semantic/ because /graph/{repo_id} is already taken by
the legacy raw dependency export in routes/analyze.py (json/dot/mermaid/
module formats, still used by ArchitectureGraph.tsx / DependencyGraph.tsx).
"""

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.graph_assembler import assemble_graph
from codekavi.limiter import per_minute
from codekavi.quota import get_token_tracker
from codekavi.routes._errors import internal_error
from codekavi.routes.dependencies import get_cache
from codekavi.routes.visualize import _load_repo
from codekavi.tour_generator import assemble_question_tour, assemble_tour
from codekavi.utils import run_sync

router = APIRouter()


@router.get("/graph/semantic/{repo_id}", dependencies=[Depends(per_minute(30))])
async def get_repo_graph(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """Assemble the Phase 1 graph payload. No provider calls, no cache writes."""
    result, _ = await _load_repo(repo_id, cache, user_id)

    try:
        payload = await run_sync(assemble_graph, result)
    except Exception as e:
        raise internal_error(e, context="get_repo_graph: assembly failed") from e

    response_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    etag = f'W/"{hashlib.md5(response_bytes).hexdigest()}"'

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    return Response(
        content=response_bytes,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, max-age=300"},
    )


@router.get("/graph/semantic/{repo_id}/tour/question", dependencies=[Depends(per_minute(5))])
async def get_repo_question_tour(
    repo_id: str,
    q: str = Query(..., min_length=1, max_length=500),
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """G3: question-driven tour (G1+G2). The only phase-3 tour endpoint that
    costs money — it embeds ``q`` — so it's gated by the same token quota
    chat.py uses and rate-limited tighter than the free structural endpoints.
    """
    from codekavi.settings import settings
    from codekavi.vectorstore import zilliz_client

    tracker = get_token_tracker()
    if not tracker.check_quota(user_id):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": tracker.get_remaining(user_id),
                "enforced": settings.enforce_token_quota,
            },
        )

    if not zilliz_client.uri or not zilliz_client.token:
        raise HTTPException(
            status_code=503,
            detail="Vector store not configured. Set ZILLIZ_URI and ZILLIZ_API_KEY environment variables.",
        )

    result, _ = await _load_repo(repo_id, cache, user_id)

    try:
        graph = await run_sync(assemble_graph, result)
        search_results = await zilliz_client.search(q, repo_id, limit=8)
        payload = assemble_question_tour(graph, search_results)
    except Exception as e:
        raise internal_error(e, context="get_repo_question_tour: assembly failed") from e

    return Response(
        content=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/graph/semantic/{repo_id}/tour", dependencies=[Depends(per_minute(30))])
async def get_repo_tour(
    request: Request,
    repo_id: str,
    mode: str = Query("learn", pattern="^(learn|recall)$"),
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """E5: assembled tour steps (E1-E3) for the Phase 1 graph. No provider calls."""
    result, _ = await _load_repo(repo_id, cache, user_id)

    try:
        graph = await run_sync(assemble_graph, result)
        payload = assemble_tour(graph, mode)
    except Exception as e:
        raise internal_error(e, context="get_repo_tour: assembly failed") from e

    response_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    etag = f'W/"{hashlib.md5(response_bytes).hexdigest()}"'

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    return Response(
        content=response_bytes,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, max-age=300"},
    )
