from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from main import app

from codekavi.auth import verify_supabase_token
from codekavi.limiter import limiter


@pytest.mark.asyncio
async def test_health_endpoint():
    """Verify that the health check endpoint returns 200 and correct status."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_auth_protection_on_protected_routes():
    """Verify that protected routes return 401 Unauthorized when no JWT is provided."""
    # Temporarily remove JWT override to test real auth protection
    old_override = app.dependency_overrides.pop(verify_supabase_token, None)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/analyze", json={"github_url": "https://github.com/foo/bar"})
            assert response.status_code == 401
    finally:
        if old_override:
            app.dependency_overrides[verify_supabase_token] = old_override


@pytest.mark.asyncio
async def test_input_validation_rejections():
    """Verify that SSRF, traversal, or invalid host URLs are rejected with 400 Bad Request."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Invalid host name
        response = await client.post("/api/analyze", json={"github_url": "https://google.com/foo/bar"})
        assert response.status_code == 400
        assert "Unsupported repository host" in response.text

        # SSRF / credentials check
        response = await client.post("/api/analyze", json={"github_url": "https://user:password@github.com/foo/bar"})
        assert response.status_code == 400
        assert "credentials" in response.text.lower()


@pytest.mark.asyncio
async def test_rate_limiting_triggered():
    """Verify that the rate limiter returns 429 Too Many Requests on consecutive calls."""
    # Temporarily enable rate limiter for this specific test
    limiter.enabled = True

    # Reset/clear limiter storage for consistency
    if hasattr(app.state, "limiter"):
        app.state.limiter.reset()

    def mock_clone_repo(github_url):
        return {
            "repo_id": "test_rate",
            "repo_name": "bar",
            "owner": "foo",
            "clone_path": "dummy_path",
        }

    try:
        with (
            patch("codekavi.routes.analyze.clone_repo", side_effect=mock_clone_repo),
            patch("codekavi.routes.analyze.traverse_repo", return_value={"files": []}),
            patch("codekavi.routes.analyze.index_repository"),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # We make 5 requests which should fit within the 5/minute limit
                for i in range(5):
                    response = await client.post("/api/analyze", json={"github_url": "https://github.com/foo/bar"})
                    assert response.status_code != 429, f"Failed on request {i}: {response.text}"

                # 6th request triggers rate limiter
                response = await client.post("/api/analyze", json={"github_url": "https://github.com/foo/bar"})
                assert response.status_code == 429
    finally:
        limiter.enabled = False
