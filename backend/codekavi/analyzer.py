"""
analyzer.py — Multi-language import/dependency analyzer.

Parses source files using AST (Python), Tree-sitter (JS/TS), and regex (Go/Java/etc.)
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
import threading
from collections import defaultdict
from collections.abc import Callable
from typing import Any

import tree_sitter_javascript as tsjs
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser, Query

from codekavi.pipeline_models import DepGraph, FileEntry
from codekavi.utils import BoundedContentCache

# Languages are immutable and safe to share across threads.
JS_LANGUAGE = Language(tsjs.language(), "javascript")
TS_LANGUAGE = Language(tsts.language_typescript(), "typescript")

_JS_TS_QUERY_STR = """
    (import_statement source: (string (string_fragment) @path))
    (export_statement source: (string (string_fragment) @path))
    (call_expression
        function: (identifier) @fname
        arguments: (arguments (string (string_fragment) @path))
        (#eq? @fname "require"))
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @path)))
"""

# Tree-sitter 0.21 Parser and Query objects mutate internal state on
# parse()/captures() and are not safe to share across threads. FastAPI runs
# analyze_dependencies() in a thread pool, so each worker thread gets its own
# lazily-built Parser+Query pair (below), reused across every file it handles
# instead of paying ~40ms to allocate a fresh Parser() per file.
_thread_local = threading.local()


def _get_js_ts_parser_and_query(is_ts: bool) -> tuple[Parser, Query]:
    """Return the current thread's (Parser, Query) pair for JS or TS, building it once."""
    cache = getattr(_thread_local, "js_ts_parsers", None)
    if cache is None:
        cache = {}
        _thread_local.js_ts_parsers = cache

    key = "ts" if is_ts else "js"
    pair = cache.get(key)
    if pair is None:
        language = TS_LANGUAGE if is_ts else JS_LANGUAGE
        parser = Parser()
        parser.set_language(language)
        query = language.query(_JS_TS_QUERY_STR)
        pair = (parser, query)
        cache[key] = pair
    return pair


try:
    from codekavi.config import (
        EXTENSION_LANGUAGE_MAP,
        FILENAME_LANGUAGE_MAP,
        MAX_FILE_SIZE_BYTES,
        MAX_NOTEBOOK_SIZE_BYTES,
    )
    from codekavi.settings import settings
except ModuleNotFoundError:
    from config import (  # type: ignore[no-redef]
        EXTENSION_LANGUAGE_MAP,
        FILENAME_LANGUAGE_MAP,
        MAX_FILE_SIZE_BYTES,
        MAX_NOTEBOOK_SIZE_BYTES,
    )
    from settings import settings  # type: ignore[no-redef]


# ─────────────────────────────────────────────
# Language-specific import extractors
# ─────────────────────────────────────────────


def _extract_python_imports(
    filepath: str, source: str, repo_root: str, known_files: set[str] | None = None
) -> list[dict]:
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
                resolved = _resolve_python_module(alias.name, repo_root, file_dir, level=0, known_files=known_files)
                imports.append(
                    {
                        "raw": alias.name,
                        "resolved": resolved,
                        "line": node.lineno,
                        "type": "import",
                    }
                )

        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            level = node.level or 0
            resolved = _resolve_python_module(module, repo_root, file_dir, level=level, known_files=known_files)
            imports.append(
                {
                    "raw": f"{'.' * level}{module}" if module else "." * level,
                    "resolved": resolved,
                    "line": node.lineno,
                    "type": "from_import",
                }
            )

    return imports


