"""
schemas.py — Pydantic request/response models shared across route modules.

Extracted from main.py to avoid circular imports and keep route files focused.
"""

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """Request body for /api/analyze endpoint. Contains the GitHub URL to analyze."""

    github_url: str


class ExplainRequest(BaseModel):
    """Request body for /api/explain/{repo_id} endpoint. Contains parameters for LLM explanations."""

    top_n: int = 10
    min_importance: float = 10.0
    model: str | None = None
    depth: str = "detailed"
    prompt: str | None = None


class ExplainFileRequest(BaseModel):
    """Request body for /api/explain/file/{repo_id} endpoint. Contains the file path and optional model."""

    file_path: str
    model: str | None = None


class ChatRequest(BaseModel):
    """Request body for /api/chat/{repo_id} endpoint."""

    query: str
    model: str | None = None


# ──────────────────────────────────────────────────────────────────────
# LLM response section models (T2.2 — 4-tier validation)
# ──────────────────────────────────────────────────────────────────────
#
# These feed into `validate_section()` in normalizer.py. Note that
# `visualization_data` is always a NESTED dict (e.g. {"nodes": [...],
# "edges": [...]} for dependency graphs, or {"name": ..., "children":
# [...]} for mindmaps). It is NEVER a single node-like object, so the
# type is strictly `dict | None`.
#
# The frontend reads `visualization_data.type` discriminants from
# `_viz_type()` in orchestrator.py (lines 690-698).


class VizNode(BaseModel):
    """A single node inside a V viz payload."""

    id: str
    label: str = ""
    type: str = "unknown"
    # additional fields pass through unchecked (the frontend tolerates extras)
    model_config = {"extra": "allow"}


class VizEdge(BaseModel):
    """A single edge inside a V viz payload."""

    source: str
    target: str
    label: str = ""
    type: str = "import"
    model_config = {"extra": "allow"}


class SectionResponse(BaseModel):
    """Shape returned by `ExplanationOrchestrator._gen()` and validated by
    `validate_section()`. Fields are permissive so partial LLM outputs
    survive Tier 3 downgrade."""

    title: str = ""
    content: str = ""
    code_snippets: list[dict] = Field(default_factory=list)
    visualization_type: str | None = None
    visualization_data: dict | None = None
