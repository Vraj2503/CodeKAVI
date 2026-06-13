"""
analyzer.py — Multi-language import/dependency analyzer.

Parses source files using AST (Python) and regex (JS/TS/Go/Java/etc.)
to extract import relationships, build dependency graphs, and identify
key structural nodes (entry points, central files).

Supports:
  - Python:  import X / from X import Y / from .X import Y (relative)
  - JS/TS:   import ... from '...' / require('...') / dynamic import()
  - Go:      import "..." / import (...)
  - Java:    import ...; / package ...;
  - C/C++:   #include "..." / #include <...>
  - Ruby:    require '...' / require_relative '...'
  - PHP:     use ...; / include/require '...'
  - Rust:    use ...; / mod ...;
  - Jupyter: .ipynb code cell imports (parsed as Python)
"""

import ast
import json
import os
import re
from collections import defaultdict
from collections.abc import Callable
from typing import Any

try:
    from codekavi.config import EXTENSION_LANGUAGE_MAP, FILENAME_LANGUAGE_MAP, MAX_FILE_SIZE_BYTES, settings
except ModuleNotFoundError:
    from config import (  # type: ignore[no-redef]
        EXTENSION_LANGUAGE_MAP,
        FILENAME_LANGUAGE_MAP,
        MAX_FILE_SIZE_BYTES,
        settings,
    )

try:
    from codekavi.utils import BoundedContentCache
except ModuleNotFoundError:
    from utils import BoundedContentCache  # type: ignore[no-redef]


# ─────────────────────────────────────────────
# Language-specific import extractors
# ─────────────────────────────────────────────

def _extract_python_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """
    Use Python's AST to extract imports. Handles:
      - import foo
      - import foo.bar
      - from foo import bar
      - from .foo import bar  (relative)
      - from ..foo import bar (relative)
    """
    imports: list[dict[str, Any]] = []
    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        return imports

    file_dir = os.path.dirname(filepath)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                resolved = _resolve_python_module(alias.name, repo_root, file_dir, level=0)
                imports.append({
                    "raw": alias.name,
                    "resolved": resolved,
                    "line": node.lineno,
                    "type": "import",
                })

        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            level = node.level or 0
            resolved = _resolve_python_module(module, repo_root, file_dir, level=level)
            imports.append({
                "raw": f"{'.' * level}{module}" if module else '.' * level,
                "resolved": resolved,
                "line": node.lineno,
                "type": "from_import",
            })

    return imports


def _resolve_python_module(module_name: str, repo_root: str, file_dir: str, level: int = 0) -> str | None:
    """
    Resolve a Python module name to a file path relative to repo root.
    Returns the relative path if found, None otherwise.
    """
    if level > 0:
        # Relative import: go up `level` directories from file_dir
        base = file_dir
        for _ in range(level - 1):
            base = os.path.dirname(base)
        parts = module_name.split(".") if module_name else []
        candidate_base = os.path.join(base, *parts)
    else:
        # Absolute import
        parts = module_name.split(".")
        candidate_base = os.path.join(repo_root, *parts)

    # Check: package/__init__.py
    init_path = os.path.join(candidate_base, "__init__.py")
    if os.path.isfile(init_path):
        return os.path.relpath(init_path, repo_root)

    # Check: module.py
    py_path = candidate_base + ".py"
    if os.path.isfile(py_path):
        return os.path.relpath(py_path, repo_root)

    # Check: module (directory with __init__.py in subdir — already covered)
    if os.path.isdir(candidate_base):
        init = os.path.join(candidate_base, "__init__.py")
        if os.path.isfile(init):
            return os.path.relpath(init, repo_root)

    return None


