import ast
import hashlib
import json
import os
import subprocess
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is POSIX-only
    fcntl = None  # type: ignore[assignment]

import tree_sitter_javascript as tsjs
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser

from codekavi.pipeline_models import FileEntry

try:
    from codekavi.config import EXTENSION_LANGUAGE_MAP, FILENAME_LANGUAGE_MAP
except ModuleNotFoundError:  # pragma: no cover - flat-layout fallback
    from config import EXTENSION_LANGUAGE_MAP, FILENAME_LANGUAGE_MAP  # type: ignore[no-redef]


# ─────────────────────────────────────────────
# Tree-sitter languages & structural queries (immutable, thread-safe)
# ─────────────────────────────────────────────

_JS_LANGUAGE = Language(tsjs.language(), "javascript")
_TS_LANGUAGE = Language(tsts.language_typescript(), "typescript")

# Pure structural query: function declarations, class declarations, method
# definitions, import / export specifiers, and exported names. Picking up
# *just* these means we capture the shape of the file without caring about
# implementation details or comments.
_STRUCTURE_QUERY_STR = """
    (import_statement source: (string (string_fragment) @import_path))
    (export_statement source: (string (string_fragment) @export_from_path))
    (export_statement
        (export_clause (export_specifier name: (identifier) @export_name)))
    (call_expression
        function: (identifier) @fname
        arguments: (arguments (string (string_fragment) @import_path))
        (#eq? @fname "require"))
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @import_path)))
    (function_declaration name: (identifier) @fn_name)
    (class_declaration name: (identifier) @class_name)
    (method_definition name: (property_identifier) @method_name)
    (lexical_declaration
        (variable_declarator name: (identifier) @var_name))
"""
# TypeScript's class name is a `type_identifier`, not a bare `identifier`,
# so we use a separate query for that grammar. Everything else matches JS.
_STRUCTURE_QUERY_STR_TS = """
    (import_statement source: (string (string_fragment) @import_path))
    (export_statement source: (string (string_fragment) @export_from_path))
    (export_statement
        (export_clause (export_specifier name: (identifier) @export_name)))
    (call_expression
        function: (identifier) @fname
        arguments: (arguments (string (string_fragment) @import_path))
        (#eq? @fname "require"))
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @import_path)))
    (function_declaration name: (identifier) @fn_name)
    (class_declaration name: (type_identifier) @class_name)
    (method_definition name: (property_identifier) @method_name)
    (lexical_declaration
        (variable_declarator name: (identifier) @var_name))
"""
_JS_STRUCTURE_QUERY = _JS_LANGUAGE.query(_STRUCTURE_QUERY_STR)
_TS_STRUCTURE_QUERY = _TS_LANGUAGE.query(_STRUCTURE_QUERY_STR_TS)

# Predefined language identifier for "single file is JS by default".
_LANG_BY_EXT = {
    ".ts": "ts",
    ".tsx": "ts",
    ".js": "js",
    ".jsx": "js",
    ".mjs": "js",
    ".cjs": "js",
}


class ChangeClassification(StrEnum):
    SKIP = "SKIP"
    PARTIAL_UPDATE = "PARTIAL_UPDATE"
    ARCHITECTURE_UPDATE = "ARCHITECTURE_UPDATE"
    FULL_UPDATE = "FULL_UPDATE"


@dataclass
class FunctionFingerprint:
    name: str
    params: list[str]
    exported: bool
    line_count: int


@dataclass
class ClassFingerprint:
    name: str
    methods: list[str]
    exported: bool
    line_count: int


@dataclass
class ImportFingerprint:
    source: str
    specifiers: list[str]


@dataclass
class FileFingerprint:
    path: str
    content_hash: str
    imports_hash: str = ""
    exports_hash: str = ""
    structure_hash: str = ""
    change_type: str = "NONE"  # NONE / COSMETIC / STRUCTURAL
    parse_error: bool = False
    functions: list[FunctionFingerprint] = field(default_factory=list)
    classes: list[ClassFingerprint] = field(default_factory=list)
    imports: list[ImportFingerprint] = field(default_factory=list)


