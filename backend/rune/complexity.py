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
import re
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
    "python": Language(tspy.language()),
    "javascript": Language(tsjs.language()),
    "typescript": Language(tsts.language_typescript()),
    "tsx": Language(tsts.language_tsx()),
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
#:
#: `@f` captures function definitions — methods included, since a method is a
#: `function_definition` inside a class body. Counted from the same parse as the
#: branches so the file is read once.
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
    (function_definition) @f
    (class_definition) @cls
    (call function: [(identifier) @callee (attribute attribute: (identifier) @callee)])
"""

#: JS/TS branch nodes.
#:
#: `switch_case` matches `case` only, never `default` — a default arm adds no
#: branch. `&&`, `||` and `??` each short-circuit, so each is a decision point.
#:
#: `@f` covers every way JS spells a function, arrow callbacks included: an
#: arrow passed to `.map()` is a unit someone has to read, same as a named one.
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
    (function_declaration) @f
    (function_expression) @f
    (generator_function_declaration) @f
    (generator_function) @f
    (arrow_function) @f
    (method_definition) @f
    (class_declaration) @cls
    (call_expression function: [
        (identifier) @callee
        (member_expression property: (property_identifier) @callee)
    ])
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

#: Cap on symbol records emitted per file, for the same reason as
#: MAX_PARSE_BYTES: one generated file should not dominate the symbol graph.
#: Complexity counts are unaffected — the cap only trims what we *name*.
MAX_SYMBOLS_PER_FILE = 300


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


def _text(node: Any) -> str:
    return node.text.decode("utf-8", errors="ignore")


def _dotted_tail(node: Any) -> Any:
    """`a.b.C` → the `C` node. Anything else → the node itself."""
    for field in ("attribute", "property", "name"):
        child = node.child_by_field_name(field)
        if child is not None:
            return child
    return node


#: Function/arrow expressions have no `name` field — the name lives on the
#: construct they are assigned to, one level up.
_NAME_FROM_PARENT: dict[str, str] = {
    "variable_declarator": "name",
    "pair": "key",
    "assignment_expression": "left",
    "public_field_definition": "name",
    "field_definition": "name",
}


def _symbol_name(node: Any) -> str | None:
    """Declared name of a function/class node, or None if it is anonymous."""
    named = node.child_by_field_name("name")
    if named is not None:
        return _text(named)

    parent = node.parent
    field = _NAME_FROM_PARENT.get(parent.type) if parent is not None else None
    if field is None:
        return None
    target = parent.child_by_field_name(field)
    return _text(_dotted_tail(target)) if target is not None else None


def _symbol_kind(node: Any, grammar: str) -> str:
    if node.type in ("class_definition", "class_declaration"):
        return "class"
    if node.type == "method_definition":
        return "method"
    if grammar == "python":
        # A Python method is a function_definition inside a class body.
        block = node.parent
        if block is not None and block.parent is not None and block.parent.type == "class_definition":
            return "method"
    return "function"


def _class_bases(node: Any, grammar: str) -> list[str]:
    """Base-class names for `class X(Base)` / `class X extends Base`."""
    if grammar == "python":
        supers = node.child_by_field_name("superclasses")
        if supers is None:
            return []
        # keyword_argument is `metaclass=`/`total=`, not a base.
        return [_text(_dotted_tail(c)) for c in supers.named_children if c.type != "keyword_argument"]

    heritage = next((c for c in node.named_children if c.type == "class_heritage"), None)
    if heritage is None or not heritage.named_children:
        return []
    target = heritage.named_children[0]
    if target.type.endswith("_clause"):  # TS wraps in extends_clause; JS does not
        target = target.child_by_field_name("value") or (target.named_children[0] if target.named_children else None)
    return [_text(_dotted_tail(target))] if target is not None else []


# ─────────────────────────────────────────────
# Per-symbol semantics
# ─────────────────────────────────────────────
#
# A name and a line number say where a symbol is, not what it does. The parse
# tree already holds the author's own answer — docstring, signature, decorators —
# and we were walking past it. Everything below reads the nodes we already have;
# no second parse, no extra query.

#: Nodes to walk up through when looking for a JSDoc comment. `const f = () => {}`
#: puts the comment above the `lexical_declaration`, three levels off the arrow.
_DOC_ASCEND: frozenset[str] = frozenset(
    {
        "variable_declarator",
        "lexical_declaration",
        "variable_declaration",
        "export_statement",
        "expression_statement",
        "assignment_expression",
    }
)

#: Longest doc/signature kept. Docs go into a graph payload and then into an LLM
#: prompt; a multi-paragraph docstring belongs in neither.
MAX_DOC_CHARS = 200
MAX_SIGNATURE_CHARS = 160

_QUOTE_OPEN = re.compile(r"""^[rRbBuUfF]{0,2}('''|\"\"\"|'|")""")
_QUOTE_CLOSE = re.compile(r"""('''|\"\"\"|'|")$""")
_COMMENT_MARK = re.compile(r"^\s*(\*+|//+|#+)\s?")


def _clean_doc(raw: str | None) -> str | None:
    """First sentence of a docstring/JSDoc, quotes and comment markers removed."""
    if not raw:
        return None
    text = _QUOTE_CLOSE.sub("", _QUOTE_OPEN.sub("", raw.strip()))
    text = re.sub(r"\*+/$", "", re.sub(r"^/\*+", "", text.strip()))
    # `@param`/`@returns` lines are structure, not a summary of what it does.
    lines = [_COMMENT_MARK.sub("", line).strip() for line in text.splitlines()]
    body = " ".join(line for line in lines if line and not line.startswith("@")).strip()
    if not body:
        return None
    first = re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0]
    return first[:MAX_DOC_CHARS].strip() or None


def _doc(node: Any, grammar: str) -> str | None:
    """The symbol's own description: Python docstring, or the JSDoc above it."""
    if grammar == "python":
        body = node.child_by_field_name("body")
        if body is None or not body.named_children:
            return None
        first = body.named_children[0]
        if first.type == "expression_statement" and first.named_children:
            first = first.named_children[0]
        return _clean_doc(_text(first)) if first.type == "string" else None

    current = node
    while current is not None:
        previous = _skip_decorators(current.prev_sibling)
        if previous is not None and previous.type == "comment":
            return _clean_doc(_text(previous))
        parent = current.parent
        current = parent if parent is not None and parent.type in _DOC_ASCEND else None
    return None


