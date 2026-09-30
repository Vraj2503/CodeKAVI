"""
Tests for rune/complexity.py.

The point of these is less "does McCabe arithmetic work" and more "does the
module ever report a number it did not measure" — a fabricated complexity is
the one failure mode that makes the treemap actively misleading.
"""

import pytest

from rune.complexity import (
    MAX_PARSE_BYTES,
    count_lines_of_code,
    cyclomatic_complexity,
    file_complexity,
    function_count,
)

# ── Baseline ──


def test_straight_line_code_scores_one():
    """No decision points means exactly one path through the file."""
    assert cyclomatic_complexity("x = 1\ny = 2\nprint(x + y)\n", ".py") == 1


def test_empty_file_scores_one():
    assert cyclomatic_complexity("", ".py") == 1
    assert cyclomatic_complexity("\n\n   \n", ".py") == 1


# ── Python decision points ──


@pytest.mark.parametrize(
    "source,expected",
    [
        ("if x:\n    pass\n", 2),
        ("if x:\n    pass\nelif y:\n    pass\n", 3),
        ("for i in r:\n    pass\n", 2),
        ("while x:\n    pass\n", 2),
        ("try:\n    pass\nexcept E:\n    pass\n", 2),
        ("y = 1 if x else 2\n", 2),
        ("y = a and b\n", 2),
        # `a and b and c` nests two operators — three operands, two decisions.
        ("y = a and b and c\n", 3),
        ("y = [i for i in r if i]\n", 2),
    ],
)
def test_python_branch_kinds(source, expected):
    assert cyclomatic_complexity(source, ".py") == expected


def test_python_else_is_not_a_branch():
    """`else` adds no decision — the `if` already accounted for both paths."""
    with_else = cyclomatic_complexity("if x:\n    pass\nelse:\n    pass\n", ".py")
    without = cyclomatic_complexity("if x:\n    pass\n", ".py")
    assert with_else == without == 2


def test_python_assert_is_not_counted():
    """Deliberate: JS has no equivalent, so counting it would make Python
    files read hotter than JS files on a chart that shares one color scale."""
    assert cyclomatic_complexity("assert x\n", ".py") == 1


def test_keyword_inside_string_is_not_a_branch():
    """The whole reason this is a parser and not a regex."""
    assert cyclomatic_complexity('msg = "if x and y then for while"\n', ".py") == 1
    assert cyclomatic_complexity("# if x and y\nx = 1\n", ".py") == 1


# ── JS / TS decision points ──


