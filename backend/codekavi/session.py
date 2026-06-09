"""
session.py — Session store for active repo analyses.

Uses the 3-tier AnalysisCache (in-memory → Redis → Supabase) instead
of raw in-memory dicts.  This module owns the global cache instance
so there's exactly one source of truth and no circular imports.
"""

import os
import logging

from codekavi.config import CLONE_BASE_DIR
from codekavi.cache import analysis_cache

logger = logging.getLogger(__name__)

# ── Backward-compatible aliases ──
# These point into the L1 (in-memory) layer of the cache.
# Existing code that writes to active_sessions/active_results
# directly will still work, but prefer cache.set()/cache.get().
active_sessions: dict[str, str] = analysis_cache._sessions
active_results: dict[str, dict] = analysis_cache._memory


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
    Ensure repo analysis is available for a repo_id.

    Cache chain: L1 (memory) → L2 (Redis) → L3 (Supabase) → re-analyze from clone → None.

    Returns (result_dict, clone_path) or (None, None).
    """
    # Fast path: check L1 memory
    clone_path = analysis_cache.get_session_path(repo_id)
    result = analysis_cache.get(repo_id)
    if result and clone_path:
        return result, clone_path

    # If we got a result from L2/L3 but no clone_path, try to find it on disk
    if result and not clone_path:
        clone_path = find_clone_path_by_repo_id(repo_id)
        if clone_path:
            analysis_cache.set_session_path(repo_id, clone_path)
            return result, clone_path
        # We have cached results but no clone dir — still usable for
        # chat/visualize/explain (they only need the result dict).
        # Return with clone_path=None; callers that need files will handle it.
        return result, None

    # No cached result anywhere. Try to find the clone dir and re-analyze.
    clone_path = clone_path or find_clone_path_by_repo_id(repo_id)
    if not clone_path:
        return None, None

    # Re-analyze from disk with full error handling
    try:
        logger.info(f"Re-analyzing repo {repo_id} from disk: {clone_path}")

        from codekavi.traverser import traverse_repo
        from codekavi.analyzer import analyze_dependencies
        from codekavi.classifier import classify_files, summarize_roles
        from codekavi.graph import export_graph_json, build_module_graph
        from codekavi.file_selector import SmartFileSelector

        repo_data = traverse_repo(clone_path)
        dep_data = analyze_dependencies(clone_path, repo_data["files"])

        # Extract content_cache before passing to classifier
        content_cache = dep_data.pop("content_cache", None)

        file_profiles = classify_files(
            clone_path, repo_data["files"], dep_data,
            content_cache=content_cache,
        )
        role_summary = summarize_roles(file_profiles)
        graph_json = export_graph_json(dep_data, file_profiles)
        module_graph = build_module_graph(dep_data, file_profiles, depth=1)

        # Smart file selection (was missing in the original re-analysis path)
        selector = SmartFileSelector()
        selected_files = selector.select_files(
            repo_data["files"], dep_data, file_profiles
        )

        repo_dir = os.path.basename(clone_path)
        repo_name, _, _ = repo_dir.rpartition("_")

        result = {
            "repo_name": repo_name,
            "owner": "",
            "repo_data": repo_data,
            "dep_data": dep_data,
            "file_profiles": file_profiles,
            "role_summary": role_summary,
            "graph_json": graph_json,
            "module_graph": module_graph,
            "selected_files": selected_files,
        }

        # Persist to all cache tiers
        analysis_cache.set(repo_id, result)
        analysis_cache.set_session_path(repo_id, clone_path)

        return result, clone_path

    except Exception as e:
        logger.error(f"Re-analysis failed for {repo_id}: {e}", exc_info=True)
        return None, None


def save_analysis(repo_id: str, clone_path: str, result: dict) -> None:
    """
    Persist analysis results to all cache tiers and register session path.
    Called by analyze routes after initial analysis.
    """
    analysis_cache.set(repo_id, result)
    analysis_cache.set_session_path(repo_id, clone_path)
