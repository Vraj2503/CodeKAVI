"""
cloner.py — Handles cloning GitHub repositories to a local directory.
"""

import contextlib
import logging
import os
import shutil
import time
import uuid
from typing import Any, cast

from git import Repo

from codekavi.config import CLONE_BASE_DIR
from codekavi.repo_source import RepoSourceInfo
from codekavi.settings import settings

logger = logging.getLogger(__name__)

# Clone timeout: kill git if it takes longer than this
CLONE_TIMEOUT_S = 120  # 2 minutes max

# Max age for old cloned repos (hours) — increased from 2h since analysis
# results are now persisted in Redis/Supabase and survive repo cleanup.
MAX_REPO_AGE_HOURS = 24


def parse_github_url(url: str) -> RepoSourceInfo:
    """
    Parse a GitHub URL and extract owner and repo name.
    Only HTTPS github.com URLs are accepted for security.
    """
    from codekavi.repo_source import GitHubSource

    return GitHubSource().parse(url)


def parse_repo_url(url: str) -> RepoSourceInfo:
    """
    Parse a repository URL (GitHub, GitLab, or Bitbucket) and extract metadata.
    Supports subgroups for GitLab.
    """
    from codekavi.repo_source import detect_source

    return detect_source(url).parse(url)


def clone_repo(github_url: str) -> dict:
    """
    Clone a repository (GitHub, GitLab, or Bitbucket) into CLONE_BASE_DIR and return metadata.
    Enforces repo size and file limits.

    Returns:
        dict with keys: repo_id, repo_name, owner, clone_path
    """
    parsed = parse_repo_url(github_url)
    repo_id = uuid.uuid4().hex[:12]
    # Replace directory separators in repo name to ensure safety (e.g. GitLab subgroups)
    safe_repo_name = parsed["repo"].replace("/", "_")
    clone_dir_name = f"{safe_repo_name}_{repo_id}"
    clone_path = os.path.join(CLONE_BASE_DIR, clone_dir_name)

    # Ensure base directory exists
    os.makedirs(CLONE_BASE_DIR, exist_ok=True)

    # Clean up if path already exists
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path)

    try:
        clone_kwargs = {
            "depth": 1,
            "env": {
                "GIT_HTTP_LOW_SPEED_LIMIT": "1000",  # bytes/sec min
                "GIT_HTTP_LOW_SPEED_TIME": "30",  # seconds before timeout
            },
        }
        if os.name != "nt":
            clone_kwargs["kill_after_timeout"] = CLONE_TIMEOUT_S

        Repo.clone_from(parsed["clone_url"], clone_path, **cast(Any, clone_kwargs))

        # Enforce file count and size limits
        total_size = 0
        total_files = 0
        for root, dirs, files in os.walk(clone_path):
            # Exclude .git folder from sizing checks
            if ".git" in dirs:
                dirs.remove(".git")
            for f in files:
                total_files += 1
                fp = os.path.join(root, f)
                with contextlib.suppress(OSError):
                    total_size += os.path.getsize(fp)
                if total_files > settings.repo_file_limit:
                    shutil.rmtree(clone_path, ignore_errors=True)
                    raise ValueError(f"Repository exceeds file limit of {settings.repo_file_limit} files.")
                if total_size > settings.repo_size_limit_bytes:
                    shutil.rmtree(clone_path, ignore_errors=True)
                    raise ValueError(f"Repository exceeds size limit of {settings.repo_size_limit_bytes} bytes.")

    except Exception as e:
        # Clean up partial clone on failure
        if os.path.exists(clone_path):
            shutil.rmtree(clone_path, ignore_errors=True)
        from codekavi.exceptions import CloneError

        raise CloneError(f"Failed to clone repository: {e}") from e

    return {
        "repo_id": repo_id,
        "repo_name": parsed["repo"],
        "owner": parsed["owner"],
        "clone_path": clone_path,
    }


def cleanup_repo(clone_path: str) -> None:
    """Remove a previously cloned repository."""
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path, ignore_errors=True)


def cleanup_old_repos(max_age_hours: int = MAX_REPO_AGE_HOURS) -> None:
    """Remove cloned repos older than max_age_hours. Called on startup."""
    if not os.path.isdir(CLONE_BASE_DIR):
        return
    cutoff = time.time() - (max_age_hours * 3600)
    removed = 0
    for entry in os.listdir(CLONE_BASE_DIR):
        full_path = os.path.join(CLONE_BASE_DIR, entry)
        if os.path.isdir(full_path):
            try:
                mtime = os.path.getmtime(full_path)
                if mtime < cutoff:
                    shutil.rmtree(full_path, ignore_errors=True)
                    removed += 1
            except OSError:
                continue
    if removed:
        logger.info(f"Startup cleanup: removed {removed} old cloned repos")
