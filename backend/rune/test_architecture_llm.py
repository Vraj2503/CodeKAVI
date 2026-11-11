import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from rune.architecture_models import ArchitectureRequest, ArchitectureNode, ArchitectureEvidence, ArchitectureGraphData, ArchitectureRepository, ArchitectureDiagnostics
from rune.routes.visualize import (
    _build_architecture_domain_prompt,
    _validate_architecture_domain_llm,
    _apply_architecture_domain_llm,
    visualize_architecture_v2,
)


def test_build_architecture_domain_prompt():
    node = ArchitectureNode(
        id="cap-api",
        label="API & Request Entry",
        kind="gateway",
        group_id="entry",
        summary="Static summary",
        confidence=0.9,
        evidence=[ArchitectureEvidence(path="routes/checkout.py", reason="router")],
    )
    prompt = _build_architecture_domain_prompt(
        repo_name="shop-app",
        owner="test-org",
        project_summary="An e-commerce platform for selling clothes.",
        nodes=[node],
    )
    assert "shop-app" in prompt
    assert "An e-commerce platform" in prompt
    assert "cap-api" in prompt
    assert "routes/checkout.py" in prompt
    assert "business problem" in prompt.lower()


def test_validate_architecture_domain_llm():
    node1 = MagicMock()
    node1.id = "cap-1"
    node1.label = "API & Request Entry"
    manifest = MagicMock()
    manifest.nodes = [node1]

    good_parsed = {
        "project_domain": "Online retail store",
        "components": {
            "cap-1": {
                "role_in_project": "Handles checkout",
                "business_problem_solved": "Processes payments and carts",
            }
        },
    }
    assert _validate_architecture_domain_llm(good_parsed, manifest) is True

    # Matching by label also works
    by_label = {
        "components": {
            "API & Request Entry": {
                "role_in_project": "Handles checkout",
            }
        }
    }
    assert _validate_architecture_domain_llm(by_label, manifest) is True

    bad_parsed = {"components": {"unknown-id": {}}}
    assert _validate_architecture_domain_llm(bad_parsed, manifest) is False

    invalid_type = "not a dict"
    assert _validate_architecture_domain_llm(invalid_type, manifest) is False


def test_apply_architecture_domain_llm():
    node = ArchitectureNode(
        id="cap-1",
        label="API & Request Entry",
        kind="gateway",
        group_id="entry",
        summary="Old summary",
        confidence=0.9,
        evidence=[ArchitectureEvidence(path="routes/checkout.py", reason="router")],
    )
    manifest = MagicMock()
    manifest.nodes = [node]

    components = {
        "cap-1": {
            "role_in_project": "Public checkout gateway",
            "business_problem_solved": "Allows shoppers to purchase items",
            "key_workflows": "Processes credit card orders",
            "project_safeguards": "Enforces PCI-DSS tokenization",
        }
    }
    _apply_architecture_domain_llm(manifest, components)

    assert "Role in project: Public checkout gateway" in node.summary
    assert "Business problem solved: Allows shoppers to purchase items" in node.summary
    assert "Key project workflows: Processes credit card orders" in node.summary
    assert "checkout.py" in node.summary


