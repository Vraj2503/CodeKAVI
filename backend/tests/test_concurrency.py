"""
test_concurrency.py — Concurrency regression test.

Fires multiple concurrent /api/analyze requests to verify thread safety and
ensure no cross-contamination occurs (e.g. due to global mutable state).
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from main import app

from codekavi.cache import AnalysisCache
from tests.conftest import SAMPLE_REPO_DIR


@pytest.mark.asyncio
async def test_concurrent_analyses():
    """Fire N concurrent /api/analyze requests and assert no cross-contamination."""
    num_concurrent = 5
    urls = [f"https://github.com/test-owner/repo-{i}" for i in range(num_concurrent)]

    # Manually set app state to avoid dependency on ASGI lifespan execution in testing
    executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="test-codekavi-")
    cache = AnalysisCache()
    app.state.executor = executor
    app.state.cache = cache

    def mock_clone_repo(github_url):
        import uuid

        from codekavi.cloner import parse_github_url

        parsed = parse_github_url(github_url)
        repo_id = f"mock_{uuid.uuid4().hex[:8]}"
        return {
            "repo_id": repo_id,
            "repo_name": parsed["repo"],
            "owner": parsed["owner"],
            "clone_path": SAMPLE_REPO_DIR,
        }

    # Mock clone_repo to point to the fixture repo, and mock index_repository to skip RAG indexing
    try:
        with (
            patch("codekavi.routes.analyze.clone_repo", side_effect=mock_clone_repo),
            patch("codekavi.routes.analyze.index_repository"),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                tasks = []
                for url in urls:
                    tasks.append(client.post("/api/analyze", json={"github_url": url}, timeout=30.0))

                responses = await asyncio.gather(*tasks)

                repo_ids = set()
                for i, response in enumerate(responses):
                    assert response.status_code == 200, f"Request {i} failed: {response.text}"
                    data = response.json()
                    assert data["success"] is True
                    assert "repo_id" in data
                    repo_id = data["repo_id"]

                    # Check for cross-contamination of repo_id
                    assert repo_id not in repo_ids, f"Duplicate repo_id {repo_id} detected!"
                    repo_ids.add(repo_id)

                    # Check that we received the correct repo_name corresponding to this request
                    assert data["repo_name"] == f"repo-{i}"

                # Verify all analyses were saved separately in the state cache
                for repo_id in repo_ids:
                    cached_result = cache.get(repo_id)
                    assert cached_result is not None
                    assert cached_result["repo_name"].startswith("repo-")
    finally:
        executor.shutdown(wait=True)
