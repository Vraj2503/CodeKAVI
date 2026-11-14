"""T39: the architecture diagram states facts about the analyzed repo, not about CodeKAVI."""

import pytest

from rune.architecture import build_architecture_manifest
from rune.architecture_rules import match_technologies
from rune.routes.visualize import _build_architecture_domain_prompt


def _products(*hints: str) -> set[str]:
    return {f"{t.vendor} — {t.product}" for t in match_technologies(set(hints))}


@pytest.mark.parametrize(
    ("hints", "expected"),
    [
        (("upgrade_utils", "jpg_tools"), set()),  # `pg` used to match inside both
        (("github_actions_helper",), set()),  # `github` used to match any mention
        (("pg",), {"PostgreSQL — Database"}),
        (("pg/lib/client",), {"PostgreSQL — Database"}),  # a submodule of the package
        (("google.genai",), {"Google — Gemini"}),  # Python imports name the module, not the pip package
        (("google.generativeai.types",), {"Google — Gemini"}),
        (("groq",), {"Groq — Inference API"}),  # not "Llama": Groq serves several models
        (("redis.asyncio",), {"Redis — Cache & Rate Limits"}),
    ],
)
def test_technologies_are_matched_by_whole_package_name(hints, expected):
    assert _products(*hints) == expected


CHECKOUT, CART = "routes/checkout.py", "routes/cart.py"


def _shop():
    profiles = [
        {"path": CHECKOUT, "role": "router", "role_confidence": 0.9, "importance_score": 90, "language": "Python"},
        {"path": CART, "role": "router", "role_confidence": 0.9, "importance_score": 60, "language": "Python"},
    ]
    deps = {"adjacency": {CHECKOUT: [], CART: []}, "file_imports": {CHECKOUT: [{"raw": "redis"}]}}
    return deps, profiles


FACTS = {
    CHECKOUT: {"purpose": "Takes payment for a cart.", "purpose_source": "doc", "symbols": []},
    CART: {"purpose": "Routes: POST /cart, DELETE /cart/{item}", "purpose_source": "derived", "symbols": []},
}


def _node(manifest, label):
    return next(n for n in manifest.nodes if n.label == label)


def test_a_capability_is_described_by_its_member_files():
    deps, profiles = _shop()
    entry = _node(build_architecture_manifest("r", deps, profiles, facts=FACTS), "API & Request Entry")

    assert entry.summary.startswith(
        "Role in project: API & Request Entry spans 2 source files, led by routes/checkout.py."
    )
    assert "checkout.py: Takes payment for a cart." in entry.summary
    assert "cart.py: Routes: POST /cart, DELETE /cart/{item}." in entry.summary
    assert "repository analysis" not in entry.summary.lower()  # the fixed paragraph described CodeKAVI


def test_without_facts_the_fixed_paragraph_is_still_the_fallback():
    deps, profiles = _shop()
    entry = _node(build_architecture_manifest("r", deps, profiles), "API & Request Entry")
    assert "Role in project:" in entry.summary and "spans 2 source files" not in entry.summary


def test_a_provider_node_says_which_files_use_it():
    deps, profiles = _shop()
    redis = _node(build_architecture_manifest("r", deps, profiles, facts=FACTS), "Redis — Cache & Rate Limits")
    assert redis.summary.endswith("Used in this repository by routes/checkout.py.")


def test_the_llm_prompt_shows_what_each_sample_file_is_for():
    deps, profiles = _shop()
    manifest = build_architecture_manifest("r", deps, profiles, facts=FACTS)

    prompt = _build_architecture_domain_prompt("shop-app", "acme", "", manifest.nodes, facts=FACTS)

    assert "routes/checkout.py (Takes payment for a cart.)" in prompt
