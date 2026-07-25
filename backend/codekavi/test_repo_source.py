"""SSRF guard: RepoSource.validate_common must reject non-HTTPS schemes, wrong
hosts, embedded credentials, non-standard ports, and path traversal, and
detect_source must refuse unlisted hosts."""

import pytest

from codekavi.repo_source import BitbucketSource, GitHubSource, GitLabSource, detect_source


def test_github_parses_owner_and_repo():
    info = GitHubSource().parse("https://github.com/octocat/Hello-World.git")
    assert info == {
        "owner": "octocat",
        "repo": "Hello-World",
        "clone_url": "https://github.com/octocat/Hello-World.git",
        "provider": "github",
    }


def test_gitlab_supports_subgroups():
    info = GitLabSource().parse("https://gitlab.com/group/subgroup/project")
    assert info["owner"] == "group/subgroup"
    assert info["repo"] == "project"


def test_bitbucket_parses_owner_and_repo():
    info = BitbucketSource().parse("https://bitbucket.org/team/repo")
    assert info["owner"] == "team"
    assert info["repo"] == "repo"


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/octocat/Hello-World",  # non-HTTPS
        "file:///etc/passwd",  # local file scheme
        "ext::sh -c 'id'@github.com/a/b",  # non-HTTPS scheme smuggling
        "https://evil.com/octocat/Hello-World",  # wrong host
        "https://user:pass@github.com/octocat/Hello-World",  # embedded credentials
        "https://github.com:8443/octocat/Hello-World",  # non-standard port (SSRF port scan)
        "https://github.com/../etc/passwd",  # path traversal
        "https://github.com/octo\\cat/Hello-World",  # backslash
    ],
)
def test_github_rejects_ssrf_vectors(url):
    with pytest.raises(ValueError):
        GitHubSource().parse(url)


def test_owner_with_shell_metacharacters_is_rejected():
    with pytest.raises(ValueError):
        GitHubSource().parse("https://github.com/owner;rm -rf/repo")


def test_detect_source_rejects_unsupported_host():
    with pytest.raises(ValueError):
        detect_source("https://example.com/owner/repo")


def test_detect_source_routes_by_hostname():
    assert isinstance(detect_source("https://github.com/a/b"), GitHubSource)
    assert isinstance(detect_source("https://gitlab.com/a/b"), GitLabSource)
    assert isinstance(detect_source("https://bitbucket.org/a/b"), BitbucketSource)
