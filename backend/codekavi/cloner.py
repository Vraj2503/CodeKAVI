"""
cloner.py — Handles cloning GitHub repositories to a local directory.
"""

import contextlib
import logging
import os
import shutil
import subprocess
import time
import uuid

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
        dict with keys: repo_id, repo_name, owner, clone_path, commit_sha, repo_signature.
        ``repo_signature`` is ``f"{owner}/{repo_name}@{commit_sha}"`` — a stable key for
        cross-user cache deduplication (T4.4). Two users probing the same repo at the
        same commit get the same repo_signature and share a single analysis result.
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
        # Clone via a raw subprocess (not GitPython's Repo.clone_from) so the
        # timeout is enforced uniformly on every platform — GitPython's
        # kill_after_timeout raises GitCommandError if passed on Windows at
        # all, so a stuck clone there would otherwise hang the worker forever.
        clone_env = os.environ.copy()
        clone_env["GIT_HTTP_LOW_SPEED_LIMIT"] = "1000"  # bytes/sec min
        clone_env["GIT_HTTP_LOW_SPEED_TIME"] = "30"  # seconds before timeout

        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", parsed["clone_url"], clone_path],
                env=clone_env,
                timeout=CLONE_TIMEOUT_S,
                check=True,
                capture_output=True,
            )
        except subprocess.TimeoutExpired as e:
            raise RuntimeError(f"git clone timed out after {CLONE_TIMEOUT_S}s") from e
        except subprocess.CalledProcessError as e:
            stderr = e.stderr.decode("utf-8", errors="ignore") if e.stderr else str(e)
            raise RuntimeError(f"git clone failed: {stderr}") from e

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

    # T4.4 — Read HEAD commit SHA for cross-user cache deduplication. Use the
    # absolute path with forward slashes to avoid platform-specific issues.
    commit_sha = _read_head_sha(clone_path)
    repo_signature = f"{parsed['owner']}/{parsed['repo']}@{commit_sha}"

    return {
        "repo_id": repo_id,
        "repo_name": parsed["repo"],
        "owner": parsed["owner"],
        "clone_path": clone_path,
        "commit_sha": commit_sha,
        "repo_signature": repo_signature,
    }


def _read_head_sha(clone_path: str) -> str:
    """
    Read the HEAD commit SHA from a freshly cloned repo.

    Falls back to the mtime-encoded fallback ("unknown-<mtime>") if git's
    plumbing command is unavailable (e.g. the clone corrupted on disk).
    """
    try:
        sha = (
            subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=clone_path,
                stderr=subprocess.PIPE,
            )
            .decode("utf-8", errors="ignore")
            .strip()
        )
        if sha:
            return sha
    except Exception as e:
        logger.debug(f"Failed to read HEAD SHA from {clone_path}: {e}")
    # Fallback: include mtime so two distinct clones yield different sigs.
    try:
        mtime = int(os.path.getmtime(clone_path))
    except OSError:
        mtime = 0
    return f"unknown-{mtime}"


def cleanup_repo(clone_path: str) -> None:
    """Remove a previously cloned repository.

    L-06: raises on deletion failure instead of silently swallowing it via
    ignore_errors=True — a leaked clone directory should be observable. Both
    callers (routes/analyze.py's safe_cleanup() and the /cleanup route)
    already catch and log a warning, so this can't surface as a 500.
    """
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path)


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