def _resolve_python_module(
    module_name: str, repo_root: str, file_dir: str, level: int = 0, known_files: set[str] | None = None
) -> str | None:
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

    def _exists(path: str) -> bool:
        rel = os.path.relpath(path, repo_root).replace("\\", "/")
        if known_files is not None:
            return rel in known_files
        return os.path.isfile(path)

    # Check: package/__init__.py
    init_path = os.path.join(candidate_base, "__init__.py")
    if _exists(init_path):
        return os.path.relpath(init_path, repo_root).replace("\\", "/")

    # Check: module.py
    py_path = candidate_base + ".py"
    if _exists(py_path):
        return os.path.relpath(py_path, repo_root).replace("\\", "/")

    # Check: module (directory with __init__.py)
    # Guard the isdir call: if known_files is set we can infer a directory
    # exists by checking if any known file starts with the candidate prefix.
    is_dir = False
    if known_files is not None:
        prefix = os.path.relpath(candidate_base, repo_root).replace("\\", "/") + "/"
        is_dir = any(p.startswith(prefix) for p in known_files)
    else:
        is_dir = os.path.isdir(candidate_base)

    if is_dir:
        init = os.path.join(candidate_base, "__init__.py")
        if _exists(init):
            return os.path.relpath(init, repo_root).replace("\\", "/")

    # Fallback: absolute import under a non-root package (src/ layout, monorepo).
    # Only applies when direct repo_root-anchored resolution misses, so
    # well-structured repos keep their exact current behavior.
    if level == 0 and known_files is not None and parts:
        rel_base = "/".join(parts)
        suffixes = (f"{rel_base}.py", f"{rel_base}/__init__.py")
        matches = [kf for kf in known_files if any(kf == suffix or kf.endswith("/" + suffix) for suffix in suffixes)]
        if matches:
            return sorted(matches, key=lambda p: (p.count("/"), len(p)))[0]

    return None


def _extract_vue_svelte_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """
    Extract imports from Vue (.vue) and Svelte (.svelte) single-file components.

    The raw file contains <template> and <style> blocks which are NOT valid
    JavaScript — feeding those directly to a JS tree-sitter parser produces
    an error tree and zero imports. To handle these correctly:
      1. Extract the content of EVERY <script> ...</script> block. Vue 3 SFCs
         commonly ship both a plain <script> (e.g. for `defineComponent`
         options) and a <script setup> block — using only the first (M-18)
         silently drops imports declared in the second.
      2. Concatenate all script bodies into one source before parsing. If ANY
         block declares lang="ts" (or "typescript"), parse the combined
         source as TypeScript; otherwise use JavaScript.
      3. If no <script> block is found, fall back to passing the raw source
         to the JS parser (some .vue/.svelte files are pure JS/component-syntax
         with inline scripts).
    """
    script_matches = list(re.finditer(r"<script\b([^>]*)>(.*?)</script>", source, re.DOTALL | re.IGNORECASE))

    if script_matches:
        is_ts = False
        bodies = []
        for m in script_matches:
            attrs = m.group(1).lower()
            bodies.append(m.group(2))
            if ('lang="ts"' in attrs) or ("lang='ts'" in attrs) or ('lang="typescript"' in attrs):
                is_ts = True
        combined_body = "\n".join(bodies)
        return _extract_js_ts_imports_with_source(filepath, combined_body, repo_root, is_ts=is_ts)

    # No <script> block — fall back to parsing raw source as JS
    return _extract_js_ts_imports_with_source(filepath, source, repo_root, is_ts=False)


def _extract_js_ts_imports(
    filepath: str,
    source: str,
    repo_root: str,
    known_files: set[str] | None = None,
    raw_imports_cache: list[dict] | None = None,
) -> list[dict]:
    """
    Extract JS/TS imports using tree-sitter AST. Handles:
      - import ... from 'path'
      - import 'path'
      - const x = require('path')
      - import('path')
      - export ... from 'path'

    Thread-safety: reuses a per-thread Parser()/Query() pair (see
    _get_js_ts_parser_and_query) so concurrent /analyze requests don't race
    on shared tree-sitter state, without paying the allocation cost per file.
    """
    is_ts = filepath.endswith(".ts") or filepath.endswith(".tsx")
    return _extract_js_ts_imports_with_source(
        filepath, source, repo_root, is_ts=is_ts, known_files=known_files, raw_imports_cache=raw_imports_cache
    )


