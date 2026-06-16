"""
codekavi — GitHub Repository Analysis Pipeline.

Clones repositories, traverses file structures, analyzes dependencies,
classifies file roles, and exports dependency graphs in multiple formats.
"""

from codekavi.analyzer import analyze_dependencies
from codekavi.classifier import classify_files, summarize_roles
from codekavi.cloner import cleanup_repo, clone_repo, parse_github_url, parse_repo_url
from codekavi.graph import (
    build_module_graph,
    detect_cycles,
    export_dot,
    export_graph_json,
    export_mermaid,
)
from codekavi.traverser import traverse_repo

__all__ = [
    "analyze_dependencies",
    "build_module_graph",
    "classify_files",
    "cleanup_repo",
    "clone_repo",
    "detect_cycles",
    "export_dot",
    "export_graph_json",
    "export_mermaid",
    "parse_github_url",
    "parse_repo_url",
    "summarize_roles",
    "traverse_repo",
]

__version__ = "0.2.0"
