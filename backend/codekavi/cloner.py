"""
cloner.py — Handles cloning GitHub repositories to a local directory.
"""

import contextlib
import logging
import os
import re
import shutil
import time
import uuid
from typing import Any, cast
from urllib.parse import urlparse

from git import Repo

from codekavi.config import CLONE_BASE_DIR
from codekavi.settings import settings

logger = logging.getLogger(__name__)

# Clone timeout: kill git if it takes longer than this
CLONE_TIMEOUT_S = 120  # 2 minutes max

# Max age for old cloned repos (hours) — increased from 2h since analysis
# results are now persisted in Redis/Supabase and survive repo cleanup.
MAX_REPO_AGE_HOURS = 24


def parse_github_url(url: str) -> dict:
    """
    Parse a GitHub URL and extract owner and repo name.
    Only HTTPS github.com URLs are accepted for security.
    """
    url = url.strip()
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValueError(f"Invalid URL format: {e}") from e

    # 1. Scheme must be HTTPS
    if parsed.scheme != "https":
        raise ValueError("Only HTTPS protocol is supported.")

    # 2. Host must be exactly github.com
    if not parsed.hostname or parsed.hostname.lower() != "github.com":
        raise ValueError("Only github.com URLs are supported.")

    # 3. Reject credentials
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not allowed.")

    # 4. Reject custom ports to prevent port scanning SSRF
    if parsed.port and parsed.port not in (80, 443):
        raise ValueError("Custom ports are not allowed.")

    # 5. Path validation
    path = parsed.path.strip("/")
    if ".." in path or "\\" in path:
        raise ValueError("Path traversal sequences are not allowed.")

    parts = path.split("/")
    if len(parts) < 2:
        raise ValueError("URL must include owner and repository name.")

    owner = parts[0]
    repo = parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]

    # Alphanumeric check to prevent shell command injection
    if not re.match(r"^[a-zA-Z0-9_\-\.]+$", owner) or not re.match(r"^[a-zA-Z0-9_\-\.]+$", repo):
        raise ValueError("Invalid owner or repository name in URL.")

    clone_url = f"https://github.com/{owner}/{repo}.git"
    return {"owner": owner, "repo": repo, "clone_url": clone_url}


def clone_repo(github_url: str) -> dict:
    """
    Clone a GitHub repo into CLONE_BASE_DIR and return metadata.
    Enforces repo size and file limits.

    Returns:
        dict with keys: repo_id, repo_name, owner, clone_path
    """
    parsed = parse_github_url(github_url)
    repo_id = uuid.uuid4().hex[:12]
    clone_dir_name = f"{parsed['repo']}_{repo_id}"
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
