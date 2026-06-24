"""
test_normalizer.py — Tests for alias resolution and the 4-tier validator.

Covers:
  - Plain normalizers (NODE_TYPE_ALIASES / EDGE_TYPE_ALIASES / ROLE_ALIASES /
    COMPLEXITY_ALIASES) hit canonical targets.
  - normalize_complexity's 5-step fallback chain (int → exact → parse int →
    token → default).
  - validate_section runs Sanitize → AutoFix → Validate → Fatal and returns
    a plain dict (not a Pydantic instance).
  - normalize_node_type targets every key in the frontend's typeColorMap.
"""


class TestNodeTypeAlias:
    """Normalize node types via the alias table."""

    def test_func_maps_to_function(self):
        from codekavi.normalizer import normalize_node_type

        assert normalize_node_type("func") == "function"
        assert normalize_node_type("FN") == "function"

    def test_container_maps_to_services(self):
        from codekavi.normalizer import normalize_node_type

        assert normalize_node_type("container") == "services"
        assert normalize_node_type("deployment") == "services"

    def test_controller_maps_to_routes(self):
        from codekavi.normalizer import normalize_node_type

        assert normalize_node_type("controller") == "routes"
        assert normalize_node_type("router") == "routes"
        assert normalize_node_type("endpoint") == "routes"

    def test_unknown_falls_to_other(self):
        from codekavi.normalizer import normalize_node_type

        assert normalize_node_type("totally-unknown-thing") == "other"

    def test_non_string_input_falls_to_other(self):
        from codekavi.normalizer import normalize_node_type

        assert normalize_node_type(None) == "other"  # type: ignore[arg-type]
        assert normalize_node_type(42) == "other"  # type: ignore[arg-type]


class TestEdgeTypeAlias:
    """Normalize edge types via the alias table."""

    def test_extends_maps_to_inherits(self):
        from codekavi.normalizer import normalize_edge_type

        assert normalize_edge_type("extends") == "inherits"
        assert normalize_edge_type("implements") == "inherits"

    def test_uses_maps_to_calls(self):
        from codekavi.normalizer import normalize_edge_type

        assert normalize_edge_type("uses") == "calls"
        assert normalize_edge_type("invokes") == "calls"

    def test_unknown_falls_to_imports(self):
        from codekavi.normalizer import normalize_edge_type

        assert normalize_edge_type("garbage") == "imports"


class TestRoleAlias:
    """Normalize file profile roles."""

    def test_orchestrator_dedup(self):
        from codekavi.normalizer import normalize_role

        assert normalize_role("coordinator") == "orchestrator"
        assert normalize_role("controller") == "orchestrator"

    def test_repository_aliases(self):
        from codekavi.normalizer import normalize_role

        assert normalize_role("repo") == "repository"
        assert normalize_role("data_access") == "repository"

    def test_unknown_role(self):
        from codekavi.normalizer import normalize_role

        assert normalize_role("alien-intent") == "unknown"


class TestComplexityNormalizer:
    """5-step resolution chain for normalize_complexity."""

    def test_int_passthrough(self):
        from codekavi.normalizer import normalize_complexity

        assert normalize_complexity(5) == 5
        assert normalize_complexity(1) == 1
        assert normalize_complexity(9) == 9

    def test_int_out_of_range_clamped(self):
        from codekavi.normalizer import normalize_complexity

        assert normalize_complexity(0) == 1
        assert normalize_complexity(15) == 9
        assert normalize_complexity(-3) == 1

    def test_exact_alias(self):
        from codekavi.normalizer import normalize_complexity

        assert normalize_complexity("very complex") == 7
        assert normalize_complexity("extremely complex") == 9
        assert normalize_complexity("simple") == 1
        assert normalize_complexity("moderate") == 3

    def test_int_string_parse(self):
        from codekavi.normalizer import normalize_complexity

        assert normalize_complexity("5") == 5  # parse int passthrough

    def test_token_fallback(self):
        from codekavi.normalizer import normalize_complexity

        # "moderate complexity" → token "moderate" matches alias table
        assert normalize_complexity("moderate complexity") == 3
        # Plain "complex" alone → 5 (not 7)
        assert normalize_complexity("complex") == 5

    def test_default_fallback(self):
        from codekavi.normalizer import normalize_complexity

        assert normalize_complexity("totally-nonsense") == 3
        assert normalize_complexity("") == 3
        assert normalize_complexity(None) == 3  # type: ignore[arg-type]


class TestValidateSection:
    """validate_section runs the 4-tier pipeline and returns a plain dict."""

    def test_returns_dict_not_basemodel(self):
        """Plans called this out: validator must return dict, not Pydantic."""
        from pydantic import BaseModel

        from codekavi.normalizer import validate_section

        out = validate_section(
            {"title": "X", "content": "hello", "code_snippets": [], "visualization_type": None,
             "visualization_data": None}
        )
        assert isinstance(out, dict)
        assert not isinstance(out, BaseModel)

    def test_sanitize_strips_whitespace(self):
        from codekavi.normalizer import validate_section

        out = validate_section(
            {"title": "  X  ", "content": "  hello  ", "code_snippets": None,
             "visualization_type": "", "visualization_data": None}
        )
        assert out["title"] == "X"
        assert out["content"] == "hello"
        assert out["code_snippets"] == []
        assert out["visualization_type"] is None

    def test_normalizes_node_types_in_viz(self):
        from codekavi.normalizer import validate_section

        out = validate_section(
            {
                "title": "X",
                "content": "hi",
                "code_snippets": [],
                "visualization_type": "dependency_graph",
                "visualization_data": {
                    "nodes": [{"id": "a", "label": "a", "type": "func"}],
                    "edges": [{"source": "a", "target": "b", "type": "uses"}],
                },
            }
        )
        assert out["visualization_data"]["nodes"][0]["type"] == "function"
        assert out["visualization_data"]["edges"][0]["type"] == "calls"

    def test_tier4_on_empty_content(self):
        from codekavi.normalizer import validate_section

        out = validate_section({"title": "", "content": "", "code_snippets": []})
        assert out["_validation_failed"] is True
        assert out["content"] == ""

    def test_tier4_on_non_dict_input(self):
        from codekavi.normalizer import validate_section

        for bad in [None, "string", 42, ["list"]]:
            out = validate_section(bad)
            assert out["_validation_failed"] is True
            assert out["content"] == ""
            assert out["visualization_data"] is None


class TestTargetCoverage:
    """Every alias target must be a key in the frontend's typeColorMap."""

    FRONTEND_TYPE_COLORS = {
        "module",
        "file",
        "class",
        "component",
        "function",
        "method",
        "external",
        "package",
        "routes",
        "models",
        "services",
        "database",
        "utils",
        "config",
        "tests",
        "other",
    }

    def test_node_alias_targets_match_frontend(self):
        from codekavi.normalizer import NODE_TYPE_ALIASES

        for src, tgt in NODE_TYPE_ALIASES.items():
            assert tgt in self.FRONTEND_TYPE_COLORS, (
                f"NODE_TYPE_ALIASES['{src}'] = '{tgt}' is not in the frontend typeColorMap"
            )