def _extract_js_ts_imports_with_source(
    filepath: str,
    source: str,
    repo_root: str,
    is_ts: bool,
    known_files: set[str] | None = None,
    raw_imports_cache: list[dict] | None = None,
) -> list[dict]:
    """Shared JS/TS extraction that picks the right language and a pooled per-thread Parser."""
    imports: list[dict[str, Any]] = []
    file_dir = os.path.dirname(filepath)

    if raw_imports_cache is not None:
        for item in raw_imports_cache:
            raw_path = item["raw"]
            line = item["line"]
            resolved = _resolve_js_path(raw_path, file_dir, repo_root, known_files=known_files)
            imports.append(
                {
                    "raw": raw_path,
                    "resolved": resolved,
                    "line": line,
                    "type": "import",
                }
            )
        return imports

    parser, query = _get_js_ts_parser_and_query(is_ts)

    source_bytes = source.encode("utf-8", errors="ignore")
    tree = parser.parse(source_bytes)
    captures = query.captures(tree.root_node)

    # captures can be a list of tuples in recent tree-sitter bindings
    if isinstance(captures, list):
        for node, name in captures:
            if name == "path":
                raw_path = node.text.decode("utf-8", errors="ignore")
                line = node.start_point[0] + 1
                resolved = _resolve_js_path(raw_path, file_dir, repo_root, known_files=known_files)
                imports.append(
                    {
                        "raw": raw_path,
                        "resolved": resolved,
                        "line": line,
                        "type": "import",
                    }
                )
    else:
        for name, nodes in captures.items():
            if name != "path":
                continue
            for node in nodes:
                raw_path = node.text.decode("utf-8", errors="ignore")
                line = node.start_point[0] + 1
                resolved = _resolve_js_path(raw_path, file_dir, repo_root, known_files=known_files)
                imports.append(
                    {
                        "raw": raw_path,
                        "resolved": resolved,
                        "line": line,
                        "type": "import",
                    }
                )

    return imports


def _resolve_js_path(
    import_path: str, file_dir: str, repo_root: str, known_files: set[str] | None = None
) -> str | None:
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

    # Reject imports that resolve outside the repo root (e.g. `../../../../etc/passwd`)
    # to prevent arbitrary-file-read into embeddings and chat history.
    real_repo_root = os.path.realpath(repo_root)

    def _contained(path: str) -> bool:
        # Re-resolve per candidate (not just the extension-less base path) so that a
        # symlink planted inside the repo (e.g. evil.js -> /etc/passwd) is caught too:
        # the base path may not exist yet, but the final file-with-extension does.
        try:
            return os.path.commonpath([os.path.realpath(path), real_repo_root]) == real_repo_root
        except ValueError:
            # e.g. candidate and repo_root on different drives on Windows
            return False

    if not _contained(candidate):
        return None

    def _exists(path: str) -> bool:
        rel = os.path.relpath(path, repo_root).replace("\\", "/")
        if known_files is not None:
            return rel in known_files
        return os.path.isfile(path)

    # Try exact, then with extensions
    js_extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".vue", ".svelte"]

    # Exact match
    if _exists(candidate) and _contained(candidate):
        return os.path.relpath(candidate, repo_root).replace("\\", "/")

    # Try adding extensions
    for ext in js_extensions:
        if _exists(candidate + ext) and _contained(candidate + ext):
            return os.path.relpath(candidate + ext, repo_root).replace("\\", "/")

    # Try index files
    for ext in js_extensions:
        index_path = os.path.join(candidate, f"index{ext}")
        if _exists(index_path) and _contained(index_path):
            return os.path.relpath(index_path, repo_root).replace("\\", "/")

    return None


