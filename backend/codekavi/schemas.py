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


# ──────────────────────────────────────────────────────────────────────
# Neural Network model schemas (for NN visualization feature)
# ──────────────────────────────────────────────────────────────────────


class NNBlockDims(BaseModel):
    """Pre-computed dimensions for PlotNeuralNet-style 3D block rendering."""

    height: float = 20.0  # Proportional to spatial H
    depth: float = 20.0  # Proportional to spatial W
    width: float = 2.0  # Proportional to channels/filters


class NNLayer(BaseModel):
    """A single layer in a neural network architecture."""

    id: str
    type: str  # "Conv2d", "Linear", "LSTM", etc.
    category: str = "other"  # "convolution", "pooling", "dense", "normalization", "activation", "dropout", "recurrent", "attention", "embedding", "output", "other"
    params: dict = Field(default_factory=dict)
    output_shape: list[int] | None = None
    param_count: int | None = None
    activation: str | None = None
    block_dims: NNBlockDims | None = None


class NNConnection(BaseModel):
    """Connection between two layers in a neural network."""

    from_id: str
    to_id: str
    type: str = "sequential"  # "sequential" | "skip" | "concat" | "add"
    label: str | None = None  # Dimension annotation on arrow


class NNBlock(BaseModel):
    """A logical block grouping layers (e.g., ResNet block, Encoder)."""

    name: str
    layers: list[str] = Field(default_factory=list)  # Layer IDs
    has_skip: bool = False


class NNModel(BaseModel):
    """Complete neural network model architecture extracted from source code."""

    name: str
    file: str
    line: int = 0
    framework: str = "unknown"  # "pytorch", "tensorflow", "keras", "jax"
    type: str = "unknown"  # "class" | "sequential" | "functional"
    total_params: int | None = None
    input_shape: list[int] | None = None
    output_shape: list[int] | None = None
    layers: list[NNLayer] = Field(default_factory=list)
    connections: list[NNConnection] = Field(default_factory=list)
    blocks: list[NNBlock] | None = None
