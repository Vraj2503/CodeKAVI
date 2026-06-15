import pytest

from codekavi.cloner import cleanup_repo, clone_repo, parse_github_url
from codekavi.exceptions import CloneError


def test_parse_github_url_valid():
    """Verify that valid GitHub URLs are correctly parsed."""
    info = parse_github_url("https://github.com/vraj2503/CodeKAVI")
    assert info["owner"] == "vraj2503"
    assert info["repo"] == "CodeKAVI"
    assert info["clone_url"] == "https://github.com/vraj2503/CodeKAVI.git"


def test_parse_github_url_rejections():
    """Verify that parse_github_url rejects insecure or malformed inputs."""
    # HTTP scheme rejected
    with pytest.raises(ValueError, match="HTTPS"):
        parse_github_url("http://github.com/owner/repo")

    # Non-GitHub hostname rejected
    with pytest.raises(ValueError, match=r"github\.com"):
        parse_github_url("https://gitlab.com/owner/repo")

    # Embedded credentials rejected
    with pytest.raises(ValueError, match="credentials"):
        parse_github_url("https://user:password@github.com/owner/repo")

    # Custom port rejected
    with pytest.raises(ValueError, match="Custom ports"):
        parse_github_url("https://github.com:8080/owner/repo")

    # Path traversal rejected
    with pytest.raises(ValueError, match="Path traversal"):
        parse_github_url("https://github.com/owner/../repo")

    # Command injection chars in owner/repo rejected
    with pytest.raises(ValueError, match="Invalid owner or repository"):
        parse_github_url("https://github.com/owner;rm -rf/repo")


def test_clone_repo_raises_clone_error():
    """Verify that failures in cloning raise a CloneError."""
    with pytest.raises(CloneError):
        # Invalid repository name should fail cloning and raise CloneError
        clone_repo("https://github.com/nonexistent_owner_12345/nonexistent_repo_abcde")


def test_cleanup_repo_removes_dir(tmp_path):
    """Verify that cleanup_repo deletes the target directory."""
    temp_dir = tmp_path / "dummy_repo_123"
    temp_dir.mkdir()
    assert temp_dir.exists()

    cleanup_repo(str(temp_dir))
    assert not temp_dir.exists()