def _strip_go_comments(source: str) -> str:
    """Strip // and /* */ comments from Go source, preserving string/rune/raw-string
    literals and line numbers (comment bodies are blanked, not removed)."""
    out: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        two = source[i : i + 2]
        if two == "//":
            j = source.find("\n", i)
            i = n if j == -1 else j
            continue
        if two == "/*":
            j = source.find("*/", i + 2)
            end = j + 2 if j != -1 else n
            out.append("\n" * source.count("\n", i, end))
            i = end
            continue
        c = source[i]
        if c in ('"', "'"):
            j = i + 1
            while j < n:
                if source[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if source[j] == c:
                    j += 1
                    break
                j += 1
            out.append(source[i:j])
            i = j
            continue
        if c == "`":
            j = source.find("`", i + 1)
            j = j + 1 if j != -1 else n
            out.append(source[i:j])
            i = j
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _extract_go_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract Go imports."""
    imports: list[dict[str, Any]] = []
    source = _strip_go_comments(source)

    # Single import: import "path"
    for match in re.finditer(r'import\s+"([^"]+)"', source):
        line = source[: match.start()].count("\n") + 1
        imports.append({"raw": match.group(1), "resolved": None, "line": line, "type": "import"})

    # Grouped import: import ( "path1" \n "path2" )
    for block in re.finditer(r"import\s*\(([\s\S]*?)\)", source):
        block_start = source[: block.start()].count("\n") + 1
        for i, line_match in enumerate(re.finditer(r'"([^"]+)"', block.group(1))):
            imports.append(
                {
                    "raw": line_match.group(1),
                    "resolved": None,
                    "line": block_start + i,
                    "type": "import",
                }
            )

    return imports


def _extract_java_imports(source: str, repo_root: str) -> list[dict]:
    """Extract Java/Kotlin imports."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r"import\s+([\w.]+(?:\.\*)?)\s*;", source):
        raw = match.group(1)
        line = source[: match.start()].count("\n") + 1
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
        line = source[: match.start()].count("\n") + 1
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
        line = source[: match.start()].count("\n") + 1
        candidate = os.path.normpath(os.path.join(file_dir, raw))
        for ext in ["", ".rb"]:
            if os.path.isfile(candidate + ext):
                imports.append(
                    {
                        "raw": raw,
                        "resolved": os.path.relpath(candidate + ext, repo_root),
                        "line": line,
                        "type": "require_relative",
                    }
                )
                break
        else:
            imports.append({"raw": raw, "resolved": None, "line": line, "type": "require_relative"})

    for match in re.finditer(r"""(?<!_)require\s+['"]([^'"]+)['"]""", source):
        raw = match.group(1)
        line = source[: match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "require"})

    return imports


def _extract_rust_uses(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract Rust use/mod declarations."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r"(?:use|mod)\s+([\w:]+)", source):
        raw = match.group(1)
        line = source[: match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "use"})
    return imports


def _extract_php_imports(filepath: str, source: str, repo_root: str) -> list[dict]:
    """Extract PHP use/include/require statements."""
    imports: list[dict[str, Any]] = []
    for match in re.finditer(r"""(?:include|include_once|require|require_once)\s+['"]([^'"]+)['"]""", source):
        raw = match.group(1)
        line = source[: match.start()].count("\n") + 1
        file_dir = os.path.dirname(filepath)
        candidate = os.path.normpath(os.path.join(file_dir, raw))
        resolved = os.path.relpath(candidate, repo_root) if os.path.isfile(candidate) else None
        imports.append({"raw": raw, "resolved": resolved, "line": line, "type": "include"})

    for match in re.finditer(r"use\s+([\w\\]+)", source):
        raw = match.group(1)
        line = source[: match.start()].count("\n") + 1
        imports.append({"raw": raw, "resolved": None, "line": line, "type": "use"})
    return imports


