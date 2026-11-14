"""Clone cleanup (T43): clones go entirely, git's read-only files included, and the count is honest."""

import logging
import os
import stat
import time

import pytest

from rune import cloner


def _clone_folder(base, name: str, *, age_hours: float) -> str:
    """A clone as git leaves it: a working tree plus a read-only pack file under .git."""
    path = os.path.join(base, name)
    pack_dir = os.path.join(path, ".git", "objects", "pack")
    os.makedirs(pack_dir)
    with open(os.path.join(path, "README.md"), "w", encoding="utf-8") as f:
        f.write("# demo\n")
    pack = os.path.join(pack_dir, "pack-1.pack")
    with open(pack, "wb") as f:
        f.write(b"PACK")
    os.chmod(pack, stat.S_IREAD)  # git writes object and pack files read-only
    stamp = time.time() - age_hours * 3600
    os.utime(path, (stamp, stamp))
    return path


@pytest.fixture
def clone_base(tmp_path, monkeypatch):
    monkeypatch.setattr(cloner, "CLONE_BASE_DIR", str(tmp_path))
    return tmp_path


def test_an_old_clone_goes_entirely_read_only_git_files_included(clone_base, caplog):
    old = _clone_folder(clone_base, "demo_aaaaaaaaaaaa", age_hours=48)
    fresh = _clone_folder(clone_base, "demo_bbbbbbbbbbbb", age_hours=1)

    with caplog.at_level(logging.INFO, logger="rune.cloner"):
        cloner.cleanup_old_repos(max_age_hours=24)

    assert not os.path.exists(old)  # on Windows the old rmtree left .git behind
    assert os.path.isdir(fresh)
    assert "removed 1 old cloned repos" in caplog.text


def test_a_folder_that_survives_is_not_counted_as_removed(clone_base, monkeypatch, caplog):
    stuck = _clone_folder(clone_base, "demo_cccccccccccc", age_hours=48)
    monkeypatch.setattr(cloner.shutil, "rmtree", lambda *args, **kwargs: None)  # a delete that does nothing

    with caplog.at_level(logging.INFO, logger="rune.cloner"):
        cloner.cleanup_old_repos(max_age_hours=24)

    assert os.path.isdir(stuck)
    assert "removed" not in caplog.text.replace("could not be removed", "")
    assert "1 old cloned repos could not be removed" in caplog.text


def test_a_failed_delete_is_logged_and_the_rest_still_go(clone_base, monkeypatch, caplog):
    first = _clone_folder(clone_base, "demo_dddddddddddd", age_hours=48)
    second = _clone_folder(clone_base, "demo_eeeeeeeeeeee", age_hours=48)
    real_remove_tree = cloner.remove_tree

    def refuse_the_first(path):
        if path == first:
            raise PermissionError(13, "Access is denied", path)
        real_remove_tree(path)

    monkeypatch.setattr(cloner, "remove_tree", refuse_the_first)
    with caplog.at_level(logging.INFO, logger="rune.cloner"):
        cloner.cleanup_old_repos(max_age_hours=24)

    assert os.path.isdir(first) and not os.path.exists(second)
    assert f"could not remove {first}" in caplog.text
    assert "removed 1 old cloned repos" in caplog.text
    assert "1 old cloned repos could not be removed" in caplog.text
    os.chmod(os.path.join(first, ".git", "objects", "pack", "pack-1.pack"), stat.S_IWRITE)


def test_cleanup_repo_removes_read_only_git_files(clone_base):
    path = _clone_folder(clone_base, "demo_ffffffffffff", age_hours=0)

    cloner.cleanup_repo(path)

    assert not os.path.exists(path)


def test_remove_tree_still_raises_what_it_cannot_fix(tmp_path, monkeypatch):
    target = tmp_path / "x"
    target.mkdir()

    def broken_rmtree(path, onexc):
        onexc(os.scandir, path, FileNotFoundError(2, "gone", path))

    monkeypatch.setattr(cloner.shutil, "rmtree", broken_rmtree)
    with pytest.raises(FileNotFoundError):
        cloner.remove_tree(str(target))
