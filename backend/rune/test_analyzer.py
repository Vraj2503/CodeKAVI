import json
import os

from rune.analyzer import (
    PathAliases,
    _AliasRule,
    _resolve_js_path,
    _resolve_python_module,
    _strip_jsonc,
    analyze_dependencies,
)
from rune.traverser import traverse_repo


def test_suffix_fallback_resolves_when_unique():
    known_files = {"app/utils/config.py", "app/utils/other.py"}
    resolved = _resolve_python_module("config", repo_root="/repo", file_dir="/repo/app", known_files=known_files)
    assert resolved == "app/utils/config.py"


def test_suffix_fallback_none_when_ambiguous():
    known_files = {"src/config.py", "lib/config.py"}
    resolved = _resolve_python_module("config", repo_root="/repo", file_dir="/repo/app", known_files=known_files)
    assert resolved is None


# ── tsconfig / jsconfig path aliases (T29) ──


def _edges(root, files: dict[str, str]) -> set[tuple[str, str]]:
    """Write `files` under `root`, run the real traverser and analyzer, return (source, target) edges."""
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    data = traverse_repo(str(root))
    graph = analyze_dependencies(str(root), data.files)
    return {(edge["source"], edge["target"]) for edge in graph.edges}


def _config(paths: dict | None = None, **options) -> str:
    compiler = dict(options)
    if paths is not None:
        compiler["paths"] = paths
    return json.dumps({"compilerOptions": compiler})


def test_an_app_in_a_subfolder_resolves_its_own_aliases(tmp_path):
    # CodeKAVI's shape: no root config; frontend/tsconfig.json maps "@/*" with no baseUrl,
    # so targets resolve from frontend/. 0 of its 278 "@/" imports resolved before.
    edges = _edges(
        tmp_path,
        {
            "frontend/tsconfig.json": _config({"@/*": ["./*"]}),
            "frontend/app/page.tsx": 'import { api } from "@/lib/api";\nimport Button from "@/components/Button";\n',
            "frontend/lib/api.ts": "export const api = 1;\n",
            "frontend/components/Button.tsx": "export default function Button() { return null; }\n",
        },
    )
    assert ("frontend/app/page.tsx", "frontend/lib/api.ts") in edges
    assert ("frontend/app/page.tsx", "frontend/components/Button.tsx") in edges


def test_two_apps_with_different_maps_each_resolve_into_their_own_tree(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "apps/web/tsconfig.json": _config({"@/*": ["./src/*"]}),
            "apps/web/src/main.ts": 'import { x } from "@/x";\n',
            "apps/web/src/x.ts": "export const x = 1;\n",
            "apps/admin/tsconfig.json": _config({"@/*": ["./lib/*"]}),
            "apps/admin/lib/main.ts": 'import { x } from "@/x";\n',
            "apps/admin/lib/x.ts": "export const x = 2;\n",
        },
    )
    assert ("apps/web/src/main.ts", "apps/web/src/x.ts") in edges
    assert ("apps/admin/lib/main.ts", "apps/admin/lib/x.ts") in edges
    assert ("apps/web/src/main.ts", "apps/admin/lib/x.ts") not in edges


def test_a_root_config_works_as_it_did(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "tsconfig.json": _config({"@/*": ["src/*"]}, baseUrl="."),
            "src/a.ts": 'import { b } from "@/b";\n',
            "src/b.ts": "export const b = 1;\n",
        },
    )
    assert ("src/a.ts", "src/b.ts") in edges


def test_an_exact_pattern_beats_wildcards_and_the_longest_prefix_wins(tmp_path):
    edges = _edges(
        tmp_path,
        {
            # "@/*" is listed first; TypeScript still picks "@/ui/*" for "@/ui/Button".
            "tsconfig.json": _config(
                {"@/*": ["src/*"], "@/ui/*": ["packages/ui/src/*"], "config": ["src/config/index.ts"]}, baseUrl="."
            ),
            "src/main.ts": (
                'import Button from "@/ui/Button";\nimport config from "config";\nimport other from "config-utils";\n'
            ),
            "src/ui/Button.tsx": "export default 1;\n",
            "packages/ui/src/Button.tsx": "export default 2;\n",
            "src/config/index.ts": "export default {};\n",
        },
    )
    assert ("src/main.ts", "packages/ui/src/Button.tsx") in edges
    assert ("src/main.ts", "src/ui/Button.tsx") not in edges
    assert ("src/main.ts", "src/config/index.ts") in edges
    assert not any(target.startswith("config-utils") for _, target in edges)  # an exact pattern is not a prefix


