"""
codekavi — GitHub Repository Analysis Pipeline.

Clones repositories, traverses file structures, analyzes dependencies,
classifies file roles, and exports dependency graphs in multiple formats.
"""

from codekavi.cloner import clone_repo, cleanup_repo, parse_github_url
from codekavi.traverser import traverse_repo
from codekavi.analyzer import analyze_dependencies
from codekavi.classifier import classify_files, summarize_roles
from codekavi.graph import (
    export_graph_json,
    export_dot,
    export_mermaid,
    build_module_graph,
    detect_cycles,
)

__all__ = [
    "clone_repo",
    "cleanup_repo",
    "parse_github_url",
    "traverse_repo",
    "analyze_dependencies",
    "classify_files",
    "summarize_roles",
    "export_graph_json",
    "export_dot",
    "export_mermaid",
    "build_module_graph",
    "detect_cycles",
]

__version__ = "0.2.0"
