"""
schemas.py — Pydantic request/response models shared across route modules.

Extracted from main.py to avoid circular imports and keep route files focused.
"""

from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    """Request body for /api/analyze endpoint. Contains the GitHub URL to analyze."""
    github_url: str


class ExplainRequest(BaseModel):
    """Request body for /api/explain/{repo_id} endpoint. Contains parameters for LLM explanations."""
    top_n: int = 10
    min_importance: float = 10.0
    model: str | None = "gemini-2.0-flash"
    depth: str = "detailed"


class ExplainFileRequest(BaseModel):
    """Request body for /api/explain/file/{repo_id} endpoint. Contains the file path and optional model."""
    file_path: str
    model: str | None = "gemini-2.0-flash"


class ChatRequest(BaseModel):
    """Request body for /api/chat/{repo_id} endpoint."""
    query: str
    model: str | None = "gemini-2.0-flash"
