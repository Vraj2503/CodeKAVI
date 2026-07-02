"""
session.py — Session store for active repo analyses.

Uses the 3-tier AnalysisCache (in-memory → Redis → Supabase) instead
of raw in-memory dicts.
"""

import logging
import os

from codekavi.cache import AnalysisCache
from codekavi.config import CLONE_BASE_DIR
from codekavi.settings import settings
from codekavi.utils import BoundedContentCache

logger = logging.getLogger(__name__)


def find_clone_path_by_repo_id(repo_id: str) -> str | None:
    """Find an on-disk clone folder by repo_id suffix: <repo_name>_<repo_id>."""
    # Prevent path traversal by strictly validating repo_id characters
    import re

    if not re.match(r"^[a-zA-Z0-9_]+$", repo_id) or ".." in repo_id:
        return None

    if not os.path.isdir(CLONE_BASE_DIR):
        return None

    suffix = f"_{repo_id}"
    for entry in os.listdir(CLONE_BASE_DIR):
        full_path = os.path.join(CLONE_BASE_DIR, entry)
        if os.path.isdir(full_path) and entry.endswith(suffix):
            return full_path
    return None


def ensure_repo_loaded(repo_id: str, cache: AnalysisCache) -> tuple[dict | None, str | None]:
    """
    Ensure repo analysis is available for a repo_id.

    Cache chain: L1 (memory) → L2 (Redis) → L3 (Supabase) → re-analyze from clone → None.

    Returns (result_dict, clone_path) or (None, None).
    """
    # Fast path: check L1 memory
    clone_path = cache.get_session_path(repo_id)
    result = cache.get(repo_id)
    if result and clone_path:
        return result, clone_path

    # If we got a result from L2/L3 but no clone_path, try to find it on disk
    if result and not clone_path:
        clone_path = find_clone_path_by_repo_id(repo_id)
        if clone_path:
            cache.set_session_path(repo_id, clone_path)
            return result, clone_path
        # We have cached results but no clone dir. Let the caller handle it gracefully.
        return result, None

    # No cached result anywhere. Try to find the clone dir and re-analyze.
    clone_path = clone_path or find_clone_path_by_repo_id(repo_id)
    if not clone_path:
        return None, None

    # Re-analyze from disk asynchronously
    def _bg_reanalyze():
        try:
            logger.info(f"Re-analyzing repo {repo_id} from disk: {clone_path}")
            
            from codekavi.analyzer import analyze_dependencies
            from codekavi.classifier import classify_files, summarize_roles
            from codekavi.file_selector import SmartFileSelector
            from codekavi.graph import build_module_graph, export_graph_json
            from codekavi.traverser import traverse_repo
            
            repo_data = traverse_repo(clone_path)
            # Create content_cache_dict for pre-population
            content_cache_dict = {}
            for f in repo_data.get("files", []):
                if "content" in f:
                    content_cache_dict[f["path"]] = f.pop("content")
                    
            content_cache = BoundedContentCache(settings.max_content_cache_bytes)
            for k, v in content_cache_dict.items():
                content_cache.cache[k] = v
                content_cache.current_size += len(v.encode('utf-8'))
                
            try:
                dep_data = analyze_dependencies(clone_path, repo_data["files"], content_cache)
                file_profiles = classify_files(
                    clone_path,
                    repo_data["files"],
                    dep_data,
                    content_cache=content_cache,
                )
            finally:
                content_cache.clear()
                del content_cache
                
            role_summary = summarize_roles(file_profiles)
            graph_json = export_graph_json(dep_data, file_profiles)
            module_graph = build_module_graph(dep_data, file_profiles, depth=1)
            
            selector = SmartFileSelector()
            selected_files = selector.select_files(repo_data["files"], dep_data, file_profiles)
            
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
                "clone_path": clone_path, # Cache clone_path in result
            }
            
            cache.set(repo_id, result)
            cache.set_session_path(repo_id, clone_path)
            
        except Exception as e:
            logger.error(f"Re-analysis failed for {repo_id}: {e}", exc_info=True)

    import threading
    threading.Thread(target=_bg_reanalyze, daemon=True).start()

    from fastapi import HTTPException
    raise HTTPException(status_code=202, detail={"status": "re-analyzing"})

    # (Synchronous block replaced by the async thread above)

def save_analysis(repo_id: str, clone_path: str, result: dict, cache: AnalysisCache) -> None:
    """
    Persist analysis results to all cache tiers and register session path.
    Called by analyze routes after initial analysis.
    """
    cache.set(repo_id, result)
    cache.set_session_path(repo_id, clone_path)