def compute_file_hash(abs_path: str, content: str | None = None) -> str:
    """
    Compute a fast hash of a file by reading the first 8KB and last 2KB.
    If content is provided, hash the whole content string directly.
    """
    if content is not None:
        return hashlib.md5(content.encode("utf-8", errors="ignore")).hexdigest()
    try:
        with open(abs_path, "rb") as f:
            head = f.read(8192)
            f.seek(0, 2)
            size = f.tell()
            if size > 10240:
                f.seek(-2048, 2)
                tail = f.read(2048)
            else:
                tail = b""
        return hashlib.md5(head + tail).hexdigest()
    except OSError:
        return ""


def _hash_sorted(values: list[str]) -> str:
    """Return an MD5 over a deterministically sorted, lower-cased list."""
    if not values:
        return ""
    normalized = sorted({v.strip().lower() for v in values if v and v.strip()})
    return hashlib.md5("|".join(normalized).encode("utf-8")).hexdigest()


def _hash_python_signature(sig: list[Any]) -> str:
    """Hash a Python structural signature list (already canonical)."""
    if not sig:
        return ""
    canonical = sorted(sig)
    return hashlib.md5(json.dumps(canonical, sort_keys=True).encode("utf-8")).hexdigest()


def compute_structure_signature(rel_path: str, abs_path: str, source: str | None = None) -> dict:
    """
    Compute structure-hash components for a file:

      - imports_hash: MD5 of sorted, normalised import paths
      - exports_hash: MD5 of sorted export names (and re-export sources)
      - structure_hash: MD5 of sorted function / class / method / variable names
        with their arity / signature on Python, and a flat name-list on JS/TS.

    Returns an empty-string dict if the file can't be parsed; callers should
    treat that as "no signature" rather than as a structural mismatch.

    Python files use ast.parse(); JS/TS files use tree-sitter with a
    per-call Parser() (Pair with analyzer.py's per-call parser rule).
    """
    ext = os.path.splitext(rel_path)[1].lower()
    language_name = FILENAME_LANGUAGE_MAP.get(os.path.basename(rel_path)) or EXTENSION_LANGUAGE_MAP.get(ext, "Unknown")

    # Read the source when a cache is available (we don't re-read twice)
    if source is None:
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                source = f.read()
        except OSError:
            return {"imports_hash": "", "exports_hash": "", "structure_hash": "", "parse_error": True}

    if language_name in {"Python", "Jupyter Notebook"}:
        return _python_structure_signature(source)

    js_ts_lang = _LANG_BY_EXT.get(ext)
    if js_ts_lang is not None:
        return _js_ts_structure_signature(source, js_ts_lang)

    # Other languages have no signature support yet → caller treats as
    # structural to be safe.
    return {"imports_hash": "", "exports_hash": "", "structure_hash": "", "parse_error": True}