def _extract_ipynb_imports(
    filepath: str, source: str, repo_root: str, known_files: set[str] | None = None
) -> list[dict]:
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
    kernel_lang = notebook.get("metadata", {}).get("kernelspec", {}).get("language", "python").lower()

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
        cell_imports = _extract_python_imports(filepath, cell_source, repo_root, known_files=known_files)

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
    "Python": _extract_python_imports,
    "JavaScript": _extract_js_ts_imports,
    "JavaScript (React)": _extract_js_ts_imports,
    "TypeScript": _extract_js_ts_imports,
    "TypeScript (React)": _extract_js_ts_imports,
    "Vue": _extract_vue_svelte_imports,
    "Svelte": _extract_vue_svelte_imports,
    "Go": _extract_go_imports,
    "Java": _extract_java_imports,
    "Kotlin": _extract_java_imports,
    "C": _extract_c_cpp_includes,
    "C++": _extract_c_cpp_includes,
    "C/C++ Header": _extract_c_cpp_includes,
    "C++ Header": _extract_c_cpp_includes,
    "Ruby": _extract_ruby_requires,
    "Rust": _extract_rust_uses,
    "PHP": _extract_php_imports,
    "Jupyter Notebook": _extract_ipynb_imports,
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
    file_list: list[FileEntry],
    content_cache: BoundedContentCache | None = None,
    executor_type: str | None = None,
) -> DepGraph:
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
    known_files = {f.path for f in file_list}

    edges: list[dict[str, Any]] = []  # { source, target, ... }
    adjacency: dict[str, set] = defaultdict(set)  # file -> imports
    reverse_adjacency: dict[str, set] = defaultdict(set)  # file -> imported_by
    file_imports: dict[str, list] = defaultdict(list)  # file -> raw import list

    # Content cache: read each file ONCE, reuse in classifier + entry point detection
    local_cache = False
    if content_cache is None:
        content_cache = BoundedContentCache(settings.max_content_cache_bytes)
        local_cache = True

    resolved_count = 0
    unresolved_count = 0

    for file_info in file_list:
        rel_path = file_info.path
        language = file_info.language
        abs_path = os.path.join(repo_root, rel_path)

        extractor = _EXTRACTORS.get(language)
        if not extractor:
            continue

        # Read file ONCE and cache (skip caching large notebooks to save memory)
        # Sprint 2 T2: use pre-loaded content from traverser when available to
        # skip a disk read entirely.
        try:
            max_size = MAX_NOTEBOOK_SIZE_BYTES if rel_path.endswith(".ipynb") else MAX_FILE_SIZE_BYTES
            if file_info.content is not None:
                # Traverser pre-loaded the content — use it directly
                source = file_info.content
            else:
                file_size = os.path.getsize(abs_path)
                if file_size > max_size:
                    continue
                with open(abs_path, encoding="utf-8", errors="ignore") as f:
                    source = f.read()
            if not rel_path.endswith(".ipynb"):
                content_cache[rel_path] = source[:4096]
        except (OSError, UnicodeDecodeError):
            continue

        # Extract imports
        if extractor in (_extract_python_imports, _extract_js_ts_imports):
            if extractor == _extract_js_ts_imports:
                imports = extractor(
                    abs_path, source, repo_root, known_files=known_files, raw_imports_cache=file_info.raw_imports
                )
            else:
                imports = extractor(abs_path, source, repo_root, known_files=known_files)
        elif extractor == _extract_ipynb_imports:
            # Need to patch ipynb too since it calls python extractor
            imports = extractor(abs_path, source, repo_root, known_files=known_files)
        else:
            imports = extractor(abs_path, source, repo_root)
        file_imports[rel_path] = imports

        for imp in imports:
            target = imp["resolved"]
            if target and target in known_files and target != rel_path:
                edges.append(
                    {
                        "source": rel_path,
                        "target": target,
                        "raw": imp["raw"],
                        "line": imp["line"],
                        "type": imp["type"],
                    }
                )
                adjacency[rel_path].add(target)
                reverse_adjacency[target].add(rel_path)
                resolved_count += 1
            else:
                unresolved_count += 1

    # ── Detect entry points (using content_cache to avoid re-reading files) ──
    entry_points, file_signals = _detect_entry_points(
        repo_root, known_files, adjacency, reverse_adjacency, content_cache
    )

    # ── Find central/important files ──
    central_files = _find_central_files(known_files, adjacency, reverse_adjacency)

    if local_cache:
        content_cache.clear()
        del content_cache

    return DepGraph(
        edges=edges,
        adjacency=dict(adjacency),
        reverse_adjacency=dict(reverse_adjacency),
        file_imports=dict(file_imports),
        entry_points=entry_points,
        file_signals=file_signals,
        central_files=central_files,
        stats={
            "total_edges": len(edges),
            "resolved_edges": resolved_count,
            "unresolved_edges": unresolved_count,
        },
    )


