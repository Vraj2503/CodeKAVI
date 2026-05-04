"""
routes/export.py — Placeholder export endpoints.

Endpoints:
    GET /export/{repo_id}/html     — Export analysis as HTML (coming soon).
    GET /export/{repo_id}/markdown — Export analysis as Markdown (coming soon).
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/export/{repo_id}/html")
async def export_html(repo_id: str):
    """Export analysis as HTML — not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"detail": "Coming soon", "format": "html", "repo_id": repo_id},
    )


@router.get("/export/{repo_id}/markdown")
async def export_markdown(repo_id: str):
    """Export analysis as Markdown — not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"detail": "Coming soon", "format": "markdown", "repo_id": repo_id},
    )
