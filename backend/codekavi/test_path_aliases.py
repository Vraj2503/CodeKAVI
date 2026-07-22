"""@/ and ~/ style TS path aliases previously resolved to nothing, producing
zero edges for modern JS/TS repos. Verify tsconfig.json paths are honored and
that the repo-root containment check still rejects an alias escaping the repo."""

import json
import os
import tempfile

from codekavi.analyzer import _load_path_aliases, _resolve_js_path


def _write(path: str, content: str = "") -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def test_alias_import_resolves_via_tsconfig():
    with tempfile.TemporaryDirectory() as repo_root:
        _write(
            os.path.join(repo_root, "tsconfig.json"),
            json.dumps({"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["src/*"]}}}),
        )
        _write(os.path.join(repo_root, "src", "components", "Button.tsx"), "export default {}")

        aliases = _load_path_aliases(repo_root)
        assert aliases == {"@/": os.path.normpath(os.path.join(repo_root, "src"))}

        file_dir = os.path.join(repo_root, "src", "pages")
        resolved = _resolve_js_path("@/components/Button", file_dir, repo_root, known_files=None, path_aliases=aliases)
        assert resolved == "src/components/Button.tsx", resolved


def test_alias_cannot_escape_repo_root():
    with tempfile.TemporaryDirectory() as repo_root:
        aliases = {"@/": os.path.normpath("/etc")}
        resolved = _resolve_js_path("@/passwd", repo_root, repo_root, known_files=None, path_aliases=aliases)
        assert resolved is None


def test_no_aliases_falls_back_to_external_package():
    with tempfile.TemporaryDirectory() as repo_root:
        resolved = _resolve_js_path("react", repo_root, repo_root, known_files=None, path_aliases={})
        assert resolved is None


if __name__ == "__main__":
    test_alias_import_resolves_via_tsconfig()
    test_alias_cannot_escape_repo_root()
    test_no_aliases_falls_back_to_external_package()
    print("ok")