def patch_dep_graph(
    old_graph: DepGraph,
    partial_graph: DepGraph,
    changed_paths: set[str],
    deleted_paths: set[str],
    known_files: set[str],
    repo_root: str,
    content_cache: Any,
) -> DepGraph:
    """
    Merge a partial dependency graph (from changed files) into an existing full graph.
    Re-computes global stats like entry points and central files.
    """
    new_edges = []
    # Retain old edges that do NOT originate from a changed/deleted file, and do not target a deleted file.
    for edge in old_graph.edges:
        src = edge["source"]
        tgt = edge["target"]
        if src in changed_paths or src in deleted_paths or tgt in deleted_paths:
            continue
        new_edges.append(edge)

    # Append the new edges from the partial analysis
    new_edges.extend(partial_graph.edges)

    adjacency: dict[str, set] = defaultdict(set)
    reverse_adjacency: dict[str, set] = defaultdict(set)
    resolved_count = 0

    for edge in new_edges:
        src = edge["source"]
        tgt = edge["target"]
        adjacency[src].add(tgt)
        reverse_adjacency[tgt].add(src)
        resolved_count += 1

    file_imports = dict(old_graph.file_imports)
    for path in changed_paths:
        if path in partial_graph.file_imports:
            file_imports[path] = partial_graph.file_imports[path]
        else:
            file_imports.pop(path, None)

    for path in deleted_paths:
        file_imports.pop(path, None)

    # Recompute global stats
    entry_points, file_signals = _detect_entry_points(
        repo_root, known_files, adjacency, reverse_adjacency, content_cache
    )
    central_files = _find_central_files(known_files, adjacency, reverse_adjacency)

    # Unresolved edges estimate (keep old + partial, subtract deleted - rough estimate)
    # A true unresolved_count would require re-parsing or storing unresolved per file,
    # but this is mostly for telemetry.
    unresolved_count = old_graph.stats.get("unresolved_edges", 0)

    return DepGraph(
        edges=new_edges,
        adjacency=dict(adjacency),
        reverse_adjacency=dict(reverse_adjacency),
        file_imports=file_imports,
        entry_points=entry_points,
        file_signals=file_signals,
        central_files=central_files,
        stats={
            "total_edges": len(new_edges),
            "resolved_edges": resolved_count,
            "unresolved_edges": unresolved_count,
        },
    )


# ─────────────────────────────────────────────
# Intelligence: entry point detection
# ─────────────────────────────────────────────

# Common entry point filenames (basename patterns)
_ENTRY_POINT_NAMES = {
    # Python
    "main.py",
    "app.py",
    "manage.py",
    "wsgi.py",
    "asgi.py",
    "server.py",
    "run.py",
    "cli.py",
    "__main__.py",
    # JavaScript / TypeScript
    "index.js",
    "index.ts",
    "index.mjs",
    "main.js",
    "main.ts",
    "app.js",
    "app.ts",
    "server.js",
    "server.ts",
    # Go
    "main.go",
    "cmd.go",
    # Java
    "Main.java",
    "App.java",
    "Application.java",
    # Rust
    "main.rs",
    "lib.rs",
    # Ruby
    "app.rb",
    "config.ru",
    "Rakefile",
    # PHP
    "index.php",
    "artisan",
    # C/C++
    "main.c",
    "main.cpp",
}

