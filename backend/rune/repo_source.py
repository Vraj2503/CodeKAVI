"""
repo_source.py — Modular URL parser and validator interface for multiple git providers.
Supports GitHub, GitLab, and Bitbucket.
"""

import re
from typing import TypedDict
from urllib.parse import urlparse


class RepoSourceInfo(TypedDict):
    owner: str
    repo: str
    clone_url: str
    provider: str


class RepoSource:
    """Base interface/class for git repository sources."""

    def __init__(self, hostname: str, provider_name: str):
        self.hostname = hostname.lower()
        self.provider_name = provider_name

    def validate_common(self, url: str) -> str:
        """Perform common SSRF, path traversal, and protocol checks on the URL."""
        try:
            parsed = urlparse(url)
        except Exception as e:
            raise ValueError(f"Invalid URL format: {e}") from e

        # 1. Scheme must be HTTPS
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS protocol is supported.")

        # 2. Hostname check
        if not parsed.hostname or parsed.hostname.lower() != self.hostname:
            raise ValueError(f"Only {self.hostname} URLs are supported by this parser.")

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

        return path

    def parse(self, url: str) -> RepoSourceInfo:
        raise NotImplementedError


class GitHubSource(RepoSource):
    """Source parser for GitHub repositories."""

    def __init__(self):
        super().__init__("github.com", "github")

    def parse(self, url: str) -> RepoSourceInfo:
        path = self.validate_common(url)
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError("GitHub URL must include owner and repository name.")

        owner = parts[0]
        repo = parts[1]
        if repo.endswith(".git"):
            repo = repo[:-4]

        # Alphanumeric check to prevent shell command injection
        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", owner) or not re.match(r"^[a-zA-Z0-9_\-\.]+$", repo):
            raise ValueError("Invalid owner or repository name in URL.")

        clone_url = f"https://github.com/{owner}/{repo}.git"
        return {
            "owner": owner,
            "repo": repo,
            "clone_url": clone_url,
            "provider": self.provider_name,
        }


class GitLabSource(RepoSource):
    """Source parser for GitLab repositories. Supports subgroups."""

    def __init__(self):
        super().__init__("gitlab.com", "gitlab")

    def parse(self, url: str) -> RepoSourceInfo:
        path = self.validate_common(url)
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError("GitLab URL must include workspace/owner and repository name.")

        # For GitLab, the "owner" could be a path of groups, e.g. gitlab-org/subgroup
        # We'll treat the last element as repo, and the rest joined as owner/namespace.
        repo = parts[-1]
        if repo.endswith(".git"):
            repo = repo[:-4]

        owner = "/".join(parts[:-1])

        # Validate alphanumeric and safe chars for each part to prevent shell command injection
        for part in parts:
            if not re.match(r"^[a-zA-Z0-9_\-\.]+$", part):
                raise ValueError("Invalid workspace or repository name in URL.")

        clone_url = f"https://gitlab.com/{owner}/{repo}.git"
        return {
            "owner": owner,
            "repo": repo,
            "clone_url": clone_url,
            "provider": self.provider_name,
        }


class BitbucketSource(RepoSource):
    """Source parser for Bitbucket repositories."""

    def __init__(self):
        super().__init__("bitbucket.org", "bitbucket")

    def parse(self, url: str) -> RepoSourceInfo:
        path = self.validate_common(url)
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError("Bitbucket URL must include owner/workspace and repository name.")

        owner = parts[0]
        repo = parts[1]
        if repo.endswith(".git"):
            repo = repo[:-4]

        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", owner) or not re.match(r"^[a-zA-Z0-9_\-\.]+$", repo):
            raise ValueError("Invalid owner or repository name in URL.")

        clone_url = f"https://bitbucket.org/{owner}/{repo}.git"
        return {
            "owner": owner,
            "repo": repo,
            "clone_url": clone_url,
            "provider": self.provider_name,
        }


def detect_source(url: str) -> RepoSource:
    """Detect and return the appropriate RepoSource parser for the given URL."""
    url = url.strip()
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValueError(f"Invalid URL format: {e}") from e

    hostname = parsed.hostname or ""
    hostname = hostname.lower()

    if hostname == "github.com":
        return GitHubSource()
    elif hostname == "gitlab.com":
        return GitLabSource()
    elif hostname == "bitbucket.org":
        return BitbucketSource()
    else:
        raise ValueError("Unsupported repository host. Supported hosts: github.com, gitlab.com, bitbucket.org")
