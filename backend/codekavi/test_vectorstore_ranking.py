"""Milvus/Zilliz COSINE distance IS similarity — higher is closer. A prior bug
sorted ascending (as if distance were a distance), returning the LEAST
relevant chunk as Context 1. Guards against that regressing."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from codekavi.vectorstore import ZillizClient


def _hit(score: float, path: str):
    return SimpleNamespace(
        distance=score,
        entity=SimpleNamespace(
            get=lambda k, d=None, _f={"file_path": path, "role": "code", "language": "python", "layer": "backend", "start_line": 1, "end_line": 2, "text": "x", "provider": "cloudflare"}: (
                _f.get(k, d)
            )
        ),
    )


@pytest.mark.asyncio
async def test_search_orders_by_descending_cosine_similarity():
    client = ZillizClient()
    client.collection = SimpleNamespace(
        load=lambda: None,
        search=lambda **kw: [[_hit(0.3, "low.py"), _hit(0.9, "high.py"), _hit(0.6, "mid.py")]],
    )

    with patch("codekavi.embedding.CloudflareEmbedding.embed_texts", new=AsyncMock(return_value=[[0.1] * 8])):
        results = await client.search("query", repo_id="a" * 12, limit=5)

    assert [r["file_path"] for r in results] == ["high.py", "mid.py", "low.py"]
