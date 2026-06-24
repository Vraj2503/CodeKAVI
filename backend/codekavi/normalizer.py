"""
codekavi.normalizer — LLM output normalization and 4-tier validation.

LLM responses vary wildly in terminology: one says "func", another says
"function_declaration", a third says "method". The frontend silently
trusts whatever string the LLM emits for `type` fields. This module:

  1. Defines canonical alias maps (NODE_TYPE_ALIASES, EDGE_TYPE_ALIASES,
     ROLE_ALIASES, COMPLEXITY_ALIASES) that resolve LLM-flavored strings
     to the canonical set the frontend renders in `DependencyGraph.tsx`.
  2. Exposes plain normalizer functions for each alias class.
  3. Provides `validate_section(raw)` — a 4-tier pipeline:
       Tier 1 (Sanitize) — replace None / strip whitespace
       Tier 2 (AutoFix)  — apply alias maps, default missing fields
       Tier 3 (Validate) — Pydantic model_validate, downgrade on failure
       Tier 4 (Fatal)    — content missing → mark `_validation_failed`

`validate_section` always returns a plain dict so callers do not need
to roundtrip through Pydantic models.
"""

from __future__ import annotations

import logging
from typing import Any

from codekavi.config import detect_layer as _detect_layer

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# Alias tables
# ──────────────────────────────────────────────────────────────────────
#
# Every alias target below MUST be a key in the frontend's `typeColorMap`
# (see frontend/components/report/viz/DependencyGraph.tsx lines 31-48).
# Adding a target that the frontend doesn't know about makes the node
# fall back to `#8b949e` (gray "other").


# Node type aliases. Targets: module, file, class, component, function,
# method, external, package, routes, models, services, database, utils,
# config, tests, other.
NODE_TYPE_ALIASES: dict[str, str] = {
    # code-shape aliases → function
    "func": "function",
    "fn": "function",
    "method": "function",
    "function_declaration": "function",
    "lambda": "function",
    # code-shape aliases → component
    "interface": "component",
    "struct": "component",
    "type": "component",
    # code-shape aliases → module
    "mod": "module",
    "pkg": "module",
    "package": "module",
    "lib": "module",
    "file": "file",
    # code-shape aliases → services
    "container": "services",
    "deployment": "services",
    "pod": "services",
    "service": "services",
    # code-shape aliases → routes
    "controller": "routes",
    "router": "routes",
    "endpoint": "routes",
    "route": "routes",
    "api": "routes",
    # code-shape aliases → models
    "model": "models",
    "schema": "models",
    "entity": "models",
    # code-shape aliases → database
    "db": "database",
    "table": "database",
    # code-shape aliases → utils
    "helper": "utils",
    "util": "utils",
    "utility": "utils",
    "helpers": "utils",
    # code-shape aliases → config
    "cfg": "config",
    "setting": "config",
    "env": "config",
    # code-shape aliases → tests
    "test": "tests",
    "spec": "tests",
    "test_file": "tests",
    # code-shape aliases → classes (canonical frontend type)
    "class": "class",
    "method_definition": "method",
    # everything left falls through to detect_layer / "other"
    "external": "external",
    "unknown": "other",
}


# Edge type aliases. The DependencyGraph frontend treats edge type
# loosely (it doesn't color-code edges) so this stays relatively small
# — we only canonicalize for downstream consumers.
EDGE_TYPE_ALIASES: dict[str, str] = {
    "extends": "inherits",
    "implements": "inherits",
    "invokes": "calls",
    "invoke": "calls",
    "uses": "calls",
    "calls": "calls",
    "import": "imports",
    "imports_from": "imports",
    "requires": "imports",
    "depends_on": "imports",
    "relates_to": "related",
    "related_to": "related",
    "publishes_to": "publishes",
    "subscribes_to": "subscribes",
}


# File-profile role aliases (used by classify_files output and orchestrator
# prompt rendering). Targets match values produced by the classifier.
ROLE_ALIASES: dict[str, str] = {
    "orchestrator": "orchestrator",
    "coordinator": "orchestrator",
    "controller": "orchestrator",
    "router": "orchestrator",
    "service": "service_layer",
    "service_layer": "service_layer",
    "utility": "utility",
    "util": "utility",
    "helper": "utility",
    "repository": "repository",
    "repo": "repository",
    "data_access": "repository",
    "middleware": "middleware",
    "config": "config",
    "test": "test",
    "type_definition": "type_definition",
    "documentation": "documentation",
    "leaf": "leaf",
    "build": "build",
    "barrel": "barrel",
    "data": "data",
    "shared_utility": "shared_utility",
    "internal_helper": "internal_helper",
    "entry_point": "entry_point",
    "core_module": "core_module",
}


