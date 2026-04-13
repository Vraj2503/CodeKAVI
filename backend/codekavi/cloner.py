"""
cloner.py — Handles cloning GitHub repositories to a local directory.
"""

import os
import re
import shutil
import uuid

from git import Repo, GitCommandError

from codekavi.config import CLONE_BASE_DIR


def parse_github_url(url: str) -> dict:
    """
    Parse a GitHub URL and extract owner and repo name.
    Supports formats:
      - https://github.com/owner/repo
      - https://github.com/owner/repo.git
      - git@github.com:owner/repo.git
    """
    url = url.strip().rstrip("/")

    # HTTPS format
    https_pattern = r"https?://github\.com/([^/]+)/([^/.]+)(?:\.git)?$"
    match = re.match(https_pattern, url)
    if match:
        return {"owner": match.group(1), "repo": match.group(2), "clone_url": url if url.endswith(".git") else url + ".git"}

    # SSH format
    ssh_pattern = r"git@github\.com:([^/]+)/([^/.]+)(?:\.git)?$"
    match = re.match(ssh_pattern, url)
    if match:
        return {"owner": match.group(1), "repo": match.group(2), "clone_url": url if url.endswith(".git") else url + ".git"}

    raise ValueError(f"Invalid GitHub URL: {url}")


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
        Repo.clone_from(parsed["clone_url"], clone_path, depth=1)
    except GitCommandError as e:
        raise RuntimeError(f"Failed to clone repository: {e}")

    return {
        "repo_id": repo_id,
        "repo_name": parsed["repo"],
        "owner": parsed["owner"],
        "clone_path": clone_path,
    }


def cleanup_repo(clone_path: str) -> None:
    """Remove a previously cloned repository."""
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path)
