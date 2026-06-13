"""
cloner.py — Handles cloning GitHub repositories to a local directory.
"""

import logging
import os
import re
import shutil
import time
import uuid
from typing import Any, cast

from git import GitCommandError, Repo

from codekavi.config import CLONE_BASE_DIR

logger = logging.getLogger(__name__)

# Clone timeout: kill git if it takes longer than this
CLONE_TIMEOUT_S = 120  # 2 minutes max

# Max age for old cloned repos (hours) — increased from 2h since analysis
# results are now persisted in Redis/Supabase and survive repo cleanup.
MAX_REPO_AGE_HOURS = 24


def parse_github_url(url: str) -> dict:
    """
    Parse a GitHub URL and extract owner and repo name.
    Only HTTPS github.com URLs are accepted for security (prevents SSRF via SSH or private hosts).

    Supports:
      - https://github.com/owner/repo
      - https://github.com/owner/repo.git
    """
    url = url.strip().rstrip("/")

    # HTTPS format only — reject SSH and non-github.com hosts
    https_pattern = r"https://github\.com/([^/]+)/([^/.]+)(?:\.git)?$"
    match = re.match(https_pattern, url)
    if match:
        clone_url = url if url.endswith(".git") else url + ".git"
        return {"owner": match.group(1), "repo": match.group(2), "clone_url": clone_url}

    raise ValueError(
        f"Invalid GitHub URL: {url}. "
        "Only HTTPS github.com URLs are supported (e.g. https://github.com/owner/repo)."
    )


def clone_repo(github_url: str) -> dict:
    """
    Clone a GitHub repo into CLONE_BASE_DIR and return metadata.

    Returns:
        dict with keys: repo_id, repo_name, owner, clone_path
    """
    parsed = parse_github_url(github_url)
    repo_id = uuid.uuid4().hex[:12]
    clone_dir_name = f"{parsed['repo']}_{repo_id}"
    clone_path = os.path.join(CLONE_BASE_DIR, clone_dir_name)

    # Ensure base directory exists
    os.makedirs(CLONE_BASE_DIR, exist_ok=True)

    # Clean up if path already exists (shouldn't happen with uuid, but just in case)
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path)

    try:
        clone_kwargs = {
            "depth": 1,
            "env": {
                "GIT_HTTP_LOW_SPEED_LIMIT": "1000",   # bytes/sec min
                "GIT_HTTP_LOW_SPEED_TIME": "30",       # seconds before timeout
            },
        }
        if os.name != "nt":
            clone_kwargs["kill_after_timeout"] = CLONE_TIMEOUT_S

        Repo.clone_from(
            parsed["clone_url"],
            clone_path,
            **cast(Any, clone_kwargs)
        )
    except GitCommandError as e:
        # Clean up partial clone on failure
        if os.path.exists(clone_path):
            shutil.rmtree(clone_path, ignore_errors=True)
        raise RuntimeError(f"Failed to clone repository: {e}") from e

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