# Complexity aliases → int score.
# Resolution order in `normalize_complexity()`:
#   1. exact key match in this table (case-insensitive)
#   2. parse as int (handles "5")
#   3. token-level alias match (handles "moderate complexity" or "3/5")
#   4. default to 3 (moderate)
COMPLEXITY_ALIASES: dict[str, int] = {
    "simple": 1,
    "trivial": 1,
    "easy": 1,
    "low": 1,
    "moderate": 3,
    "medium": 3,
    "standard": 3,
    "intermediate": 3,
    "med": 3,
    "complex": 5,
    "advanced": 5,
    "hard": 5,
    "sophisticated": 5,
    "high": 5,
    "very complex": 7,
    "highly complex": 7,
    "extremely complex": 9,
}


# Default fallback for all normalizers when no alias matches.
DEFAULT_NODE_TYPE = "other"
DEFAULT_EDGE_TYPE = "imports"
DEFAULT_ROLE = "unknown"
DEFAULT_COMPLEXITY = 3


# ──────────────────────────────────────────────────────────────────────
# Plain normalizers
# ──────────────────────────────────────────────────────────────────────


def normalize_node_type(raw: Any) -> str:
    """Return canonical node type. Falls back to detect_layer() then 'other'."""
    if not isinstance(raw, str):
        return DEFAULT_NODE_TYPE
    key = raw.strip().lower()
    if not key:
        return DEFAULT_NODE_TYPE
    if key in NODE_TYPE_ALIASES:
        return NODE_TYPE_ALIASES[key]
    # delegate to the canonical layer detector (config.py) which has the
    # path-keyword fallbacks; only if the raw value looks like a path
    if "/" in key or "\\" in key or key.endswith((".py", ".js", ".ts", ".go", ".rs")):
        return _detect_layer(key)
    return DEFAULT_NODE_TYPE


def normalize_edge_type(raw: Any) -> str:
    """Return canonical edge type string. Falls back to 'imports'."""
    if not isinstance(raw, str):
        return DEFAULT_EDGE_TYPE
    key = raw.strip().lower()
    return EDGE_TYPE_ALIASES.get(key, DEFAULT_EDGE_TYPE)


def normalize_role(raw: Any) -> str:
    """Return canonical file role string. Falls back to 'unknown'."""
    if not isinstance(raw, str):
        return DEFAULT_ROLE
    key = raw.strip().lower().replace("-", "_").replace(" ", "_")
    return ROLE_ALIASES.get(key, DEFAULT_ROLE)


def normalize_complexity(raw: Any) -> int:
    """Return canonical int complexity score (1‒9). Never raises.

    Resolution order:
      1. int passthrough if already numeric
      2. exact key in COMPLEXITY_ALIASES (case/whitespace normalized)
      3. parsed int from string
      4. token-level alias lookup (e.g. "moderate complexity" → "moderate" → 3)
      5. default 3 (moderate)
    """
    # Step 1: int passthrough.
    if isinstance(raw, int) and not isinstance(raw, bool):
        if 1 <= raw <= 9:
            return raw
        # clamp out-of-range ints
        return max(1, min(9, raw))
    if isinstance(raw, bool):
        return DEFAULT_COMPLEXITY  # booleans are not complexity scores

    if not isinstance(raw, str):
        return DEFAULT_COMPLEXITY

    text = raw.strip().lower()
    if not text:
        return DEFAULT_COMPLEXITY

    # Step 2: exact key.
    if text in COMPLEXITY_ALIASES:
        return COMPLEXITY_ALIASES[text]

    # Step 3: direct int parse (handles "5").
    try:
        parsed = int(text)
        if 1 <= parsed <= 9:
            return parsed
        return max(1, min(9, parsed))
    except ValueError:
        pass

    # Step 4: token-level alias lookup.
    # Split on whitespace and common delimiters so "moderate complexity",
    # "3/5", "complex (high)" all resolve to a known alias.
    tokens = (
        text.replace(",", " ")
        .replace("/", " ")
        .replace("(", " ")
        .replace(")", " ")
        .split()
    )
    for token in tokens:
        if token in COMPLEXITY_ALIASES:
            return COMPLEXITY_ALIASES[token]
        try:
            parsed = int(token)
            if 1 <= parsed <= 9:
                return parsed
        except ValueError:
            continue

    # Step 5: default.
    return DEFAULT_COMPLEXITY


# ──────────────────────────────────────────────────────────────────────
# 4-tier validation pipeline
# ──────────────────────────────────────────────────────────────────────


