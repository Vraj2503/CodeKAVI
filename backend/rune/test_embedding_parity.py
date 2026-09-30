"""
test_embedding_parity.py — Phase 1 gate: local ONNX bge-large-en-v1.5 reproduces Cloudflare.

Opt-in. Deselected by default; run with:

    pytest rune/test_embedding_parity.py -m integration

Needs CLOUDFLARE_* in backend/.env, onnxruntime + tokenizers, and the model already in the
Hugging Face cache (this test never downloads 1.3 GB):

    python -c "from huggingface_hub import hf_hub_download as d; [d('BAAI/bge-large-en-v1.5', f) for f in ('onnx/model.onnx', 'tokenizer.json', '1_Pooling/config.json')]"

Costs about 1% of the Cloudflare free tier's daily budget per run.

    Cloudflare @cf/baai/bge-large-en-v1.5            local ONNX, same weights
    ┌──────────────────────────────────┐              ┌──────────────────────────┐
    │ pooling omitted ─▶ MEAN, pad     │   == 1.0000  │ masked mean              │
    │   tokens counted in the average  │ ◀──────────▶ │   (batch-invariant)      │
    │  (vectors shift with batch-mates)│  solo only   │                          │
    │ pooling="cls" ─▶ CLS token       │   == 1.0000  │ CLS token (token 0)      │
    │   (pad-immune)                   │ ◀──────────▶ │                          │
    └──────────────────────────────────┘              └──────────────────────────┘
       mean and cls vectors are NOT interchangeable: a provider key must name the pooling.

Why cosine >= 0.9999 on every input and not only recall@5 >= 0.9: in the spike, an int8 model at
cosine ~0.97 dropped recall@5 to ~0.8. A floor of 0.9999 on every vector leaves no room for that
degradation to hide, and the ranking check below confirms retrieval directly.

The embedder below is deliberately minimal. T8 replaces it with rune.embedding.LocalEmbedding.
"""

import asyncio
import json
from pathlib import Path

import numpy as np
import pytest

pytestmark = pytest.mark.integration

ort = pytest.importorskip("onnxruntime")
tokenizers = pytest.importorskip("tokenizers")
hub = pytest.importorskip("huggingface_hub")

REPO = "BAAI/bge-large-en-v1.5"
MAX_LENGTH = 512
CF_CHAR_CUT = 2000  # rune/embedding.py truncates to this before sending
PARITY_MIN_COS = 0.9999
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

RUNE = Path(__file__).parent
CHUNK_SOURCES = ["indexer.py", "index_status.py", "cache.py", "vectorstore.py", "embedding.py"]
QUERIES = [
    "where are embeddings inserted into the vector store",
    "how is the index status recorded on the analysis result",
    "what happens when the cloudflare api returns a 429 rate limit",
    "how does the analysis cache fall back from memory to redis",
    "how are file line numbers computed for each chunk",
    "what validates that a repo id is safe to put in a query filter",
]


def _cached(filename: str) -> str:
    try:
        return hub.hf_hub_download(REPO, filename, local_files_only=True)
    except Exception:
        pytest.skip(f"{REPO}/{filename} is not in the Hugging Face cache; fetch it first (see module docstring)")


def _norm(m) -> np.ndarray:
    m = np.asarray(m, dtype=np.float32)
    return m / np.clip(np.linalg.norm(m, axis=-1, keepdims=True), 1e-12, None)


def _cos(a, b) -> np.ndarray:
    return np.sum(_norm(a) * _norm(b), axis=-1)