def test_later_targets_are_tried_when_the_first_has_no_such_file(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "tsconfig.json": _config({"@/*": ["src/*", "generated/*"]}, baseUrl="."),
            "src/main.ts": 'import { T } from "@/types";\n',
            "generated/types.ts": "export type T = 1;\n",
        },
    )
    assert ("src/main.ts", "generated/types.ts") in edges


def test_aliases_follow_extends_and_resolve_from_the_config_that_sets_baseurl(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "tsconfig.base.json": _config({"@shared/*": ["packages/shared/src/*"]}, baseUrl="."),
            "packages/app/tsconfig.json": json.dumps({"extends": "../../tsconfig.base.json"}),
            "packages/app/src/main.ts": 'import { util } from "@shared/util";\n',
            "packages/shared/src/util.ts": "export const util = 1;\n",
        },
    )
    assert ("packages/app/src/main.ts", "packages/shared/src/util.ts") in edges


def test_a_config_with_comments_urls_and_trailing_commas_still_parses(tmp_path):
    # The old regex read the "//" in the $schema URL as a comment, broke the JSON and
    # dropped every alias without a word.
    config = """{
  "$schema": "https://json.schemastore.org/tsconfig", // where the schema lives
  /* block comment */
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"], },
  },
}"""
    edges = _edges(
        tmp_path,
        {"tsconfig.json": config, "src/a.ts": 'import { b } from "@/b";\n', "src/b.ts": "export const b = 1;\n"},
    )
    assert ("src/a.ts", "src/b.ts") in edges


def test_strip_jsonc_leaves_strings_alone():
    text = '{"a": "x//y", "b": "/* not a comment */", "c": "q\\"//", "d": [1, 2, /* c */ ], }'
    assert json.loads(_strip_jsonc(text)) == {"a": "x//y", "b": "/* not a comment */", "c": 'q"//', "d": [1, 2]}


def test_a_baseurl_alone_resolves_bare_imports_under_it(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "tsconfig.json": _config(baseUrl="src"),
            "src/main.ts": 'import Button from "components/Button";\nimport React from "react";\n',
            "src/components/Button.tsx": "export default 1;\n",
        },
    )
    assert edges == {("src/main.ts", "src/components/Button.tsx")}  # "react" stays an external package


def test_the_nearest_config_wins_even_without_paths(tmp_path):
    # TypeScript gives a file the project of its nearest tsconfig; tools/ has none of the root's aliases.
    edges = _edges(
        tmp_path,
        {
            "tsconfig.json": _config({"@/*": ["src/*"]}, baseUrl="."),
            "tools/tsconfig.json": _config(),
            "tools/build.ts": 'import { b } from "@/b";\n',
            "src/b.ts": "export const b = 1;\n",
        },
    )
    assert ("tools/build.ts", "src/b.ts") not in edges


def test_a_config_outside_the_repo_is_never_read(tmp_path):
    # If the outside config were read, its alias would point back into the repo and make an edge.
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "tsconfig.json").write_text(_config({"@x/*": ["src/*"]}, baseUrl="../repo"), encoding="utf-8")
    edges = _edges(
        tmp_path / "repo",
        {
            "tsconfig.json": json.dumps({"extends": "../outside/tsconfig.json"}),
            "src/main.ts": 'import { y } from "@x/y";\n',
            "src/y.ts": "export const y = 1;\n",
        },
    )
    assert ("src/main.ts", "src/y.ts") not in edges


def test_an_alias_target_outside_the_repo_never_resolves(tmp_path):
    # Without the tracked-file list (known_files=None) the file below exists on disk, so only
    # the containment checks stand between an alias and a file outside the clone.
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.ts").write_text("export const s = 1;\n", encoding="utf-8")
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    rule = _AliasRule(prefix="@up/", suffix="", wildcard=True, targets=(os.path.join(str(repo), "../outside/*"),))
    aliases = PathAliases(rules=(rule,))
    assert _resolve_js_path("@up/secret", str(repo / "src"), str(repo), path_aliases=aliases) is None
    assert _resolve_js_path("../../outside/secret", str(repo / "src"), str(repo)) is None


def test_a_vue_component_resolves_aliases_too(tmp_path):
    edges = _edges(
        tmp_path,
        {
            "jsconfig.json": _config({"@/*": ["./src/*"]}),
            "src/App.vue": '<template><X /></template>\n<script setup>\nimport X from "@/components/X.vue";\n</script>\n',
            "src/components/X.vue": "<template><p /></template>\n",
        },
    )
    assert ("src/App.vue", "src/components/X.vue") in edges