def _sanitize(raw: dict[str, Any]) -> dict[str, Any]:
    """Tier 1 — coerce structural defects into valid shapes (no info loss)."""
    cleaned: dict[str, Any] = {}
    cleaned["title"] = (raw.get("title") or "").strip() if isinstance(raw.get("title"), str) else ""
    content = raw.get("content")
    if isinstance(content, str):
        cleaned["content"] = content.strip()
    else:
        cleaned["content"] = "" if content is None else str(content).strip()

    code_snippets = raw.get("code_snippets")
    cleaned["code_snippets"] = code_snippets if isinstance(code_snippets, list) else []

    viz_type = raw.get("visualization_type")
    if isinstance(viz_type, str) and viz_type.strip():
        cleaned["visualization_type"] = viz_type.strip()
    else:
        cleaned["visualization_type"] = None

    cleaned["visualization_data"] = raw.get("visualization_data") or None
    return cleaned


def _autofix_viz(cleaned: dict[str, Any]) -> dict[str, Any]:
    """Tier 2 — normalize node/edge types in visualization_data."""
    viz = cleaned.get("visualization_data")
    if not isinstance(viz, dict):
        return cleaned

    # Normalize nodes: list of {"id", "label", "type", ...}
    nodes = viz.get("nodes")
    if isinstance(nodes, list):
        for n in nodes:
            if isinstance(n, dict) and "type" in n:
                n["type"] = normalize_node_type(n["type"])

    # Normalize edges: list of {"source", "target", "type", ...}
    edges = viz.get("edges")
    if isinstance(edges, list):
        for e in edges:
            if isinstance(e, dict) and "type" in e:
                e["type"] = normalize_edge_type(e["type"])

    # Mindmap JSON-mode shape: {"root": {...}} with nested children whose
    # `name` doubles as type — normalize via role alias to keep canonical
    # top-level vocabulary ("Tech Stack" stays "config"-flavored, etc.).
    if "root" in viz and isinstance(viz["root"], dict):
        _normalize_mindmap_node(viz["root"])

    # Tree/charts shape: {"name": "...", "children": [...]}
    if "children" in viz and "name" in viz and "nodes" not in viz:
        _normalize_treenode(viz)

    cleaned["visualization_data"] = viz
    return cleaned


def _normalize_mindmap_node(node: Any) -> None:
    """In-place normalization of a mindmap-style tree."""
    if not isinstance(node, dict):
        return
    if "children" in node and isinstance(node["children"], list):
        for child in node["children"]:
            _normalize_mindmap_node(child)


def _normalize_treenode(node: Any) -> None:
    """In-place normalization of treemap/radial tree shape."""
    if not isinstance(node, dict):
        return
    if "children" in node and isinstance(node["children"], list):
        for child in node["children"]:
            _normalize_treenode(child)


def _validate_with_pydantic(cleaned: dict[str, Any]) -> dict[str, Any]:
    """Tier 3 — run Pydantic validation; downgrade `visualization_data` on
    schema failure rather than rejecting the whole section."""
    from codekavi.schemas import SectionResponse

    try:
        SectionResponse.model_validate(cleaned)
    except Exception as e:  # pydantic.ValidationError or similar
        logger.warning("SectionResponse validation failed: %s; downgrading visualization_data", e)
        cleaned["visualization_data"] = None
    return cleaned


def validate_section(raw: Any) -> dict[str, Any]:
    """Run the full 4-tier pipeline. Always returns a plain dict.

    The returned dict always contains the keys:
        title, content, code_snippets, visualization_type, visualization_data
    If Tier 4 fires, an extra sentinel key `_validation_failed=True` is
    added so the caller can decide whether to emit a warning or degrade.
    """
    if not isinstance(raw, dict):
        # Tier 4: completely malformed input.
        return {
            "title": "",
            "content": "",
            "code_snippets": [],
            "visualization_type": None,
            "visualization_data": None,
            "_validation_failed": True,
        }

    cleaned = _sanitize(raw)
    cleaned = _autofix_viz(cleaned)
    cleaned = _validate_with_pydantic(cleaned)

    # Tier 4: fatal — content missing after sanitize.
    if not cleaned["content"]:
        cleaned["_validation_failed"] = True

    return cleaned


def normalize_viz_data(viz_data: Any) -> dict[str, Any] | None:
    """Convenience wrapper: take JSON-mode viz_data dict straight through
    _autofix_viz for orchestrator hot paths."""
    if not isinstance(viz_data, dict):
        return None
    return _autofix_viz({"visualization_data": viz_data})["visualization_data"]