def _skip_decorators(node: Any) -> Any:
    """Walk back past `@dec()` siblings — in JS/TS they sit between the doc and the symbol."""
    while node is not None and node.type == "decorator":
        node = node.prev_sibling
    return node


def _signature(node: Any) -> str | None:
    """`(a, b=1) -> int`, whitespace-normalized. None for classes and bare arrows."""
    params = node.child_by_field_name("parameters") or node.child_by_field_name("parameter")
    if params is None:
        return None
    signature = _text(params)
    returns = node.child_by_field_name("return_type")
    if returns is not None:
        # Python's field is the type itself; TS wraps it in `: T`.
        signature += f" -> {_text(returns).lstrip(': ').strip()}"
    return re.sub(r"\s+", " ", signature).strip()[:MAX_SIGNATURE_CHARS] or None


def _decorators(node: Any, grammar: str) -> list[str]:
    """Decorator source texts, `@` included — a route decorator is a fact about behavior."""
    if grammar == "python":
        parent = node.parent
        if parent is None or parent.type != "decorated_definition":
            return []
        return [_text(c) for c in parent.children if c.type == "decorator"]

    # JS/TS put decorators before the symbol as siblings, not inside it.
    found: list[str] = []
    previous = node.prev_sibling
    while previous is not None and previous.type == "decorator":
        found.insert(0, _text(previous))
        previous = previous.prev_sibling
    return found


