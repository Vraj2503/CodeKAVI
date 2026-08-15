from typing import Any

from pydantic import BaseModel


class FileEntry(BaseModel):
    path: str
    name: str
    extension: str
    language: str
    size: int
    size_formatted: str
    depth: int
    mtime: float
    content: str | None = None
    raw_imports: list[dict[str, Any]] | None = None
    model_config = {"extra": "allow"}


class RepoData(BaseModel):
    total_files: int
    total_size: int
    total_size_formatted: str
    languages: dict[str, int]
    tree: list[dict[str, Any]]
    files: list[FileEntry]
    skipped_files: list[dict[str, Any]]
    model_config = {"extra": "allow"}


class DepGraph(BaseModel):
    edges: list[dict[str, Any]]
    adjacency: dict[str, set[str] | list[str]]
    reverse_adjacency: dict[str, set[str] | list[str]]
    file_imports: dict[str, list[dict[str, Any]]]
    entry_points: list[dict[str, Any]]
    file_signals: dict[str, list[str]]
    central_files: list[dict[str, Any]]
    stats: dict[str, Any]
    error: str | None = None
    model_config = {"extra": "allow"}


class FileProfile(BaseModel):
    path: str
    name: str
    language: str
    size: int
    role: str
    role_label: str
    role_confidence: float
    depends_on: list[str]
    used_by: list[str]
    in_degree: int
    out_degree: int
    importance_score: float
    tags: list[str]
    # Optional so analyses cached before these existed still validate. None
    # means "not measured", which the treemap renders differently from a real
    # low score — see rune/complexity.py.
    loc: int | None = None
    complexity: int | None = None
    complexity_source: str | None = None
    model_config = {"extra": "allow"}


class AnalysisResult(BaseModel):
    success: bool
    repo_id: str
    repo_name: str
    owner: str
    github_url: str

    files: list[dict[str, Any]]
    languages: dict[str, int]
    total_files: int
    total_lines: int

    dependencies: dict[str, Any]
    file_profiles: list[dict[str, Any]]

    graph_json: str
    mermaid_file: str
    module_graph: dict[str, Any]
    cycles: list[list[str]]

    model_config = {"extra": "allow"}
