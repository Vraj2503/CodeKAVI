"""T14/T15: an import edge carries the names it imports, so a view can say what crosses it."""

from rune.analyzer import analyze_dependencies
from rune.graph_assembler import _aggregate_edges
from rune.traverser import traverse_repo


def _graph(root, files: dict[str, str]):
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return analyze_dependencies(str(root), traverse_repo(str(root)).files)


def _edge(graph, source, target) -> dict:
    return next(e for e in graph.edges if (e["source"], e["target"]) == (source, target))


def test_a_python_from_import_names_what_it_takes(tmp_path):
    graph = _graph(
        tmp_path,
        {
            "app/__init__.py": "",
            "app/cloner.py": "def clone_repo(u):\n    return u\n\n\ndef parse_repo_url(u):\n    return u\n",
            "app/analyze.py": "from app.cloner import clone_repo, parse_repo_url as parse\nfrom app import cloner\n",
            "app/star.py": "from app.cloner import *\nimport app.cloner\n",
        },
    )

    assert _edge(graph, "app/analyze.py", "app/cloner.py")["specifiers"] == ["clone_repo", "parse_repo_url"]
    star_edges = [e for e in graph.edges if e["source"] == "app/star.py"]
    assert star_edges and all("specifiers" not in e for e in star_edges)  # `*` and plain imports name nothing


def test_a_js_import_names_its_default_named_and_namespace_bindings(tmp_path):
    graph = _graph(
        tmp_path,
        {
            "web/api.ts": "export const fetchRepo = 1;\nexport default function client() {}\n",
            "web/util.ts": "export const cn = 1;\n",
            "web/page.tsx": (
                'import client, { fetchRepo as load } from "./api";\n'
                'import * as util from "./util";\n'
                'import "./styles.css";\n'
            ),
            "web/styles.css": "body {}\n",
        },
    )

    assert _edge(graph, "web/page.tsx", "web/api.ts")["specifiers"] == ["client", "fetchRepo"]
    assert _edge(graph, "web/page.tsx", "web/util.ts")["specifiers"] == ["*"]


def test_the_graph_merges_the_names_on_a_file_edge():
    edges, _ = _aggregate_edges(
        [
            {"source": "a.py", "target": "b.py", "specifiers": ["run", "stop"]},
            {"source": "a.py", "target": "b.py", "specifiers": ["run", "Config"]},
            {"source": "a.py", "target": "c.py"},
        ],
        {},
        {},
    )
    by_pair = {(e["source"], e["target"]): e for e in edges if e["level"] == "file"}

    assert by_pair[("a.py", "b.py")]["specifiers"] == ["run", "stop", "Config"]
    assert "specifiers" not in by_pair[("a.py", "c.py")]
