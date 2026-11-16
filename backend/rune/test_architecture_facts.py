"""T39: the architecture diagram states facts about the analyzed repo, not about CodeKAVI."""

from types import SimpleNamespace

import pytest

from rune.architecture import build_architecture_manifest
from rune.architecture_models import ArchitectureEvidence, ArchitectureNode
from rune.architecture_rules import format_evidence_sentence, match_technologies
from rune.routes.visualize import _apply_architecture_domain_llm, _build_architecture_domain_prompt


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

    # One point per line, which the inspector shows as one bullet each.
    assert entry.summary.splitlines() == [
        "checkout.py: Takes payment for a cart.",
        "cart.py: Routes: POST /cart, DELETE /cart/{item}.",
        "Spans 2 source files, led by routes/checkout.py.",
    ]


def test_without_facts_it_states_only_the_files():
    """No fixed paragraph fills in (removed 2026-11-16): it described CodeKAVI for every repo."""
    deps, profiles = _shop()
    entry = _node(build_architecture_manifest("r", deps, profiles), "API & Request Entry")
    assert entry.summary == "Spans 2 source files, led by routes/checkout.py."


def test_a_provider_node_says_which_files_use_it_and_what_they_do():
    deps, profiles = _shop()
    redis = _node(build_architecture_manifest("r", deps, profiles, facts=FACTS), "Redis — Cache & Rate Limits")
    assert redis.summary.splitlines() == [
        "Used in this repository by routes/checkout.py.",
        "checkout.py: Takes payment for a cart.",
    ]


def test_the_ai_description_closes_on_the_files_and_nothing_else():
    assert format_evidence_sentence([]) == ""
    assert format_evidence_sentence(["routes/checkout.py"]) == "Implemented in `checkout.py`."
    assert format_evidence_sentence([CHECKOUT, CART, "routes/orders.py"]) == (
        "Implemented in 3 source files, including `checkout.py` and `cart.py`."
    )

    def node():
        return ArchitectureNode(
            id="cap-1",
            label="API & Request Entry",
            kind="gateway",
            group_id="entry",
            summary="Spans 1 source file, led by routes/checkout.py.",
            confidence=0.9,
            evidence=[ArchitectureEvidence(path=CHECKOUT, reason="router")],
        )

    answered, unanswered = node(), node()
    _apply_architecture_domain_llm(SimpleNamespace(nodes=[answered]), {"cap-1": {"role_in_project": "Takes orders"}})
    _apply_architecture_domain_llm(SimpleNamespace(nodes=[unanswered]), {"cap-1": {"role_in_project": " "}})

    assert answered.summary.split("\n\n") == ["Role in project: Takes orders.", "Implemented in `checkout.py`."]
    assert unanswered.summary == "Spans 1 source file, led by routes/checkout.py."  # an empty answer changes nothing


def test_the_llm_prompt_shows_what_each_sample_file_is_for():
    deps, profiles = _shop()
    manifest = build_architecture_manifest("r", deps, profiles, facts=FACTS)

    prompt = _build_architecture_domain_prompt("shop-app", "acme", "", manifest.nodes, facts=FACTS)

    assert "routes/checkout.py (Takes payment for a cart.)" in prompt


def test_a_link_between_components_says_what_crosses_it():
    deps = {
        "adjacency": {"routes/checkout.py": ["services/payments.py"], "services/payments.py": []},
        "edges": [
            {"source": "routes/checkout.py", "target": "services/payments.py", "specifiers": ["charge", "refund"]}
        ],
        "file_imports": {},
    }
    profiles = [
        {"path": "routes/checkout.py", "role": "router", "importance_score": 90},
        {"path": "services/payments.py", "role": "core_module", "importance_score": 80},
    ]
    manifest = build_architecture_manifest("r", deps, profiles)

    assert [edge.via for edge in manifest.edges] == [["charge", "refund"]]