def _extract_symbols(nodes_by_name: dict[str, list[Any]], grammar: str) -> list[dict[str, Any]]:
    """
    Turn `@f`/`@cls`/`@callee` captures into symbol records, each carrying the
    bare callee names appearing inside its span.

    Anonymous functions are dropped as *nodes* but not as context: a call inside
    an unnamed callback attributes to the nearest named ancestor, which is the
    function a reader would say makes the call.
    """
    symbol_nodes = sorted(
        nodes_by_name.get("f", []) + nodes_by_name.get("cls", []),
        key=lambda n: (n.start_byte, -n.end_byte),
    )

    records: dict[int, dict[str, Any]] = {}
    for node in symbol_nodes:
        if len(records) >= MAX_SYMBOLS_PER_FILE:
            break
        name = _symbol_name(node)
        if not name:
            continue
        kind = _symbol_kind(node, grammar)
        record: dict[str, Any] = {
            "name": name,
            "kind": kind,
            "line": node.start_point[0] + 1,
            "end_line": node.end_point[0] + 1,
            "callees": [],
            "doc": _doc(node, grammar),
            "signature": _signature(node),
            "decorators": _decorators(node, grammar),
            "is_async": any(c.type == "async" for c in node.children),
        }
        if kind == "class":
            record["bases"] = _class_bases(node, grammar)
        records[node.id] = record

    for call in nodes_by_name.get("callee", []):
        parent = call.parent
        while parent is not None:
            owner = records.get(parent.id)
            if owner is not None:
                name = _text(call)
                if name not in owner["callees"]:
                    owner["callees"].append(name)
                break
            parent = parent.parent

    return list(records.values())


def _capture_counts(source: str, ext: str, with_symbols: bool = False) -> dict[str, Any] | None:
    """
    Count `@b` (branch) and `@f` (function) captures in one parse, or None if
    this language has no parser / the file is too large to be worth parsing.

    With `with_symbols=True` the same parse also yields a `symbols` list — the
    named functions/classes and the calls inside them. The counts are identical
    either way; the extra captures only feed the symbol records.
    """
    grammar = _EXT_GRAMMAR.get(ext.lower())
    if grammar is None:
        return None

    encoded = source.encode("utf-8", errors="ignore")
    if not encoded.strip():
        return {"b": 0, "f": 0, "symbols": []} if with_symbols else {"b": 0, "f": 0}
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
        # Symbol extraction needs the nodes, so both branches keep them.
        if isinstance(captures, dict):
            nodes_by_name = captures
        else:
            nodes_by_name = {}
            for node, name in captures:
                nodes_by_name.setdefault(name, []).append(node)

        result: dict[str, Any] = {
            "b": len(nodes_by_name.get("b", [])),
            "f": len(nodes_by_name.get("f", [])),
        }
        if with_symbols:
            result["symbols"] = _extract_symbols(nodes_by_name, grammar)
        return result
    except Exception as e:  # pragma: no cover — grammar/ABI failures only
        logger.debug(f"complexity: parse failed for '{ext}' file: {e}")
        return None


def cyclomatic_complexity(source: str, ext: str) -> int | None:
    """
    McCabe complexity for one file, or None if this language has no parser.

    None is meaningful — it is how the caller learns to mark the file
    `size_fallback` instead of publishing a fabricated 1.
    """
    counts = _capture_counts(source, ext)
    return None if counts is None else counts["b"] + 1


def function_count(source: str, ext: str) -> int | None:
    """
    Number of functions defined in one file, or None if this language has no
    parser. Methods and arrow functions count; see the query comments.
    """
    counts = _capture_counts(source, ext)
    return None if counts is None else counts["f"]


def file_complexity(source: str, path: str, with_symbols: bool = False) -> dict[str, Any]:
    """
    Complexity metrics for one file's source.

    Returns `{loc, complexity, functions, complexity_source}` where
    `complexity_source` is either `"cyclomatic"` (measured) or
    `"size_fallback"` (no parser for this language, or the file was too large).
    On a fallback, `complexity` and `functions` are None rather than a guess, so
    a consumer can render them as "unknown" instead of silently mixing units
    into a complexity scale.

    With `with_symbols=True` a fifth key `symbols` carries this file's named
    functions/classes and the calls inside them — empty on a fallback, for the
    same reason `complexity` is None there: we did not read the file.
    """
    _, ext = os.path.splitext(path)
    loc = count_lines_of_code(source)
    counts = _capture_counts(source, ext, with_symbols=with_symbols)

    result = {
        "loc": loc,
        "complexity": None if counts is None else counts["b"] + 1,
        "functions": None if counts is None else counts["f"],
        "complexity_source": "size_fallback" if counts is None else "cyclomatic",
    }
    if with_symbols:
        result["symbols"] = [] if counts is None else counts["symbols"]
    return result
