"""
session.py — In-memory session store for active repo analyses.

Shared across all route modules. This single module owns the global
dicts so there's exactly one source of truth and no circular imports.
"""

import os
import logging

from codekavi.config import CLONE_BASE_DIR
from codekavi.traverser import traverse_repo
from codekavi.analyzer import analyze_dependencies
from codekavi.classifier import classify_files, summarize_roles
from codekavi.graph import export_graph_json, build_module_graph

logger = logging.getLogger(__name__)

# ── Global in-memory stores ──
active_sessions: dict[str, str] = {}    # repo_id → clone_path
active_results: dict[str, dict] = {}    # repo_id → full analysis data


def find_clone_path_by_repo_id(repo_id: str) -> str | None:
    """Find an on-disk clone folder by repo_id suffix: <repo_name>_<repo_id>."""
    if not os.path.isdir(CLONE_BASE_DIR):
        return None

    suffix = f"_{repo_id}"
    for entry in os.listdir(CLONE_BASE_DIR):
        full_path = os.path.join(CLONE_BASE_DIR, entry)
        if os.path.isdir(full_path) and entry.endswith(suffix):
            return full_path
    return None


def ensure_repo_loaded(repo_id: str) -> tuple[dict | None, str | None]:
    """
    Ensure repo analysis is available in memory for a repo_id.
    If missing, lazily rebuild from an existing cloned folder on disk.
    """
    result = active_results.get(repo_id)
    clone_path = active_sessions.get(repo_id)
    if result and clone_path:
        return result, clone_path

    clone_path = clone_path or find_clone_path_by_repo_id(repo_id)
    if not clone_path:
        return None, None

    # If we have path but not result, rebuild cached analysis for this process.
    if not result:
        repo_data = traverse_repo(clone_path)
        dep_data = analyze_dependencies(clone_path, repo_data["files"])
        file_profiles = classify_files(clone_path, repo_data["files"], dep_data)
        role_summary = summarize_roles(file_profiles)
        graph_json = export_graph_json(dep_data, file_profiles)
        module_graph = build_module_graph(dep_data, file_profiles, depth=1)

        repo_dir = os.path.basename(clone_path)
        repo_name, _, _ = repo_dir.rpartition("_")

        active_results[repo_id] = {
            "repo_name": repo_name,
            "owner": "",
            "repo_data": repo_data,
            "dep_data": dep_data,
            "file_profiles": file_profiles,
            "role_summary": role_summary,
            "graph_json": graph_json,
            "module_graph": module_graph,
        }

    active_sessions[repo_id] = clone_path
    return active_results.get(repo_id), clone_path