class _LocalBge:
    """fp32 ONNX bge-large-en-v1.5 with explicit pooling. Inputs get the same 2000-char cut as Cloudflare."""

    def __init__(self) -> None:
        self.session = ort.InferenceSession(_cached("onnx/model.onnx"), providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.tokenizer = tokenizers.Tokenizer.from_file(_cached("tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=MAX_LENGTH)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")

    def token_count(self, text: str) -> int:
        self.tokenizer.no_truncation()
        n = len(self.tokenizer.encode(text[:CF_CHAR_CUT]).ids)
        self.tokenizer.enable_truncation(max_length=MAX_LENGTH)
        return n

    def embed(self, texts: list[str], pooling: str) -> np.ndarray:
        encs = self.tokenizer.encode_batch([t[:CF_CHAR_CUT] for t in texts])
        ids = np.array([e.ids for e in encs], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)}
        hidden = self.session.run(None, {k: v for k, v in feed.items() if k in self.inputs})[0]
        if pooling == "cls":
            pooled = hidden[:, 0, :]
        else:  # masked mean: pad positions excluded, so the result can't depend on batch-mates
            m = mask[:, :, None].astype(hidden.dtype)
            pooled = (hidden * m).sum(axis=1) / m.sum(axis=1)
        return _norm(pooled)


@pytest.fixture(scope="module")
def cloudflare():
    from rune.embedding import CloudflareEmbedding
    from rune.settings import settings

    if not (settings.cloudflare_account_id and settings.cloudflare_api_token):
        pytest.skip("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not configured")
    return CloudflareEmbedding()


@pytest.fixture(scope="module")
def local() -> _LocalBge:
    return _LocalBge()


@pytest.fixture(scope="module")
def chunks(local) -> list[str]:
    texts = [(RUNE / name).read_text(encoding="utf-8")[:1500] for name in CHUNK_SOURCES]
    dense = (RUNE / "analyzer.py").read_text(encoding="utf-8")[:CF_CHAR_CUT]
    assert local.token_count(dense) > MAX_LENGTH, "the truncation case must exceed 512 tokens; pick denser text"
    return [*texts, dense]


@pytest.fixture(scope="module")
def cf_vectors(cloudflare, chunks):
    """Cloudflare vectors for both poolings, fetched once. Mean goes through the production code path,
    one text per request, because Cloudflare's mean pooling leaks padding from batch-mates."""
    from rune.embedding import close_cloudflare_session, get_cloudflare_session

    async def fetch():
        try:
            mean = [(await cloudflare.embed_texts([t]))[0] for t in [*chunks, *QUERIES]]
            session = await get_cloudflare_session()
            headers = {"Authorization": f"Bearer {cloudflare.api_token}"}
            payload = {"text": [t[:CF_CHAR_CUT] for t in [*chunks, *QUERIES]], "pooling": "cls"}
            async with session.post(cloudflare.endpoint, headers=headers, json=payload) as resp:
                body = await resp.json()
            assert body.get("success"), body.get("errors")
            return np.asarray(mean), np.asarray(body["result"]["data"])
        finally:
            await close_cloudflare_session()

    mean, cls = asyncio.run(fetch())
    n = len(chunks)
    return {"mean": (mean[:n], mean[n:]), "cls": (cls[:n], cls[n:])}


def test_the_model_declares_cls_pooling_not_cloudflares_default():
    config = json.loads(Path(_cached("1_Pooling/config.json")).read_text(encoding="utf-8"))
    assert config["pooling_mode_cls_token"] is True
    assert config["pooling_mode_mean_tokens"] is False
    assert config["word_embedding_dimension"] == 1024


def test_local_embeddings_do_not_depend_on_batch_mates(local, chunks):
    short, long = chunks[0][:200], chunks[-1]
    for pooling in ("mean", "cls"):
        alone = local.embed([short], pooling)[0]
        batched = local.embed([short, long], pooling)[0]
        assert _cos(alone, batched) >= 0.99999, pooling


@pytest.mark.parametrize("pooling", ["mean", "cls"])
def test_local_chunks_match_cloudflare_including_past_512_tokens(local, chunks, cf_vectors, pooling):
    cf_chunks, _ = cf_vectors[pooling]
    cos = _cos(local.embed(chunks, pooling), cf_chunks)
    assert cos.min() >= PARITY_MIN_COS, dict(
        zip([*CHUNK_SOURCES, "analyzer.py (>512 tokens)"], cos.round(6), strict=True)
    )


@pytest.mark.parametrize("pooling", ["mean", "cls"])
def test_queries_match_cloudflare_with_no_prefix_on_either_side(local, cf_vectors, pooling):
    _, cf_queries = cf_vectors[pooling]
    assert _cos(local.embed(QUERIES, pooling), cf_queries).min() >= PARITY_MIN_COS
    # The check has teeth: adding bge's retrieval prefix on one side alone breaks parity.
    prefixed = local.embed([BGE_QUERY_PREFIX + q for q in QUERIES], pooling)
    assert _cos(prefixed, cf_queries).max() < PARITY_MIN_COS


@pytest.mark.parametrize("pooling", ["mean", "cls"])
def test_a_local_index_ranks_cloudflare_queries_like_cloudflare_does(local, chunks, cf_vectors, pooling):
    cf_chunks, cf_queries = cf_vectors[pooling]
    local_chunks = local.embed(chunks, pooling)
    reference = np.argsort(-(_norm(cf_queries) @ _norm(cf_chunks).T), axis=1)[:, :3]
    candidate = np.argsort(-(_norm(cf_queries) @ local_chunks.T), axis=1)[:, :3]
    assert (reference == candidate).all()


def test_mean_and_cls_vectors_are_not_interchangeable(cf_vectors):
    mean_chunks, _ = cf_vectors["mean"]
    cls_chunks, _ = cf_vectors["cls"]
    assert _cos(mean_chunks, cls_chunks).max() < 0.995  # spike max: 0.985
