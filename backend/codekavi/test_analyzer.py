from codekavi.analyzer import _resolve_python_module


def test_suffix_fallback_resolves_when_unique():
    known_files = {"app/utils/config.py", "app/utils/other.py"}
    resolved = _resolve_python_module("config", repo_root="/repo", file_dir="/repo/app", known_files=known_files)
    assert resolved == "app/utils/config.py"


def test_suffix_fallback_none_when_ambiguous():
    known_files = {"src/config.py", "lib/config.py"}
    resolved = _resolve_python_module("config", repo_root="/repo", file_dir="/repo/app", known_files=known_files)
    assert resolved is None