@pytest.mark.asyncio
async def test_visualize_architecture_v2_llm_enrichment_and_caching():
    repo_id = "test-repo-llm-123"
    fake_result = {
        "repo_id": repo_id,
        "repo_name": "shop-app",
        "owner": "test-org",
        "file_profiles": [
            {
                "path": "routes/checkout.py",
                "role": "router",
                "role_confidence": 0.95,
                "importance_score": 90,
                "language": "Python",
            }
        ],
        "dep_data": {
            "adjacency": {},
            "file_imports": {},
        },
    }

    mock_cache = MagicMock()
    mock_cache.get.return_value = fake_result
    mock_cache.set = MagicMock()

    mock_tracker = MagicMock()
    mock_tracker.check_quota.return_value = True

    mock_provider = MagicMock()
    mock_provider.name = "mock-gemini"
    llm_response = json.dumps({
        "project_domain": "Online retail checkout application",
        "components": {
            "cap-entry:gateway:API & Request Entry": {
                "role_in_project": "Handles storefront customer checkout",
                "business_problem_solved": "Collects cart items and executes order transactions",
                "key_workflows": "Validates cart items and submits to payment gateway",
                "project_safeguards": "Applies rate limiting and input sanitization",
            }
        }
    })
    mock_provider.generate_with_usage = AsyncMock(return_value=(llm_response, {"total_tokens": 150}))

    with patch("rune.routes.visualize._load_repo", AsyncMock(return_value=(fake_result, "/fake/path"))), \
         patch("rune.quota.get_token_tracker", return_value=mock_tracker), \
         patch("rune.llm.providers.get_provider", return_value=mock_provider):

        body = ArchitectureRequest(enrichment={"mode": "llm"})
        mock_request = MagicMock()

        # 1. First call: should invoke LLM and enrich
        resp1 = await visualize_architecture_v2(
            request=mock_request,
            repo_id=repo_id,
            body=body,
            cache=mock_cache,
            user_id="user-123",
        )

        assert resp1.data.diagnostics.is_llm_enriched is True
        assert resp1.data.diagnostics.cached is False
        assert mock_provider.generate_with_usage.call_count == 1

        api_node = next(n for n in resp1.data.nodes if n.label == "API & Request Entry")
        assert "Business problem solved: Collects cart items" in api_node.summary
        assert "Role in project: Handles storefront customer checkout" in api_node.summary

        # Verify cached in fake_result
        assert "architecture_llm" in fake_result

        # 2. Second call: should hit cache without calling provider again
        resp2 = await visualize_architecture_v2(
            request=mock_request,
            repo_id=repo_id,
            body=body,
            cache=mock_cache,
            user_id="user-123",
        )

        assert resp2.data.diagnostics.is_llm_enriched is True
        assert resp2.data.diagnostics.cached is True
        # Provider should still have call_count == 1 (not called again)
        assert mock_provider.generate_with_usage.call_count == 1


@pytest.mark.asyncio
async def test_visualize_architecture_v2_llm_failure_falls_back_gracefully():
    repo_id = "test-repo-llm-fail"
    fake_result = {
        "repo_id": repo_id,
        "repo_name": "shop-app",
        "owner": "test-org",
        "file_profiles": [
            {
                "path": "routes/checkout.py",
                "role": "router",
                "role_confidence": 0.95,
                "importance_score": 90,
                "language": "Python",
            }
        ],
        "dep_data": {
            "adjacency": {},
            "file_imports": {},
        },
    }

    mock_cache = MagicMock()
    mock_tracker = MagicMock()
    mock_tracker.check_quota.return_value = True

    mock_provider = MagicMock()
    mock_provider.name = "mock-gemini"
    mock_provider.generate_with_usage = AsyncMock(side_effect=RuntimeError("API Network Timeout"))

    with patch("rune.routes.visualize._load_repo", AsyncMock(return_value=(fake_result, "/fake/path"))), \
         patch("rune.quota.get_token_tracker", return_value=mock_tracker), \
         patch("rune.llm.providers.get_provider", return_value=mock_provider):

        body = ArchitectureRequest(enrichment={"mode": "llm"})
        mock_request = MagicMock()

        resp = await visualize_architecture_v2(
            request=mock_request,
            repo_id=repo_id,
            body=body,
            cache=mock_cache,
            user_id="user-123",
        )

        # Fallback reason recorded, static manifest returned without 500 error
        assert resp.data.diagnostics.is_llm_enriched is False
        assert resp.data.diagnostics.fallback_reason == "llm_failed"
        assert len(resp.data.nodes) == 1
        assert "API & Request Entry" == resp.data.nodes[0].label
