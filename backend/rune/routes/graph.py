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

from rune.auth import verify_supabase_token
from rune.cache import AnalysisCache
from rune.graph_assembler import assemble_graph
from rune.limiter import per_minute
from rune.quota import get_token_tracker
from rune.routes._errors import internal_error
from rune.routes.dependencies import get_cache
from rune.routes.visualize import _load_repo
from rune.tour_generator import assemble_diff_tour, assemble_question_tour, assemble_tour
from rune.utils import run_sync

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
    from rune.settings import settings
    from rune.vectorstore import zilliz_client

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


@router.get("/graph/semantic/{repo_id}/tour/diff", dependencies=[Depends(per_minute(30))])
async def get_repo_diff_tour(
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """H3: diff tour (H2) from H1's ``last_change_map``. Zero LLM calls, same
    free tier as the other structural endpoints.

    A repo with no cached analysis at all already 404s in ``_load_repo``
    ("Run /api/analyze first"). The 404 here is the other case: a cached
    result that predates ``last_change_map`` (analyzed before this feature
    shipped) — no change data to diff, not the same as "nothing changed"
    (which is a present, possibly-empty map and a 200 with zero steps).
    """
    result, _ = await _load_repo(repo_id, cache, user_id)

    change_map = result.get("last_change_map")
    if change_map is None:
        raise HTTPException(
            status_code=404,
            detail="No change data for this repo yet. Re-run /api/analyze to enable the diff tour.",
        )

    try:
        graph = await run_sync(assemble_graph, result)
        payload = assemble_diff_tour(graph, change_map)
    except Exception as e:
        raise internal_error(e, context="get_repo_diff_tour: assembly failed") from e

    return Response(
        content=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/graph/semantic/{repo_id}/tour/node/{node_id:path}", dependencies=[Depends(per_minute(10))])
async def get_repo_tour_node_narration(
    request: Request,
    repo_id: str,
    node_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """A3: on-demand LLM narration for a single tour step's node. Costs money
    (one completion call), so quota-gated and rate-limited like the question
    tour. ETag is keyed on repo_id|node_id (not response content) so a
    repeat request for the same node short-circuits before touching Zilliz
    or the LLM — narration for a given node is treated as stable.
    """
    from rune.settings import settings
    from rune.vectorstore import zilliz_client

    etag = f'W/"{hashlib.md5(f"{repo_id}|{node_id}".encode()).hexdigest()}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

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

    # _load_repo asserts ownership; narration falls back to null (frontend
    # keeps its static facts) rather than a hard error on any downstream miss.
    await _load_repo(repo_id, cache, user_id)

    narration = None
    if zilliz_client.uri and zilliz_client.token:
        try:
            results = await zilliz_client.search(node_id, repo_id, limit=8)
            chunks = [r for r in results if r.get("file_path") == node_id][:3]
            if chunks:
                from rune.llm import get_provider
                from rune.llm.providers import Message

                combined = "\n".join(f"File: {c['file_path']}\n{c['text']}" for c in chunks)
                messages = [
                    Message(
                        role="system",
                        content=(
                            "You are an expert AI engineer analyzing a codebase. In 2-3 "
                            "sentences, explain this file's role and why it matters to the "
                            "architecture. Be concrete, not generic."
                        ),
                    ),
                    Message(role="user", content=combined),
                ]
                provider = get_provider("groq")
                response = await run_sync(provider.complete, messages=messages, temperature=0.4, max_tokens=256)
                narration = response.content
                tokens_used = response.usage.get("total_tokens", 0) if response.usage else 0
                tracker.record(user_id, provider=provider.name, tokens=tokens_used)
        except Exception:
            narration = None

    return Response(
        content=json.dumps({"narration": narration}, separators=(",", ":")).encode("utf-8"),
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, max-age=300"},
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
