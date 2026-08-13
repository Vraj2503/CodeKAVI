"""
complexity.py — Cyclomatic complexity from tree-sitter parse trees.

The complexity treemap is named after this number, so it has to be a real
measurement rather than a stand-in for file size. Byte size answers "how much
did someone type"; cyclomatic complexity answers "how many ways can control
flow through this", which is the thing that actually predicts where bugs and
review time land.

Method: McCabe. Count the decision points in a file and add one, so a
straight-line file scores 1. Decision points are counted per *language grammar*
rather than by regex, because `if` inside a string literal or a comment is not
a branch and a regex cannot tell the difference.

Supported: Python, JavaScript/JSX, TypeScript, TSX. Every other language
returns None and the caller marks the file `size_fallback` — see
`file_complexity()`. A file that quietly reports 1 because we could not parse
it is indistinguishable from a genuinely simple file, and that is the exact
lie this module exists to avoid.

Cost: one parse per source file, during /analyze only. The result is stored on
the file profile and cached with the rest of the analysis, so visualization
requests never re-parse.
"""

import logging
import os
import threading
from typing import Any

import tree_sitter_javascript as tsjs
import tree_sitter_python as tspy
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser, Query

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# Grammars
# ─────────────────────────────────────────────

# Languages are immutable and safe to share across threads (same as analyzer.py).
_LANGUAGES: dict[str, Language] = {
    "python": Language(tspy.language(), "python"),
    "javascript": Language(tsjs.language(), "javascript"),
    "typescript": Language(tsts.language_typescript(), "typescript"),
    "tsx": Language(tsts.language_tsx(), "tsx"),
}

#: Extension → grammar key. `.jsx` uses the JavaScript grammar, which handles
#: JSX natively; `.tsx` needs the separate TSX grammar because the TypeScript
#: grammar reads `<T>` as a type assertion rather than an element.
_EXT_GRAMMAR: dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
}

SUPPORTED_COMPLEXITY_EXTENSIONS: frozenset[str] = frozenset(_EXT_GRAMMAR)


# ─────────────────────────────────────────────
# Decision points
# ─────────────────────────────────────────────

#: Python branch nodes.
#:
#: `boolean_operator` covers `and`/`or`; `a and b and c` nests into two of them,
#: which is the McCabe-correct count for three operands. `if_clause` is a
#: comprehension guard — a real branch, just written compactly.
#:
#: Deliberately NOT counted: `assert_statement`. It is a guard rather than
#: control flow, and JS has no equivalent, so counting it would make Python
#: files read systematically hotter than JS files on a chart that colors both
#: from one scale.
_PY_QUERY = """
    (if_statement) @b
    (elif_clause) @b
    (for_statement) @b
    (while_statement) @b
    (except_clause) @b
    (conditional_expression) @b
    (boolean_operator) @b
    (case_clause) @b
    (if_clause) @b
"""

#: JS/TS branch nodes.
#:
#: `switch_case` matches `case` only, never `default` — a default arm adds no
#: branch. `&&`, `||` and `??` each short-circuit, so each is a decision point.
_JS_QUERY = """
    (if_statement) @b
    (for_statement) @b
    (for_in_statement) @b
    (while_statement) @b
    (do_statement) @b
    (switch_case) @b
    (catch_clause) @b
    (ternary_expression) @b
    (binary_expression operator: ["&&" "||" "??"]) @b
"""

_QUERY_SOURCE: dict[str, str] = {
    "python": _PY_QUERY,
    "javascript": _JS_QUERY,
    "typescript": _JS_QUERY,
    "tsx": _JS_QUERY,
}

#: Skip parsing above this. A half-megabyte file is either generated, vendored,
#: or minified; none of those are worth a maintenance-hotspot reading, and a
#: minified bundle would otherwise dominate the color scale on its own.
MAX_PARSE_BYTES = 512 * 1024


# Tree-sitter 0.21 Parser and Query objects mutate internal state during
# parse()/captures() and are not thread-safe. Classification runs in a thread
# pool, so each thread builds its own pair once and reuses it for every file —
# the same arrangement analyzer.py uses.
_thread_local = threading.local()


def _get_parser_and_query(grammar: str) -> tuple[Parser, Query]:
    """Return this thread's (Parser, Query) for a grammar, building it once."""
    cache: dict[str, tuple[Parser, Query]] | None = getattr(_thread_local, "cx_parsers", None)
    if cache is None:
        cache = {}
        _thread_local.cx_parsers = cache

    pair = cache.get(grammar)
    if pair is None:
        language = _LANGUAGES[grammar]
        parser = Parser(language)
        pair = (parser, language.query(_QUERY_SOURCE[grammar]))
        cache[grammar] = pair
    return pair


# ─────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────


def count_lines_of_code(source: str) -> int:
    """
    Non-blank line count.

    Comments are not stripped: doing it correctly needs a per-language pass,
    and doing it approximately would make the number wrong in ways nobody could
    predict from the label. Non-blank lines is a claim the reader can verify by
    opening the file.
    """
    return sum(1 for line in source.splitlines() if line.strip())


def cyclomatic_complexity(source: str, ext: str) -> int | None:
    """
    McCabe complexity for one file, or None if this language has no parser.

    None is meaningful — it is how the caller learns to mark the file
    `size_fallback` instead of publishing a fabricated 1.
    """
    grammar = _EXT_GRAMMAR.get(ext.lower())
    if grammar is None:
        return None

    encoded = source.encode("utf-8", errors="ignore")
    if not encoded.strip():
        return 1
    if len(encoded) > MAX_PARSE_BYTES:
        return None

    try:
        parser, query = _get_parser_and_query(grammar)
        tree = parser.parse(encoded)
        # A tree with errors still yields usable counts for the parts that did
        # parse — tree-sitter recovers locally rather than giving up on the
        # file. An undercount beats refusing to measure the file at all.
        captures = query.captures(tree.root_node)
        # 0.23+ returns {capture_name: [nodes]}; older bindings a list of tuples.
        matched = sum(len(nodes) for nodes in captures.values()) if isinstance(captures, dict) else len(captures)
        return matched + 1
    except Exception as e:  # pragma: no cover — grammar/ABI failures only
        logger.debug(f"complexity: parse failed for '{ext}' file: {e}")
        return None


def file_complexity(source: str, path: str) -> dict[str, Any]:
    """
    Complexity metrics for one file's source.

    Returns `{loc, complexity, complexity_source}` where `complexity_source` is
    either `"cyclomatic"` (measured) or `"size_fallback"` (no parser for this
    language, or the file was too large). On a fallback, `complexity` is None
    rather than a guess, so a consumer can render it as "unknown" instead of
    silently mixing units into a complexity scale.
    """
    _, ext = os.path.splitext(path)
    loc = count_lines_of_code(source)
    score = cyclomatic_complexity(source, ext)

    return {
        "loc": loc,
        "complexity": score,
        "complexity_source": "cyclomatic" if score is not None else "size_fallback",
    }