@pytest.mark.parametrize("ext", [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"])
def test_every_js_family_extension_parses(ext):
    assert cyclomatic_complexity("if (a) { b(); }\n", ext) == 2


@pytest.mark.parametrize(
    "source,expected",
    [
        ("if (a) { b(); }", 2),
        ("for (const x of xs) { f(x); }", 2),
        ("for (let i = 0; i < n; i++) { f(i); }", 2),
        ("while (a) { b(); }", 2),
        ("do { b(); } while (a);", 2),
        ("try { a(); } catch (e) { b(); }", 2),
        ("const y = a ? 1 : 2;", 2),
        ("const y = a && b;", 2),
        ("const y = a || b;", 2),
        ("const y = a ?? b;", 2),
    ],
)
def test_js_branch_kinds(source, expected):
    assert cyclomatic_complexity(source, ".js") == expected


def test_switch_default_is_not_a_branch():
    """`case` arms branch; `default` is the fall-through the switch already had."""
    two_cases = "switch (a) { case 1: break; case 2: break; }"
    plus_default = "switch (a) { case 1: break; case 2: break; default: break; }"
    assert cyclomatic_complexity(two_cases, ".js") == 3
    assert cyclomatic_complexity(plus_default, ".js") == 3


def test_tsx_uses_the_tsx_grammar():
    """The TypeScript grammar reads `<div>` as a type assertion and loses the
    body; only the TSX grammar sees the conditional inside the element."""
    source = "const A = () => <div>{a && b ? 1 : 2}</div>;\n"
    assert cyclomatic_complexity(source, ".tsx") == 3


# ── Honest fallbacks ──


def test_unparsed_language_returns_none_not_a_guess():
    assert cyclomatic_complexity("func main() { if x {} }", ".go") is None
    assert cyclomatic_complexity("fn main() { if x {} }", ".rs") is None
    assert cyclomatic_complexity("# heading\n", ".md") is None


def test_oversized_file_is_not_parsed():
    """A minified bundle is not a maintenance hotspot reading, and parsing it
    would let one generated file dominate the color scale."""
    assert cyclomatic_complexity("x = 1\n" * (MAX_PARSE_BYTES // 3), ".py") is None


def test_file_complexity_marks_the_fallback():
    measured = file_complexity("if x:\n    pass\n", "app/main.py")
    assert measured == {"loc": 2, "complexity": 2, "functions": 0, "complexity_source": "cyclomatic"}

    fallback = file_complexity("func main() {}\n", "cmd/main.go")
    assert fallback["complexity"] is None
    assert fallback["functions"] is None
    assert fallback["complexity_source"] == "size_fallback"
    # LOC is still real even when complexity is not.
    assert fallback["loc"] == 1


# ── Function count ──


def test_function_count_includes_methods_and_arrows():
    py = "def a():\n    pass\n\nclass C:\n    def m(self):\n        pass\n"
    assert function_count(py, ".py") == 2

    js = "function a() {}\nconst b = () => 1;\nclass C { m() {} }\n"
    assert function_count(js, ".js") == 3


def test_function_count_is_none_without_a_parser():
    """Same honesty rule as complexity: no parser means no number, not zero."""
    assert function_count("func main() {}\n", ".go") is None
    assert function_count("x = 1\n", ".py") == 0


def test_syntax_errors_still_yield_a_count():
    """tree-sitter recovers locally instead of giving up, so a file with a typo
    — or Python 2 syntax — still gets a usable reading rather than a fallback."""
    py2 = file_complexity('print "hello"\nif x and y:\n    pass\n', "legacy.py")
    assert py2["complexity_source"] == "cyclomatic"
    assert py2["complexity"] > 1


# ── LOC ──


def test_loc_counts_non_blank_lines_only():
    assert count_lines_of_code("a\n\n  \nb\n") == 2
    assert count_lines_of_code("") == 0
    # No trailing newline still counts the last line.
    assert count_lines_of_code("a\nb") == 2


# ── Cross-language sanity ──


def test_branchy_file_outscores_a_longer_linear_one():
    """The property the treemap actually sells: color tracks control flow, not
    length. A long geometry-heavy file must read cooler than a short branchy one."""
    long_linear = "\n".join(f"const p{i} = compute({i});" for i in range(200))
    short_branchy = "\n".join(f"if (a{i} && b{i}) {{ f({i}); }}" for i in range(20))

    linear_cx = cyclomatic_complexity(long_linear, ".ts")
    branchy_cx = cyclomatic_complexity(short_branchy, ".ts")

    assert linear_cx == 1
    assert branchy_cx == 41
    assert count_lines_of_code(long_linear) > count_lines_of_code(short_branchy)


# ── Symbols ──


def _symbols(source: str, path: str) -> dict[str, dict]:
    return {s["name"]: s for s in file_complexity(source, path, with_symbols=True)["symbols"]}


def test_symbols_are_off_by_default():
    """The complexity callers must not pay for symbol extraction."""
    assert "symbols" not in file_complexity("def f():\n    pass\n", "a.py")


def test_python_symbols_carry_kind_bases_and_callees():
    src = (
        "class A(Base, mod.Other):\n    def m(self):\n        helper()\n        self.other()\ndef helper():\n    pass\n"
    )
    syms = _symbols(src, "a.py")

    assert syms["A"]["kind"] == "class"
    assert syms["A"]["bases"] == ["Base", "Other"]  # dotted base keeps its tail
    assert syms["m"]["kind"] == "method"
    assert syms["m"]["callees"] == ["helper", "other"]
    assert syms["helper"]["kind"] == "function"
    assert syms["m"]["line"] == 2


def test_js_names_come_from_the_assignment_when_the_function_is_anonymous():
    src = "const f = () => { g(); [1].map(v => h(v)); };\nclass A extends ns.Base {\n  m() { f(); }\n}\n"
    syms = _symbols(src, "b.tsx")

    assert set(syms) == {"f", "A", "m"}
    # A call inside an unnamed callback belongs to the nearest named ancestor.
    assert set(syms["f"]["callees"]) == {"g", "map", "h"}
    assert syms["A"]["bases"] == ["Base"]
    assert syms["m"]["kind"] == "method"


def test_unparsed_files_report_no_symbols_rather_than_guessing():
    assert file_complexity("func main() {}\n", "a.go", with_symbols=True)["symbols"] == []
    assert file_complexity("", "a.py", with_symbols=True)["symbols"] == []


def test_python_symbols_carry_doc_signature_decorators_and_async():
    src = (
        '@router.post("/analyze")\n'
        "async def analyze(repo_id: str, deep: bool = False) -> dict:\n"
        '    """Run the pipeline. A second sentence that is not a summary."""\n'
        "    pass\n"
    )
    sym = _symbols(src, "a.py")["analyze"]

    assert sym["doc"] == "Run the pipeline."  # first sentence only
    assert sym["signature"] == "(repo_id: str, deep: bool = False) -> dict"
    assert sym["decorators"] == ['@router.post("/analyze")']
    assert sym["is_async"] is True


def test_a_symbol_without_a_docstring_reports_none_not_empty_string():
    """None means "the author wrote none"; "" would read as an empty summary."""
    syms = _symbols("def f(x):\n    pass\n\n\nclass C:\n    pass\n", "a.py")

    assert syms["f"]["doc"] is None
    assert syms["f"]["is_async"] is False
    assert syms["C"]["doc"] is None
    assert syms["C"]["signature"] is None  # a class has no parameter list


def test_js_docs_come_from_the_comment_above_the_symbol():
    src = (
        "/** Fetch the thing.\n * @param a ignored\n */\n"
        "export const load = async (a: string): Promise<number> => { return 1; };\n"
        "class A {\n"
        "  /** A method. */\n"
        "  @dec()\n"
        "  m(x, y = 2) {}\n"
        "}\n"
    )
    syms = _symbols(src, "a.ts")

    # The comment sits three levels up from the arrow, above the declaration.
    assert syms["load"]["doc"] == "Fetch the thing."  # `@param` lines are structure, not summary
    assert syms["load"]["signature"] == "(a: string) -> Promise<number>"
    assert syms["load"]["is_async"] is True
    # A decorator sits between the doc and the method; both still land.
    assert syms["m"]["doc"] == "A method."
    assert syms["m"]["decorators"] == ["@dec()"]


def test_a_long_docstring_is_capped():
    src = 'def f():\n    """' + "word " * 200 + '"""\n    pass\n'
    assert len(_symbols(src, "a.py")["f"]["doc"]) <= 200


def test_symbol_extraction_does_not_move_the_counts():
    """The regression that matters: widening the query must not shift any
    complexity or function count, since importance_score weights functions."""
    src = "class A:\n    def m(self):\n        if x and y:\n            f()\n"
    plain = file_complexity(src, "a.py")
    with_syms = file_complexity(src, "a.py", with_symbols=True)

    assert plain["complexity"] == with_syms["complexity"] == 3
    assert plain["functions"] == with_syms["functions"] == 1
