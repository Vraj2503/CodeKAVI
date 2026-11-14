"""
file_facts.py — what each file is for, in one line (T33).

Most views showed a file as its name and some counts. A purpose already written in
the source (module docstring or header comment) exists for 35% of CodeKAVI's source
files and 1% of React's, so a file without one gets a line built from facts the
parse already has: the routes it serves, the components or hooks it defines, or the
names it defines. `purpose_source` says which ("doc" or "derived"), so the UI can
mark derived lines and T34 knows which files need a written sentence.
"""

from __future__ import annotations

import re
from typing import Any

from rune.symbol_graph import http_route

MAX_PURPOSE_CHARS = 140

_HOOK_NAME = re.compile(r"^use[A-Z0-9]")
_COMPONENT_EXTENSIONS = (".tsx", ".jsx")


def _cap(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_PURPOSE_CHARS else text[: MAX_PURPOSE_CHARS - 1].rstrip() + "…"


def _without_path_prefix(doc: str, path: str) -> str:
    """'routes/chat.py — RAG chat endpoint.' -> 'RAG chat endpoint.' (the view already shows the path)."""
    name = path.rsplit("/", 1)[-1]
    stem = name.rsplit(".", 1)[0]
    for prefix in (path, *(path.split("/", i)[-1] for i in range(1, path.count("/") + 1)), name, stem):
        for separator in (" \u2014 ", " \u2013 ", " - ", ": "):  # em dash, en dash, hyphen, colon
            if doc.startswith(prefix + separator):
                return doc[len(prefix) + len(separator) :].strip()
    return doc


def _listing(names: list[str], limit: int) -> str:
    shown = ", ".join(names[:limit])
    return shown + (", …" if len(names) > limit else "")


def _top_level(symbols: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Functions and classes not nested in another symbol, in source order."""
    spans = [(s.get("line") or 0, s.get("end_line") or 0) for s in symbols]
    top = []
    for symbol, (start, end) in zip(symbols, spans, strict=True):
        if symbol.get("kind") == "method":
            continue
        nested = any(
            (other_start, other_end) != (start, end) and other_start <= start and end <= other_end
            for other_start, other_end in spans
        )
        if not nested:
            top.append(symbol)
    return top


def file_routes(symbols: list[dict[str, Any]]) -> list[str]:
    """The HTTP routes a file's handlers serve, from their decorators ("POST /chat/{repo_id}")."""
    return list(dict.fromkeys(r for s in symbols if (r := http_route(s.get("decorators")))))


def derived_purpose(path: str, symbols: list[dict[str, Any]]) -> str | None:
    """A purpose line from facts, for a file that doesn't describe itself."""
    routes = file_routes(symbols)
    if routes:
        return _cap("Routes: " + _listing(routes, 3))

    names = [s["name"] for s in _top_level(symbols) if s.get("name") and not s["name"].startswith("_")]
    if path.lower().endswith(_COMPONENT_EXTENSIONS):
        components = [n for n in names if n[:1].isupper()]
        if components:
            return _cap(("Component: " if len(components) == 1 else "Components: ") + _listing(components, 3))
    hooks = [n for n in names if _HOOK_NAME.match(n)]
    if hooks:
        return _cap(("Hook: " if len(hooks) == 1 else "Hooks: ") + _listing(hooks, 3))
    if names:
        return _cap("Defines: " + _listing(names, 4))
    return None


def purpose_of(path: str, doc: str | None, symbols: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """(purpose, purpose_source): the file's own description, else one derived from facts."""
    if doc:
        text = _without_path_prefix(doc, path)
        if text:
            return _cap(text), "doc"
    derived = derived_purpose(path, symbols)
    return (derived, "derived") if derived else (None, None)