def _python_structure_signature(source: str) -> dict:
    """Use the AST to extract Python structure — function/class/method names."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"imports_hash": "", "exports_hash": "", "structure_hash": "", "parse_error": True}

    imports: list[str] = []
    exports: list[str] = []
    declarations: list[str] = []

    enriched_imports: list[ImportFingerprint] = []
    enriched_functions: list[FunctionFingerprint] = []
    enriched_classes: list[ClassFingerprint] = []

    # Track top-level `__all__` if present (the conventional export list).
    body = getattr(tree, "body", [])

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
                enriched_imports.append(ImportFingerprint(source=alias.name, specifiers=[]))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module)
                enriched_imports.append(ImportFingerprint(source=node.module, specifiers=[a.name for a in node.names]))
        elif isinstance(node, ast.FunctionDef):
            args = [a.arg for a in node.args.args if a.arg]
            declarations.append(f"def:{node.name}({','.join(args)})")
            enriched_functions.append(
                FunctionFingerprint(
                    name=node.name,
                    params=args,
                    exported=False,
                    line_count=node.end_lineno - node.lineno
                    if hasattr(node, "end_lineno") and hasattr(node, "lineno") and node.end_lineno and node.lineno
                    else 1,
                )
            )
        elif isinstance(node, ast.AsyncFunctionDef):
            args = [a.arg for a in node.args.args if a.arg]
            declarations.append(f"adef:{node.name}({','.join(args)})")
            enriched_functions.append(
                FunctionFingerprint(
                    name=node.name,
                    params=args,
                    exported=False,
                    line_count=node.end_lineno - node.lineno
                    if hasattr(node, "end_lineno") and hasattr(node, "lineno") and node.end_lineno and node.lineno
                    else 1,
                )
            )
        elif isinstance(node, ast.ClassDef):
            declarations.append(f"class:{node.name}")
            methods = []
            for stmt in node.body:
                if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = [a.arg for a in stmt.args.args if a.arg]
                    declarations.append(f"method:{node.name}.{stmt.name}({','.join(args)})")
                    methods.append(stmt.name)
            enriched_classes.append(
                ClassFingerprint(
                    name=node.name,
                    methods=methods,
                    exported=False,
                    line_count=node.end_lineno - node.lineno
                    if hasattr(node, "end_lineno") and hasattr(node, "lineno") and node.end_lineno and node.lineno
                    else 1,
                )
            )

    if not isinstance(body, list):
        body = []

    for node in body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (
                    isinstance(target, ast.Name)
                    and target.id == "__all__"
                    and isinstance(node.value, (ast.List, ast.Tuple))
                ):
                    for elt in node.value.elts:
                        if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                            exports.append(elt.value)

    return {
        "imports_hash": _hash_python_signature(imports),
        "exports_hash": _hash_sorted(exports),
        "structure_hash": _hash_python_signature(declarations),
        "parse_error": False,
        "functions": enriched_functions,
        "classes": enriched_classes,
        "imports": enriched_imports,
    }


def _js_ts_structure_signature(source: str, lang: str) -> dict:
    """
    Use tree-sitter to capture import paths, export names, and declaration
    names. A fresh Parser is used per call — see analyzer.py for why this
    matters under concurrency.
    """
    language = _TS_LANGUAGE if lang == "ts" else _JS_LANGUAGE
    query = _TS_STRUCTURE_QUERY if lang == "ts" else _JS_STRUCTURE_QUERY

    parser = Parser()
    parser.set_language(language)

    source_bytes = source.encode("utf-8", errors="ignore")
    try:
        tree = parser.parse(source_bytes)
    except Exception:
        return {"imports_hash": "", "exports_hash": "", "structure_hash": "", "parse_error": True}

    captures = query.captures(tree.root_node)

    imports: list[str] = []
    exports: list[str] = []
    declarations: list[str] = []
    raw_imports: list[dict] = []

    def _each(pairs: list[tuple[Any, str]] | dict[Any, str]):
        if isinstance(pairs, dict):
            yield from pairs.items()
        else:
            yield from pairs

    enriched_imports: list[ImportFingerprint] = []
    enriched_functions: list[FunctionFingerprint] = []
    enriched_classes: list[ClassFingerprint] = []

    # We will build a simple map of classes to their methods to assemble ClassFingerprint
    class_methods: dict[str, list[str]] = {}
    current_class = None

    for node, name in _each(captures):
        text = node.text.decode("utf-8", errors="ignore")
        if name == "import_path" or name == "export_from_path":
            imports.append(text)
            raw_imports.append({"raw": text, "line": node.start_point[0] + 1})
            enriched_imports.append(ImportFingerprint(source=text, specifiers=[]))
        elif name == "export_name":
            exports.append(text)
        elif name == "fn_name":
            declarations.append(f"fn_name:{text}")
            enriched_functions.append(
                FunctionFingerprint(
                    name=text,
                    params=[],
                    exported=False,
                    line_count=node.end_point[0] - node.start_point[0] if hasattr(node, "end_point") else 1,
                )
            )
        elif name == "class_name":
            declarations.append(f"class_name:{text}")
            current_class = text
            class_methods[current_class] = []
            enriched_classes.append(
                ClassFingerprint(
                    name=text,
                    methods=[],
                    exported=False,
                    line_count=node.end_point[0] - node.start_point[0] if hasattr(node, "end_point") else 1,
                )
            )
        elif name == "method_name":
            declarations.append(f"method_name:{text}")
            if current_class and current_class in class_methods:
                class_methods[current_class].append(text)
                for cls in enriched_classes:
                    if cls.name == current_class:
                        cls.methods.append(text)
        elif name == "var_name":
            declarations.append(f"var_name:{text}")

    return {
        "imports_hash": _hash_sorted(imports),
        "exports_hash": _hash_sorted(exports),
        "structure_hash": _hash_sorted(declarations),
        "parse_error": False,
        "raw_imports": raw_imports,
        "functions": enriched_functions,
        "classes": enriched_classes,
        "imports": enriched_imports,
    }


def load_fingerprints(repo_id: str) -> dict[str, FileFingerprint]:
    """Load cached fingerprints from disk."""
    cache_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".codekavi-fingerprints")
    cache_path = os.path.join(cache_dir, f"{repo_id}.json")
    if not os.path.exists(cache_path):
        return {}

    try:
        with open(cache_path, encoding="utf-8") as f:
            data = json.load(f)
            result: dict[str, FileFingerprint] = {}
            for k, v in data.items():
                if "functions" in v:
                    v["functions"] = [FunctionFingerprint(**f) if isinstance(f, dict) else f for f in v["functions"]]
                if "classes" in v:
                    v["classes"] = [ClassFingerprint(**c) if isinstance(c, dict) else c for c in v["classes"]]
                if "imports" in v:
                    v["imports"] = [ImportFingerprint(**i) if isinstance(i, dict) else i for i in v["imports"]]
                result[k] = FileFingerprint(**v)
            return result
    except (json.JSONDecodeError, OSError, TypeError):
        # Backwards-compat: an older fingerprint cache may lack the
        # newer *_hash fields. Re-hydrate only known fields to stay
        # forward-compatible.
        return {}


def _get_git_commit(repo_root: str) -> str:
    try:
        res = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_root, capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return ""


def _atomic_write_json(path: str, data: Any) -> None:
    """
    Write JSON to `path` without ever exposing a partially-written or
    torn file to concurrent readers.

    Writes to a `.tmp` sibling first, flocking it for the duration of the
    write so concurrent writers serialize instead of interleaving, then
    atomically replaces the destination via os.replace().
    """
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        if fcntl is not None:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        finally:
            if fcntl is not None:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    os.replace(tmp_path, path)


def save_fingerprints(repo_id: str, repo_root: str, fingerprints: dict[str, FileFingerprint]) -> None:
    """Save fingerprints and current commit hash to disk."""
    cache_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".codekavi-fingerprints")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{repo_id}.json")
    commit_path = os.path.join(cache_dir, f"{repo_id}.commit")

    try:
        data = {k: asdict(v) for k, v in fingerprints.items()}
        _atomic_write_json(cache_path, data)

        commit = _get_git_commit(repo_root)
        if commit:
            commit_tmp_path = f"{commit_path}.tmp"
            with open(commit_tmp_path, "w", encoding="utf-8") as f:
                if fcntl is not None:
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    f.write(commit)
                    f.flush()
                    os.fsync(f.fileno())
                finally:
                    if fcntl is not None:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            os.replace(commit_tmp_path, commit_path)
    except OSError:
        pass


def compare_and_classify_repo(
    repo_id: str,
    repo_root: str,
    current_files: list[FileEntry],
    content_cache: dict[str, str] | None = None,
    executor_type: str | None = None,
) -> tuple[dict[str, FileFingerprint], set[str], ChangeClassification]:
    """
    Compute fingerprints for current_files, compare with cached, and classify.

    Classification rules:
      - NONE       — content_hash is identical (file is byte-equivalent in sampled view)
      - COSMETIC   — content differs but imports/exports/structure hashes match
                     (re-indenting, comment changes, internal-body rewrites)
      - STRUCTURAL — anything else (new/changed imports, new functions, deleted
                     classes, added exports). Forces a full re-analysis.

    Returns:
      - dict of updated FileFingerprints
      - set of paths that were fingerprinted before but aren't in
        current_files anymore (deleted since the last analysis)
      - ChangeClassification indicating the extent of the update required
    """
    cached = load_fingerprints(repo_id)
    updated: dict[str, FileFingerprint] = {}
    structural_count = 0
    total_files = len(current_files)

    for f_info in current_files:
        rel_path = f_info.path
        abs_path = os.path.join(repo_root, rel_path)
        content = content_cache.get(rel_path) if content_cache else None

        current_hash = compute_file_hash(abs_path, content=content)

        if rel_path in cached:
            prev = cached[rel_path]
            if prev.content_hash == current_hash:
                change_type = "NONE"
                sig: dict[str, Any] = {
                    "imports_hash": prev.imports_hash,
                    "exports_hash": prev.exports_hash,
                    "structure_hash": prev.structure_hash,
                    "parse_error": getattr(prev, "parse_error", False),
                }
            else:
                sig = compute_structure_signature(rel_path, abs_path, source=content)

                is_unsupported_or_error = sig.get("parse_error", False) and (
                    getattr(prev, "parse_error", False) or (prev.imports_hash == "" and prev.structure_hash == "")
                )

                if "raw_imports" in sig:
                    f_info.raw_imports = sig["raw_imports"]

                if is_unsupported_or_error:
                    change_type = "COSMETIC"
                elif (
                    prev.imports_hash == sig["imports_hash"]
                    and prev.exports_hash == sig["exports_hash"]
                    and prev.structure_hash == sig["structure_hash"]
                    and prev.imports_hash != ""
                    and prev.structure_hash != ""
                ):
                    # Quick content change but the structural fingerprint is identical
                    # → safe to call COSMETIC and skip re-analysis.
                    change_type = "COSMETIC"
                else:
                    change_type = "STRUCTURAL"
                    structural_count += 1
        else:
            sig = compute_structure_signature(rel_path, abs_path, source=content)
            change_type = "STRUCTURAL"
            structural_count += 1

            if "raw_imports" in sig:
                f_info.raw_imports = sig["raw_imports"]

        updated[rel_path] = FileFingerprint(
            path=rel_path,
            content_hash=current_hash,
            imports_hash=sig["imports_hash"],
            exports_hash=sig["exports_hash"],
            structure_hash=sig["structure_hash"],
            change_type=change_type,
            parse_error=sig.get("parse_error", False),
            functions=sig.get("functions", []),
            classes=sig.get("classes", []),
            imports=sig.get("imports", []),
        )

    # Determine ChangeClassification
    if structural_count == 0:
        classification = ChangeClassification.SKIP
    elif structural_count >= 30 or (total_files > 0 and structural_count / total_files > 0.5):
        classification = ChangeClassification.FULL_UPDATE
    elif structural_count >= 10:
        classification = ChangeClassification.ARCHITECTURE_UPDATE
    else:
        classification = ChangeClassification.PARTIAL_UPDATE

    deleted_paths = set(cached) - set(updated)
    return updated, deleted_paths, classification