def _extract_js_ts_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """
    Extract JS/TS imports using regex. Handles:
      - import ... from 'path'
      - import 'path'
      - const x = require('path')
      - import('path')
      - export ... from 'path'
    """
    imports: list[dict[str, Any]] = []
    file_dir = os.path.dirname(filepath)

    patterns = [
        # import ... from 'path' / import 'path'
        r"""(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]""",
        # require('path')
        r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""",
        # dynamic import('path')
        r"""import\s*\(\s*['"]([^'"]+)['"]\s*\)""",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, source):
            raw_path = match.group(1)
            line = source[:match.start()].count("\n") + 1

            resolved = _resolve_js_path(raw_path, file_dir, repo_root)
            imports.append({
                "raw": raw_path,
                "resolved": resolved,
                "line": line,
                "type": "import",
            })

    return imports


def _resolve_js_path(import_path: str, file_dir: str, repo_root: str) -> str | None:
    """Resolve a JS/TS import path to a file relative to repo root."""
    # Skip node_modules / bare specifiers
    if not import_path.startswith(".") and not import_path.startswith("/"):
        return None  # external package

    if import_path.startswith("/"):
        base = repo_root
        import_path = import_path[1:]
    else:
        base = file_dir

    candidate = os.path.normpath(os.path.join(base, import_path))

    # Try exact, then with extensions
    js_extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".vue", ".svelte"]

    # Exact match
    if os.path.isfile(candidate):
        return os.path.relpath(candidate, repo_root)

    # Try adding extensions
    for ext in js_extensions:
        if os.path.isfile(candidate + ext):
            return os.path.relpath(candidate + ext, repo_root)

    # Try index files
    for ext in js_extensions:
        index_path = os.path.join(candidate, f"index{ext}")
        if os.path.isfile(index_path):
            return os.path.relpath(index_path, repo_root)

    return None


def _extract_go_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract Go imports."""
    imports: list[dict[str, Any]] = []

    # Single import: import "path"
    for match in re.finditer(r'import\s+"([^"]+)"', source):
        line = source[:match.start()].count("\n") + 1
        imports.append({"raw": match.group(1), "resolved": None, "line": line, "type": "import"})

    # Grouped import: import ( "path1" \n "path2" )
    for block in re.finditer(r'import\s*\(([\s\S]*?)\)', source):
        block_start = source[:block.start()].count("\n") + 1
        for i, line_match in enumerate(re.finditer(r'"([^"]+)"', block.group(1))):
            imports.append({
                "raw": line_match.group(1),
                "resolved": None,
                "line": block_start + i,
                "type": "import",
            })

    return imports


def _extract_java_imports(source: str, repo_root: str) -> list[dict]:
    """Extract Java/Kotlin imports."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r'import\s+([\w.]+(?:\.\*)?)\s*;', source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        # Try to resolve to a file
        parts = raw.replace(".*", "").split(".")
        candidate = os.path.join(repo_root, *parts) + ".java"
        resolved = os.path.relpath(candidate, repo_root) if os.path.isfile(candidate) else None
        imports.append({"raw": raw, "resolved": resolved, "line": line, "type": "import"})
    return imports


def _extract_c_cpp_includes(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract C/C++ #include directives."""
    imports: list[dict[str, Any]] = []
    file_dir = os.path.dirname(filepath)

    for match in re.finditer(r'#\s*include\s*[<"]([^>"]+)[>"]', source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        # Only resolve local includes (quoted), not system includes (angled)
        full_match = match.group(0)
        if '"' in full_match:
            candidate = os.path.normpath(os.path.join(file_dir, raw))
            resolved = os.path.relpath(candidate, repo_root) if os.path.isfile(candidate) else None
        else:
            resolved = None
        imports.append({"raw": raw, "resolved": resolved, "line": line, "type": "include"})
    return imports


def _extract_ruby_requires(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract Ruby require/require_relative."""
    imports: list[dict[str, Any]] = []
    file_dir = os.path.dirname(filepath)

    for match in re.finditer(r"""require_relative\s+['"]([^'"]+)['"]""", source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        candidate = os.path.normpath(os.path.join(file_dir, raw))
        for ext in ["", ".rb"]:
            if os.path.isfile(candidate + ext):
                imports.append({"raw": raw, "resolved": os.path.relpath(candidate + ext, repo_root), "line": line, "type": "require_relative"})
                break
        else:
            imports.append({"raw": raw, "resolved": None, "line": line, "type": "require_relative"})

    for match in re.finditer(r"""(?<!_)require\s+['"]([^'"]+)['"]""", source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "require"})

    return imports


def _extract_rust_uses(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract Rust use/mod declarations."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r'(?:use|mod)\s+([\w:]+)', source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "use"})
    return imports


def _extract_php_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract PHP use/include/require statements."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r"""(?:include|include_once|require|require_once)\s+['"]([^'"]+)['"]""", source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        file_dir = os.path.dirname(filepath)
        candidate = os.path.normpath(os.path.join(file_dir, raw))
        resolved = os.path.relpath(candidate, repo_root) if os.path.isfile(candidate) else None
        imports.append({"raw": raw, "resolved": resolved, "line": line, "type": "include"})

    for match in re.finditer(r'use\s+([\w\\]+)', source):
        raw = match.group(1)
        line = source[:match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "use"})
    return imports


def _extract_ipynb_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """
    Extract imports from Jupyter Notebook (.ipynb) files.

    Parses the JSON structure, extracts code cells, and runs
    Python AST-based import extraction on each cell's source.
    Tracks cell index in the 'line' field (cell_1, cell_2, ...).
    """
    imports: list[dict[str, Any]] = []

    try:
        notebook = json.loads(source)
    except (json.JSONDecodeError, ValueError):
        return imports

    cells = notebook.get("cells", [])

    # Detect notebook language (default to Python)
    kernel_lang = (
        notebook.get("metadata", {})
        .get("kernelspec", {})
        .get("language", "python")
        .lower()
    )

    if kernel_lang != "python":
        return imports  # Only Python notebooks supported for now

    for cell_idx, cell in enumerate(cells, start=1):
        if cell.get("cell_type") != "code":
            continue

        # Source can be a list of lines or a single string
        cell_source = cell.get("source", [])
        if isinstance(cell_source, list):
            cell_source = "".join(cell_source)

        if not cell_source.strip():
            continue

        # Run Python import extraction on the cell
        cell_imports = _extract_python_imports(filepath, cell_source, repo_root)

        # Tag each import with the cell number for traceability
        for imp in cell_imports:
            imp["line"] = cell_idx  # cell index instead of line number
            imp["type"] = f"notebook_{imp['type']}"  # e.g. notebook_import
            imports.append(imp)

    return imports


# ─────────────────────────────────────────────
# Language dispatcher
# ─────────────────────────────────────────────

# Map language names to extractor functions
_EXTRACTORS: dict[str, Callable[..., Any]] = {
    "Python":               _extract_python_imports,
    "JavaScript":           _extract_js_ts_imports,
    "JavaScript (React)":   _extract_js_ts_imports,
    "TypeScript":           _extract_js_ts_imports,
    "TypeScript (React)":   _extract_js_ts_imports,
    "Vue":                  _extract_js_ts_imports,
    "Svelte":               _extract_js_ts_imports,
    "Go":                   _extract_go_imports,
    "Java":                 _extract_java_imports,
    "Kotlin":               _extract_java_imports,
    "C":                    _extract_c_cpp_includes,
    "C++":                  _extract_c_cpp_includes,
    "C/C++ Header":         _extract_c_cpp_includes,
    "C++ Header":           _extract_c_cpp_includes,
    "Ruby":                 _extract_ruby_requires,
    "Rust":                 _extract_rust_uses,
    "PHP":                  _extract_php_imports,
    "Jupyter Notebook":     _extract_ipynb_imports,
}


def _detect_language(filepath: str) -> str:
    """Detect language from filename or extension."""
    basename = os.path.basename(filepath)
    if basename in FILENAME_LANGUAGE_MAP:
        return FILENAME_LANGUAGE_MAP[basename]
    _, ext = os.path.splitext(basename)
    return EXTENSION_LANGUAGE_MAP.get(ext.lower(), "Unknown")


# ─────────────────────────────────────────────
# Core: Build dependency graph
# ─────────────────────────────────────────────

def analyze_dependencies(
    repo_root: str,
    file_list: list[dict],
    content_cache: BoundedContentCache | None = None,
) -> dict:
    """
    Analyze all files in the repo and build a full dependency graph.

    Args:
        repo_root: Absolute path to the cloned repo root.
        file_list: Flat list of file dicts from traverser (each has 'path', 'language').

    Returns:
        dict with:
          - edges:              list of { source, target, raw, line, type }
          - adjacency:          dict[file] -> [files it imports]
          - reverse_adjacency:  dict[file] -> [files that import it]
          - file_imports:       dict[file] -> [raw import details per file]
          - entry_points:       list of detected entry point files
          - central_files:      list of { file, in_degree, out_degree, score }
          - stats:              { total_edges, resolved_edges, unresolved_edges }
    """
    # All file paths in the repo (relative)
    known_files = {f["path"] for f in file_list}

    edges: list[dict[str, Any]] = []                                   # { source, target, ... }
    adjacency: dict[str, set] = defaultdict(set)           # file -> imports
    reverse_adjacency: dict[str, set] = defaultdict(set)   # file -> imported_by
    file_imports: dict[str, list] = defaultdict(list)       # file -> raw import list

    # Content cache: read each file ONCE, reuse in classifier + entry point detection
    local_cache = False
    if content_cache is None:
        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
        local_cache = True

    resolved_count = 0
    unresolved_count = 0

    for file_info in file_list:
        rel_path = file_info["path"]
        language = file_info["language"]
        abs_path = os.path.join(repo_root, rel_path)

        extractor = _EXTRACTORS.get(language)
        if not extractor:
            continue

        # Read file ONCE and cache
        try:
            file_size = os.path.getsize(abs_path)
            if file_size > MAX_FILE_SIZE_BYTES:
                continue
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                source = f.read()
            content_cache[rel_path] = source[:4096]
        except (OSError, UnicodeDecodeError):
            continue

        # Extract imports
        imports = extractor(abs_path, source, repo_root)
        file_imports[rel_path] = imports

        for imp in imports:
            target = imp["resolved"]
            if target and target in known_files and target != rel_path:
                edges.append({
                    "source": rel_path,
                    "target": target,
                    "raw": imp["raw"],
                    "line": imp["line"],
                    "type": imp["type"],
                })
                adjacency[rel_path].add(target)
                reverse_adjacency[target].add(rel_path)
                resolved_count += 1
            else:
                unresolved_count += 1

    # ── Detect entry points (using content_cache to avoid re-reading files) ──
    entry_points = _detect_entry_points(repo_root, known_files, adjacency, reverse_adjacency, content_cache)

    # ── Find central/important files ──
    central_files = _find_central_files(known_files, adjacency, reverse_adjacency)

    if local_cache:
        content_cache.clear()
        del content_cache

    return {
        "edges": edges,
        "adjacency": {k: sorted(v) for k, v in adjacency.items()},
        "reverse_adjacency": {k: sorted(v) for k, v in reverse_adjacency.items()},
        "file_imports": {k: v for k, v in file_imports.items() if v},
        "entry_points": entry_points,
        "central_files": central_files,
        "stats": {
            "total_edges": resolved_count + unresolved_count,
            "resolved_edges": resolved_count,
            "unresolved_edges": unresolved_count,
        },
    }


# ─────────────────────────────────────────────
# Intelligence: entry point detection
# ─────────────────────────────────────────────

# Common entry point filenames (basename patterns)
_ENTRY_POINT_NAMES = {
    # Python
    "main.py", "app.py", "manage.py", "wsgi.py", "asgi.py",
    "server.py", "run.py", "cli.py", "__main__.py",
    # JavaScript / TypeScript
    "index.js", "index.ts", "index.mjs", "main.js", "main.ts",
    "app.js", "app.ts", "server.js", "server.ts",
    # Go
    "main.go", "cmd.go",
    # Java
    "Main.java", "App.java", "Application.java",
    # Rust
    "main.rs", "lib.rs",
    # Ruby
    "app.rb", "config.ru", "Rakefile",
    # PHP
    "index.php", "artisan",
    # C/C++
    "main.c", "main.cpp",
}

# Config/build files that signal project structure
_CONFIG_ENTRY_NAMES = {
    "package.json", "setup.py", "pyproject.toml", "Cargo.toml",
    "go.mod", "pom.xml", "build.gradle", "Makefile", "Dockerfile",
    "docker-compose.yml", "docker-compose.yaml",
}


def _detect_entry_points(
    repo_root: str,
    known_files: set[str],
    adjacency: dict[str, set],
    reverse_adjacency: dict[str, set],
    content_cache: dict[str, str] | BoundedContentCache | None = None,
) -> list[dict]:
    """
    Detect likely entry point files using heuristics:
      1. Filename matches common entry point patterns
      2. Has 'if __name__' guard (Python)  /  main() function
      3. Graph-based: files that import others but are not imported themselves
    """
    entry_points = []
    scored: dict[str, dict] = {}

    # Extensions that are actual source code (not docs/config)
    source_extensions = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
        ".go", ".java", ".kt", ".rs", ".rb", ".php",
        ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
        ".scala", ".dart", ".ex", ".exs", ".vue", ".svelte",
    }

    for fpath in known_files:
        basename = os.path.basename(fpath)
        _, ext = os.path.splitext(basename)
        is_source = ext.lower() in source_extensions
        score = 0
        reasons = []

        # ── Heuristic 1: filename ──
        if basename in _ENTRY_POINT_NAMES:
            score += 3
            reasons.append("entry_point_name")

        if basename in _CONFIG_ENTRY_NAMES:
            score += 1
            reasons.append("config_file")

        # ── Heuristic 2: content-based (source code files only) ──
        if is_source:
            # Use content_cache if available, otherwise read from disk
            if content_cache and fpath in content_cache:
                content = content_cache[fpath][:4096]
            else:
                abs_path = os.path.join(repo_root, fpath)
                try:
                    with open(abs_path, encoding="utf-8", errors="ignore") as f:
                        content = f.read(4096)
                except OSError:
                    content = ""

            if 'if __name__' in content and '__main__' in content:
                score += 4
                reasons.append("has_main_guard")
            if re.search(r'def\s+main\s*\(', content):
                score += 2
                reasons.append("has_main_function")
            if re.search(r'func\s+main\s*\(', content):  # Go
                score += 4
                reasons.append("has_main_function")
            if re.search(r'public\s+static\s+void\s+main', content):  # Java
                score += 4
                reasons.append("has_main_method")
            if re.search(r'app\.listen\s*\(', content) or re.search(r'createServer\s*\(', content):  # Node.js
                score += 3
                reasons.append("starts_server")
            if re.search(r'\.run\s*\(', content) and ('Flask' in content or 'FastAPI' in content or 'uvicorn' in content):
                score += 3
                reasons.append("starts_server")

        # ── Heuristic 3: graph topology ──
        # Files that import others but nobody imports them = likely entry points
        out_degree = len(adjacency.get(fpath, set()))
        in_degree = len(reverse_adjacency.get(fpath, set()))

        if out_degree > 0 and in_degree == 0:
            score += 2
            reasons.append("graph_source_node")

        # Root-level files are more likely entry points
        depth = fpath.count(os.sep)
        if depth == 0 and is_source:
            score += 1
            reasons.append("root_level")

        if score >= 3:
            scored[fpath] = {
                "file": fpath,
                "score": score,
                "reasons": reasons,
            }

    # Sort by score descending
    entry_points = sorted(scored.values(), key=lambda x: x["score"], reverse=True)
    return entry_points


# ─────────────────────────────────────────────
# Intelligence: find central / important files
# ─────────────────────────────────────────────

def _find_central_files(
    known_files: set[str],
    adjacency: dict[str, set],
    reverse_adjacency: dict[str, set],
) -> list[dict]:
    """
    Score every file by centrality:
      - in_degree:  how many files import this file (high = important utility)
      - out_degree: how many files this file imports (high = orchestrator)
      - score:      weighted combination → most "central" nodes

    Returns top files sorted by score.
    """
    file_scores: list[dict[str, Any]] = []

    for fpath in known_files:
        in_deg = len(reverse_adjacency.get(fpath, set()))
        out_deg = len(adjacency.get(fpath, set()))

        # Skip files with no connections
        if in_deg == 0 and out_deg == 0:
            continue

        # Weighted score:  in_degree matters more (being depended on = important)
        score = (in_deg * 3) + (out_deg * 1)

        file_scores.append({
            "file": fpath,
            "in_degree": in_deg,
            "out_degree": out_deg,
            "score": score,
            "role": _classify_role(in_deg, out_deg),
        })

    # Sort by score, return top results
    file_scores.sort(key=lambda x: x["score"], reverse=True)
    return file_scores[:30]  # Top 30 most central files


def _classify_role(in_deg: int, out_deg: int) -> str:
    """Classify a file's role based on its dependency graph position."""
    if in_deg == 0 and out_deg > 0:
        return "entry_point"        # Imports others, not imported itself
    elif in_deg > 0 and out_deg == 0:
        return "leaf_utility"       # Imported by others, imports nothing
    elif in_deg >= 3 and out_deg >= 1:
        return "core_module"        # Heavily depended on, also imports
    elif in_deg > out_deg:
        return "utility"            # More imported than importing
    elif out_deg > in_deg:
        return "orchestrator"       # Imports more than it's imported
    else:
        return "connector"          # Equal in/out — bridges modules


#Testing
if __name__ == "__main__":
    notebook_path = "/Applications/Projects/CodeKavi/test/test.ipynb"
    with open(notebook_path) as f:
        notebook_content = f.read()
    imports = _extract_ipynb_imports(notebook_path, notebook_content, "/Applications/Projects/CodeKavi")
    print(imports)