# Config/build files that signal project structure
_CONFIG_ENTRY_NAMES = {
    "package.json",
    "setup.py",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "Makefile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
}


def _detect_entry_points(
    repo_root: str,
    known_files: set[str],
    adjacency: dict[str, set],
    reverse_adjacency: dict[str, set],
    content_cache: dict[str, str] | BoundedContentCache | None = None,
) -> tuple[list[dict], dict[str, set]]:
    """
    Detect likely entry point files using heuristics:
      1. Filename matches common entry point patterns
      2. Has 'if __name__' guard (Python)  /  main() function
      3. Graph-based: files that import others but are not imported themselves

    Returns: (entry_points, file_signals)
    """
    entry_points = []
    scored: dict[str, dict] = {}
    file_signals: dict[str, set] = {}

    # Extensions that are actual source code (not docs/config)
    source_extensions = {
        ".py",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".go",
        ".java",
        ".kt",
        ".rs",
        ".rb",
        ".php",
        ".c",
        ".cpp",
        ".h",
        ".hpp",
        ".cs",
        ".swift",
        ".scala",
        ".dart",
        ".ex",
        ".exs",
        ".vue",
        ".svelte",
    }

    for fpath in known_files:
        basename = os.path.basename(fpath)
        _, ext = os.path.splitext(basename)
        is_source = ext.lower() in source_extensions
        score = 0
        reasons = []
        signals = set()

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

            if "if __name__" in content and "__main__" in content:
                score += 4
                reasons.append("has_main_guard")
                signals.add("main_guard")
            if re.search(r"def\s+main\s*\(", content):
                score += 2
                reasons.append("has_main_function")
                signals.add("main_fn")
            if re.search(r"func\s+main\s*\(", content):  # Go
                score += 4
                reasons.append("has_main_function")
                signals.add("main_fn")
            if re.search(r"public\s+static\s+void\s+main", content):  # Java
                score += 4
                reasons.append("has_main_method")
                signals.add("main_fn")
            if re.search(r"app\.listen\s*\(", content) or re.search(r"createServer\s*\(", content):  # Node.js
                score += 3
                reasons.append("starts_server")
                signals.add("starts_server")
            if re.search(r"\.run\s*\(", content) and (
                "Flask" in content or "FastAPI" in content or "uvicorn" in content
            ):
                score += 3
                reasons.append("starts_server")
                signals.add("starts_server")
            if "React" in content or "useState" in content or "useEffect" in content or "Component" in content:
                signals.add("is_react")

            file_signals[fpath] = signals

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
    return entry_points, file_signals


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

        file_scores.append(
            {
                "file": fpath,
                "in_degree": in_deg,
                "out_degree": out_deg,
                "score": score,
                "role": _classify_role(in_deg, out_deg),
            }
        )

    # Sort by score, return top results
    file_scores.sort(key=lambda x: x["score"], reverse=True)
    return file_scores[:30]  # Top 30 most central files


def _classify_role(in_deg: int, out_deg: int) -> str:
    """Classify a file's role based on its dependency graph position."""
    if in_deg == 0 and out_deg > 0:
        return "entry_point"  # Imports others, not imported itself
    elif in_deg > 0 and out_deg == 0:
        return "leaf_utility"  # Imported by others, imports nothing
    elif in_deg >= 3 and out_deg >= 1:
        return "core_module"  # Heavily depended on, also imports
    elif in_deg > out_deg:
        return "utility"  # More imported than importing
    elif out_deg > in_deg:
        return "orchestrator"  # Imports more than it's imported
    else:
        return "connector"  # Equal in/out — bridges modules


# Testing
if __name__ == "__main__":
    notebook_path = "/Applications/Projects/CodeKavi/test/test.ipynb"
    with open(notebook_path) as f:
        notebook_content = f.read()
    imports = _extract_ipynb_imports(notebook_path, notebook_content, "/Applications/Projects/CodeKavi")
    print(imports)
