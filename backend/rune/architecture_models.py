"""Typed contract for the source-backed architecture.v2 visualization."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ArchitectureView = Literal["overview", "request_flow", "integration_map", "data_lifecycle", "event_flow", "component"]


class ArchitectureInclude(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actors: bool = True
    entry_points: bool = True
    application_capabilities: bool = True
    state: bool = True
    async_infrastructure: bool = True
    external_integrations: bool = True
    technology_products: bool = True
    model_names: bool = True
    edge_labels: bool = True
    evidence: Literal["inspector_only", "none"] = "inspector_only"


class ArchitectureLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Literal["LR"] = "LR"
    routing: Literal["orthogonal"] = "orthogonal"
    max_nodes: int = Field(default=18, ge=4, le=30)
    max_edges: int = Field(default=26, ge=0, le=48)
    collapse_supporting_components: bool = True


class ArchitectureEnrichment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["static"] = "static"


class ArchitectureFocus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str | None = Field(default=None, max_length=128)
    entrypoint_id: str | None = Field(default=None, max_length=128)


class ArchitectureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["architecture.v2"] = "architecture.v2"
    view: ArchitectureView = "overview"
    detail: Literal["compact", "standard", "expanded"] = "standard"
    include: ArchitectureInclude = Field(default_factory=ArchitectureInclude)
    layout: ArchitectureLayout = Field(default_factory=ArchitectureLayout)
    enrichment: ArchitectureEnrichment = Field(default_factory=ArchitectureEnrichment)
    focus: ArchitectureFocus | None = None


class ArchitectureRepository(BaseModel):
    repo_id: str
    topology: str
    confidence: float = Field(ge=0, le=1)


class ArchitectureGroup(BaseModel):
    id: str
    label: str
    order: int
    kind: str


class ArchitectureTechnology(BaseModel):
    vendor: str
    product: str
    model_name: str | None = Field(default=None, alias="model")
    purpose: str | None = None
    confidence: float = Field(ge=0, le=1)
    model_config = ConfigDict(populate_by_name=True)


class ArchitectureEvidence(BaseModel):
    path: str
    lines: list[int] | None = None
    reason: str


class ArchitectureNode(BaseModel):
    id: str
    label: str
    kind: str
    group_id: str
    summary: str
    technologies: list[ArchitectureTechnology] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    evidence: list[ArchitectureEvidence] = Field(default_factory=list)
    importance: float = Field(default=0, ge=0)


class ArchitectureEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    kind: str
    protocol: str | None = None
    is_async: bool = Field(default=False, alias="async")
    confidence: float = Field(ge=0, le=1)
    evidence_count: int = Field(ge=1)
    inferred: bool = False
    model_config = ConfigDict(populate_by_name=True)


class ArchitectureCollapsed(BaseModel):
    id: str
    label: str
    member_ids: list[str]
    reason: str


class ArchitectureAvailableFocus(BaseModel):
    id: str
    kind: str
    label: str


class ArchitectureDiagnostics(BaseModel):
    status: Literal["complete", "partial", "empty"]
    unsupported_languages: list[str] = Field(default_factory=list)
    excluded_low_confidence_edges: int = 0
    source_coverage: float = Field(default=0, ge=0, le=1)


class ArchitectureGraphData(BaseModel):
    schema_version: Literal["architecture.v2"] = "architecture.v2"
    repository: ArchitectureRepository
    groups: list[ArchitectureGroup]
    nodes: list[ArchitectureNode]
    edges: list[ArchitectureEdge]
    collapsed: list[ArchitectureCollapsed] = Field(default_factory=list)
    available_focuses: list[ArchitectureAvailableFocus] = Field(default_factory=list)
    diagnostics: ArchitectureDiagnostics


class ArchitectureResponse(BaseModel):
    type: Literal["architecture_graph"] = "architecture_graph"
    data: ArchitectureGraphData
