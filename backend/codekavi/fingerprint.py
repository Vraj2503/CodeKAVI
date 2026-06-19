import ast
import hashlib
import json
import os
from dataclasses import dataclass, asdict, field
from typing import Any, Optional

import tree_sitter_javascript as tsjs
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser

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


@dataclass
class FileFingerprint:
    path: str
    content_hash: str
    imports_hash: str = ""
    exports_hash: str = ""
    structure_hash: str = ""
    change_type: str = "NONE"  # NONE / COSMETIC / STRUCTURAL


def compute_file_hash(abs_path: str) -> str:
    """
    Compute a fast hash of a file by reading the first 8KB and last 2KB.
    """
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


def compute_structure_signature(rel_path: str, abs_path: str, source: Optional[str] = None) -> dict:
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
    language_name = FILENAME_LANGUAGE_MAP.get(os.path.basename(rel_path)) or EXTENSION_LANGUAGE_MAP.get(ext)

    # Read the source when a cache is available (we don't re-read twice)
    if source is None:
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                source = f.read()
        except OSError:
            return {"imports_hash": "", "exports_hash": "", "structure_hash": ""}

    if language_name in {"Python", "Jupyter Notebook"}:
        return _python_structure_signature(source)

    js_ts_lang = _LANG_BY_EXT.get(ext)
    if js_ts_lang is not None:
        return _js_ts_structure_signature(source, js_ts_lang)

    # Other languages have no signature support yet → caller treats as
    # structural to be safe.
    return {"imports_hash": "", "exports_hash": "", "structure_hash": ""}


def _python_structure_signature(source: str) -> dict:
    """Use the AST to extract Python structure — function/class/method names."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"imports_hash": "", "exports_hash": "", "structure_hash": ""}

    imports: list[str] = []
    exports: list[str] = []
    declarations: list[str] = []

    # Track top-level `__all__` if present (the conventional export list).
    body = getattr(tree, "body", [])

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module)
            exports.extend(a.name for a in node.names)
        elif isinstance(node, ast.FunctionDef):
            args = [a.arg for a in node.args.args if a.arg]
            declarations.append(f"def:{node.name}({','.join(args)})")
        elif isinstance(node, ast.AsyncFunctionDef):
            args = [a.arg for a in node.args.args if a.arg]
            declarations.append(f"adef:{node.name}({','.join(args)})")
        elif isinstance(node, ast.ClassDef):
            declarations.append(f"class:{node.name}")
            for stmt in node.body:
                if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = [a.arg for a in stmt.args.args if a.arg]
                    declarations.append(
                        f"method:{node.name}.{stmt.name}({','.join(args)})"
                    )

    if not isinstance(body, list):
        body = []

    for node in body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    if isinstance(node.value, (ast.List, ast.Tuple)):
                        for elt in node.value.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                exports.append(elt.value)

    return {
        "imports_hash": _hash_python_signature(imports),
        "exports_hash": _hash_sorted(exports),
        "structure_hash": _hash_python_signature(declarations),
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
        return {"imports_hash": "", "exports_hash": "", "structure_hash": ""}

    captures = query.captures(tree.root_node)

    imports: list[str] = []
    exports: list[str] = []
    declarations: list[str] = []

    def _each(pairs: list[tuple[Any, str]] | dict[Any, str]):
        if isinstance(pairs, dict):
            yield from pairs.items()
        else:
            yield from pairs

    for node, name in _each(captures):
        text = node.text.decode("utf-8", errors="ignore")
        if name == "import_path" or name == "export_from_path":
            imports.append(text)
        elif name == "export_name":
            exports.append(text)
        elif name in {"fn_name", "class_name", "method_name", "var_name"}:
            declarations.append(f"{name}:{text}")

    return {
        "imports_hash": _hash_sorted(imports),
        "exports_hash": _hash_sorted(exports),
        "structure_hash": _hash_sorted(declarations),
    }


def load_fingerprints(repo_id: str) -> dict[str, FileFingerprint]:
    """Load cached fingerprints from disk."""
    cache_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".codekavi-fingerprints")
    cache_path = os.path.join(cache_dir, f"{repo_id}.json")
    if not os.path.exists(cache_path):
        return {}

    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            result: dict[str, FileFingerprint] = {}
            for k, v in data.items():
                result[k] = FileFingerprint(**v)
            return result
    except (json.JSONDecodeError, OSError, TypeError):
        # Backwards-compat: an older fingerprint cache may lack the
        # newer *_hash fields. Re-hydrate only known fields to stay
        # forward-compatible.
        return {}


def save_fingerprints(repo_id: str, fingerprints: dict[str, FileFingerprint]) -> None:
    """Save fingerprints to disk."""
    cache_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".codekavi-fingerprints")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{repo_id}.json")

    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            data = {k: asdict(v) for k, v in fingerprints.items()}
            json.dump(data, f)
    except OSError:
        pass


def compare_and_classify_repo(
    repo_id: str,
    repo_root: str,
    current_files: list[dict],
) -> tuple[dict[str, FileFingerprint], bool]:
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
      - has_structural_changes (bool) — true if any file is STRUCTURAL or new
    """
    cached = load_fingerprints(repo_id)
    updated: dict[str, FileFingerprint] = {}
    has_structural = False

    for f_info in current_files:
        rel_path = f_info["path"]
        abs_path = os.path.join(repo_root, rel_path)

        current_hash = compute_file_hash(abs_path)
        sig = compute_structure_signature(rel_path, abs_path)

        if rel_path in cached:
            prev = cached[rel_path]
            if prev.content_hash == current_hash:
                change_type = "NONE"
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
                has_structural = True
        else:
            change_type = "STRUCTURAL"
            has_structural = True

        updated[rel_path] = FileFingerprint(
            path=rel_path,
            content_hash=current_hash,
            imports_hash=sig["imports_hash"],
            exports_hash=sig["exports_hash"],
            structure_hash=sig["structure_hash"],
            change_type=change_type,
        )

    return updated, has_structural
