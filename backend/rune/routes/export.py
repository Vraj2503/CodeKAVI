"""
routes/export.py — Placeholder export endpoints.

Endpoints:
    GET /export/{repo_id}/html     — Export analysis as HTML (coming soon).
    GET /export/{repo_id}/markdown — Export analysis as Markdown (coming soon).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from rune.auth import verify_supabase_token
from rune.limiter import per_minute

router = APIRouter()


@router.get("/export/{repo_id}/html", dependencies=[Depends(per_minute(30))])
async def export_html(repo_id: str, user_id: str = Depends(verify_supabase_token)):
    """Export analysis as HTML — not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"detail": "Coming soon", "format": "html", "repo_id": repo_id},
    )


@router.get("/export/{repo_id}/markdown", dependencies=[Depends(per_minute(30))])
async def export_markdown(repo_id: str, user_id: str = Depends(verify_supabase_token)):
    """Export analysis as Markdown — not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"detail": "Coming soon", "format": "markdown", "repo_id": repo_id},
    )
