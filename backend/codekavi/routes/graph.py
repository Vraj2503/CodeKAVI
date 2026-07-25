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

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.graph_assembler import assemble_graph
from codekavi.limiter import per_minute
from codekavi.routes._errors import internal_error
from codekavi.routes.dependencies import get_cache
from codekavi.routes.visualize import _load_repo
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
