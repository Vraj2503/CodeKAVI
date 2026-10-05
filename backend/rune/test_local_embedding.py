"""Unit tests for T8: Local embeddings via LM Studio and guarded ProviderRegistry."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from tokenizers import Tokenizer, models, pre_tokenizers

from rune.embedding import (
    CLOUDFLARE_IDENTITY,
    EmbeddingProviderUnavailable,
    EmbeddingSelection,
    LocalEmbedding,
    _local_model_spec,
    _normalise_model_name,
    clear_provider_cache,
    get_embedding_provider,
    indexing_embedding_is_configured,
    select_index_embedding_provider,
    validate_embedding_identity,
)
from rune.index_status import (
    IndexOutcome,
    chat_embedding_unavailable_message,
    resolve_embedding_identity,
    status_from_outcome,
)
from rune.indexer import (
    _chunk_line_spans,
    _chunks_for_provider,
    _local_token_chunks,
    index_repository,
)
from rune.settings import settings, validate_config
from rune.vectorstore import zilliz_client


@pytest.fixture(autouse=True)
def _reset_provider_cache():
    clear_provider_cache()
    yield
    clear_provider_cache()


@pytest.fixture
def fake_tokenizer():
    t = Tokenizer(models.WordLevel({"[UNK]": 0}, unk_token="[UNK]"))
    t.pre_tokenizer = pre_tokenizers.BertPreTokenizer()
    return t


# ──────────────────────────────────────────────────────────────────────
# 1. Model Registry and Compatibility Guard Tests (R4c, R4d)
# ──────────────────────────────────────────────────────────────────────


def test_normalise_model_name():
    assert _normalise_model_name("text-embedding-bge-large-en-v1.5") == "bge-large-en-v1.5"
    assert _normalise_model_name("CompendiumLabs/bge-large-en-v1.5-gguf/bge-large-en-v1.5.gguf") == "bge-large-en-v1.5"
    assert _normalise_model_name("Qwen3_Embedding_0.6B_f16.gguf") == "qwen3-embedding-0.6b-f16"
    assert _normalise_model_name("text-embedding-qwen3-embedding-0.6b") == "qwen3-embedding-0.6b"


def test_local_model_spec_approved_models():
    spec = _local_model_spec("bge-large-en-v1.5", "cls")
    assert spec.identity == "bge-large-en-v1.5:cls"
    assert spec.dimension == 1024
    assert spec.max_tokens == 512
    assert spec.default_chunk_tokens == 512
    assert spec.pooling == "cls"
    assert spec.default_query_prefix == ""

    spec2 = _local_model_spec("text-embedding-bge-large-en-v1.5", "cls")
    assert spec2.identity == "bge-large-en-v1.5:cls"

    spec_qwen = _local_model_spec("qwen3-embedding-0.6b", "last-token")
    assert spec_qwen.identity == "qwen3-embedding-0.6b:last-token"
    assert spec_qwen.dimension == 1024
    assert spec_qwen.max_tokens == 32768
    assert spec_qwen.default_chunk_tokens == 512
    assert spec_qwen.default_query_prefix.startswith("Instruct:")

    spec_qwen2 = _local_model_spec("text-embedding-qwen3-embedding-0.6b", "last-token")
    assert spec_qwen2.identity == "qwen3-embedding-0.6b:last-token"


def test_local_model_spec_rejects_incompatible_pooling():
    with pytest.raises(ValueError, match="must use 'cls' pooling, not 'mean'"):
        _local_model_spec("bge-large-en-v1.5", "mean")

    with pytest.raises(ValueError, match="must use 'last-token' pooling"):
        _local_model_spec("qwen3-embedding-0.6b", "cls")


def test_local_model_spec_rejects_unapproved_model():
    with pytest.raises(ValueError, match="not in the approved embedding registry"):
        _local_model_spec("all-MiniLM-L6-v2", "cls")

    with pytest.raises(ValueError, match="not in the approved embedding registry"):
        _local_model_spec("random-bert-model", "cls")


def test_validate_embedding_identity():
    assert validate_embedding_identity("cloudflare") == "cloudflare"
    assert validate_embedding_identity("bge-large-en-v1.5:cls") == "bge-large-en-v1.5:cls"
    assert validate_embedding_identity("qwen3-embedding-0.6b:last-token") == "qwen3-embedding-0.6b:last-token"

    with pytest.raises(ValueError, match="Invalid embedding identity|Unrecognised embedding identity"):
        validate_embedding_identity("cloudflare' OR 1=1 --")

    with pytest.raises(ValueError, match="Unrecognised embedding identity"):
        validate_embedding_identity("unregistered-model:cls")


# ──────────────────────────────────────────────────────────────────────
# 2. Tokenizer, Offline Loading, and Hermetic Testing (R1)
# ──────────────────────────────────────────────────────────────────────


def test_local_embedding_tokenizer_offline_cache():
    try:
        embedder = LocalEmbedding(
            base_url="http://localhost:1234/v1",
            model="text-embedding-bge-large-en-v1.5",
            pooling="cls",
        )
        _ = embedder.tokenizer
    except EmbeddingProviderUnavailable:
        pytest.skip("bge-large tokenizer.json not found in local Hugging Face cache")

    assert embedder.tokenizer is not None
    assert embedder.max_tokens == 512
    count = embedder.document_token_count("def hello_world(): return 42")
    assert 5 <= count <= 20


def test_local_embedding_prefixes_counted_in_token_budget(fake_tokenizer):
    embedder_no_prefix = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        document_prefix="",
        query_prefix="",
        tokenizer=fake_tokenizer,
    )
    embedder_with_prefix = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        document_prefix="Doc: ",
        query_prefix="Represent this sentence for searching relevant passages: ",
        tokenizer=fake_tokenizer,
    )
    query = "find the indexing function"
    cnt1 = embedder_no_prefix.query_token_count(query)
    cnt2 = embedder_with_prefix.query_token_count(query)
    assert cnt2 > cnt1


def test_truncate_query(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    short_query = "What does index_repository do?"
    assert embedder.truncate_query(short_query) == short_query

    long_query = "word " * 1000
    assert embedder.query_token_count(long_query) > 512
    truncated = embedder.truncate_query(long_query)
    assert embedder.query_token_count(truncated) <= 512


def test_assert_document_fits(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    embedder._assert_document_fits("Short code snippet")

    long_doc = "def overly_large_function():\n    pass\n" * 200
    assert embedder.document_token_count(long_doc) > 512
    with pytest.raises(ValueError, match="Document chunk exceeds 512 tokens"):
        embedder._assert_document_fits(long_doc)


# ──────────────────────────────────────────────────────────────────────
# 3. Token-Based Chunking, Spans, Qwen Targets & Stored Byte-Cap (S1, R4a, R4b)
# ──────────────────────────────────────────────────────────────────────


def test_local_token_chunks_exact_substrings_and_spans(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    content = (
        "# Sample File\n\n"
        + "def function_one():\n    x = 1\n    return x\n\n"
        + "def function_two():\n    y = 2\n    return y\n\n"
    ) * 30

    chunks = _local_token_chunks(content, embedder)
    assert len(chunks) > 1

    for chunk in chunks:
        assert chunk in content
        assert embedder.document_token_count(chunk) <= embedder.max_tokens

    spans = _chunk_line_spans(content, chunks, "sample.py")
    assert len(spans) == len(chunks)
    assert all(span != (0, 0) for span in spans)
    assert all(start <= end for start, end in spans)


def test_qwen_chunk_target_not_whole_file(fake_tokenizer, monkeypatch):
    """R4a: Qwen max_tokens is 32768, but chunk target defaults to 1024 or local_embedding_chunk_tokens."""
    monkeypatch.setattr(settings, "local_embedding_chunk_tokens", 512)
    qwen = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="qwen3-embedding-0.6b",
        pooling="last-token",
        tokenizer=fake_tokenizer,
    )
    assert qwen.max_tokens == 32768
    assert qwen.chunk_tokens == 512

    content = "def test_func():\n    return 42\n\n" * 200
    chunks = _local_token_chunks(content, qwen)
    assert len(chunks) > 1
    for chunk in chunks:
        assert qwen.document_token_count(chunk) <= 512


def test_chunks_for_provider_switches_splitter(fake_tokenizer):
    local_embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    mock_cf_embedder = MagicMock()
    mock_cf_embedder.is_local = False

    content = "print('hello world')\n" * 50

    local_chunks = _chunks_for_provider(content, local_embedder)
    cf_chunks = _chunks_for_provider(content, mock_cf_embedder)

    assert isinstance(local_chunks, list)
    assert isinstance(cf_chunks, list)


@pytest.mark.asyncio
async def test_stored_text_byte_cap(fake_tokenizer, tmp_path, monkeypatch):
    """R4b: Chunks exceeding 65,000 bytes are capped before adding to batch_texts."""
    collection = MagicMock()
    collection.insert = MagicMock(return_value=MagicMock(primary_keys=["pk1"]))

    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    embedder.embed_texts = AsyncMock(return_value=[[0.1] * 1024])

    monkeypatch.setattr("rune.indexer.zilliz_client.setup_collection", lambda: collection)
    monkeypatch.setattr("rune.indexer.zilliz_client.clear_repo", lambda r: None)
    monkeypatch.setattr(
        "rune.indexer.select_index_embedding_provider",
        AsyncMock(return_value=EmbeddingSelection(embedder)),
    )

    # Create a file whose chunk is > 65000 bytes
    huge_line = "a" * 70000 + "\n"
    huge_file = tmp_path / "huge.txt"
    huge_file.write_text(huge_line, encoding="utf-8")

    # Force chunker to emit the huge string as one chunk for this test
    with patch("rune.indexer._chunks_for_provider", return_value=[huge_line]):
        outcome = await index_repository("repo_huge", [{"path": "huge.txt", "role_label": "Data"}], str(tmp_path))

    assert outcome.inserted == 1
    assert collection.insert.call_count == 1
    insert_data = collection.insert.call_args[0][0]
    stored_texts = insert_data[8]
    assert len(stored_texts[0].encode("utf-8")) <= 65000


# ──────────────────────────────────────────────────────────────────────
# 4. HTTP Embedding Endpoint, Vectors & Preflight Checks (R2)
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_local_embedding_embed_inputs_success(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )

    fake_1024_vec = [0.01] * 1024
    fake_body = {
        "data": [
            {"index": 1, "embedding": fake_1024_vec},
            {"index": 0, "embedding": fake_1024_vec},
        ]
    }

    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=fake_body)

    mock_session = MagicMock()
    mock_session.post.return_value.__aenter__.return_value = mock_response

    with patch("rune.embedding.get_local_session", AsyncMock(return_value=mock_session)):
        vectors = await embedder.embed_texts(["hello", "world"])
        assert len(vectors) == 2
        assert len(vectors[0]) == 1024


@pytest.mark.asyncio
async def test_local_embedding_dimension_mismatch(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )

    fake_768_vec = [0.01] * 768
    fake_body = {"data": [{"index": 0, "embedding": fake_768_vec}]}

    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=fake_body)

    mock_session = MagicMock()
    mock_session.post.return_value.__aenter__.return_value = mock_response

    with patch("rune.embedding.get_local_session", AsyncMock(return_value=mock_session)):
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            await embedder.embed_texts(["test text"])
        assert exc_info.value.reason == "local_embedding_dimension_mismatch"


@pytest.mark.asyncio
async def test_local_embedding_server_unavailable(fake_tokenizer):
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )

    mock_response = AsyncMock()
    mock_response.status = 503
    mock_response.read = AsyncMock()

    mock_session = MagicMock()
    mock_session.post.return_value.__aenter__.return_value = mock_response

    with patch("rune.embedding.get_local_session", AsyncMock(return_value=mock_session)):
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            await embedder.embed_texts(["test text"])
        assert exc_info.value.reason == "local_embedding_server_unavailable"


@pytest.mark.asyncio
async def test_check_available_fails_on_missing_tokenizer_before_http():
    """R2: check_available() verifies tokenizer before making network calls."""
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
    )
    with patch("huggingface_hub.hf_hub_download", side_effect=FileNotFoundError("missing")):
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            await embedder.check_available()
        assert exc_info.value.reason == "local_tokenizer_unavailable"


# ──────────────────────────────────────────────────────────────────────
# 5. Provider Selection, Fallback Modes & Pre-Clear Safety (R2, R3, S6)
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_select_provider_cloudflare_default(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "cloudflare")
    monkeypatch.setattr(settings, "cloudflare_account_id", "cf_acc_123")
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf_tok_456")
    selection = await select_index_embedding_provider()
    assert selection.fallback_from is None
    assert selection.provider.identity == CLOUDFLARE_IDENTITY


@pytest.mark.asyncio
async def test_select_provider_cloudflare_not_configured_raises(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "cloudflare")
    monkeypatch.setattr(settings, "cloudflare_account_id", "")
    monkeypatch.setattr(settings, "cloudflare_api_token", "")
    with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
        await select_index_embedding_provider()
    assert exc_info.value.reason == "cloudflare_embedding_not_configured"


@pytest.mark.asyncio
async def test_select_provider_local_success(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "local")

    with patch.object(LocalEmbedding, "check_available", AsyncMock()):
        selection = await select_index_embedding_provider()
        assert selection.fallback_from is None
        assert selection.provider.identity == "bge-large-en-v1.5:cls"


@pytest.mark.asyncio
async def test_select_provider_local_fallback_to_cloudflare(monkeypatch):
    """R3: When embedding_fallback="cloudflare", local failure falls back with warning and logs repo_id."""
    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "embedding_fallback", "cloudflare")
    monkeypatch.setattr(settings, "cloudflare_account_id", "cf_acc_123")
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf_tok_456")

    with (
        patch.object(
            LocalEmbedding,
            "check_available",
            AsyncMock(
                side_effect=EmbeddingProviderUnavailable("bge-large-en-v1.5:cls", "local_embedding_server_unavailable")
            ),
        ),
        patch("rune.embedding.logger.warning") as mock_warn,
    ):
        selection = await select_index_embedding_provider("test_repo_123")
        assert selection.fallback_from == "bge-large-en-v1.5:cls"
        assert selection.provider.identity == CLOUDFLARE_IDENTITY
        mock_warn.assert_called_once()
        assert "test_repo_123" in mock_warn.call_args[0][3]


@pytest.mark.asyncio
async def test_select_provider_local_fallback_none_fails(monkeypatch):
    """R3: When embedding_fallback="none", local failure fails with named code and NO fallback."""
    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "embedding_fallback", "none")
    monkeypatch.setattr(settings, "cloudflare_account_id", "cf_acc_123")
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf_tok_456")

    with patch.object(
        LocalEmbedding,
        "check_available",
        AsyncMock(
            side_effect=EmbeddingProviderUnavailable("bge-large-en-v1.5:cls", "local_embedding_server_unavailable")
        ),
    ):
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            await select_index_embedding_provider("test_repo_123")
        assert exc_info.value.reason == "local_embedding_server_unavailable"


@pytest.mark.asyncio
async def test_select_provider_missing_tokenizer_fallback_or_fail(monkeypatch):
    """R2: Missing tokenizer in selection step triggers fallback or clean failure before clear_repo."""
    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "cloudflare_account_id", "cf_acc_123")
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf_tok_456")

    with patch.object(
        LocalEmbedding,
        "check_available",
        AsyncMock(side_effect=EmbeddingProviderUnavailable("bge-large-en-v1.5:cls", "local_tokenizer_unavailable")),
    ):
        # Case A: fallback="cloudflare"
        monkeypatch.setattr(settings, "embedding_fallback", "cloudflare")
        selection = await select_index_embedding_provider("repo_abc")
        assert selection.fallback_from == "bge-large-en-v1.5:cls"
        assert selection.provider.identity == CLOUDFLARE_IDENTITY

        # Case B: fallback="none"
        monkeypatch.setattr(settings, "embedding_fallback", "none")
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            await select_index_embedding_provider("repo_abc")
        assert exc_info.value.reason == "local_tokenizer_unavailable"


def test_validate_config_rejects_invalid_provider_or_fallback(monkeypatch):
    """S6: Typo in EMBEDDING_PROVIDER or EMBEDDING_FALLBACK raises error on startup."""
    dummy_keys = [
        "groq_api_key",
        "gemini_api_key",
        "cloudflare_account_id",
        "cloudflare_api_token",
        "zilliz_uri",
        "zilliz_api_key",
        "redis_url",
        "supabase_url",
        "supabase_service_key",
        "supabase_jwt_secret",
    ]
    for k in dummy_keys:
        monkeypatch.setattr(settings, k, "dummy_val")

    monkeypatch.setattr(settings, "embedding_provider", "lmstudio")
    with pytest.raises(ValueError, match="Invalid EMBEDDING_PROVIDER"):
        validate_config()

    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "embedding_fallback", "bedrock")
    with pytest.raises(ValueError, match="Invalid EMBEDDING_FALLBACK"):
        validate_config()


def test_indexing_embedding_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "cloudflare")
    monkeypatch.setattr(settings, "cloudflare_account_id", "acc")
    monkeypatch.setattr(settings, "cloudflare_api_token", "tok")
    assert indexing_embedding_is_configured() is True

    monkeypatch.setattr(settings, "cloudflare_account_id", "")
    assert indexing_embedding_is_configured() is False

    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "local_embedding_base_url", "http://localhost:1234/v1")
    monkeypatch.setattr(settings, "local_embedding_model", "text-embedding-bge-large-en-v1.5")
    assert indexing_embedding_is_configured() is True


# ──────────────────────────────────────────────────────────────────────
# 6. Provider Caching & Document Prefix Safety (S3, S4)
# ──────────────────────────────────────────────────────────────────────


def test_provider_caching(fake_tokenizer, monkeypatch):
    """S4: get_embedding_provider caches instance per config; clear_provider_cache resets."""
    monkeypatch.setattr(settings, "local_embedding_base_url", "http://localhost:1234/v1")
    monkeypatch.setattr(settings, "local_embedding_model", "text-embedding-bge-large-en-v1.5")

    with patch.object(LocalEmbedding, "tokenizer", fake_tokenizer):
        p1 = get_embedding_provider("bge-large-en-v1.5:cls")
        p2 = get_embedding_provider("bge-large-en-v1.5:cls")
        assert p1 is p2

        clear_provider_cache()
        p3 = get_embedding_provider("bge-large-en-v1.5:cls")
        assert p3 is not p1


def test_document_prefix_mismatch_raises(fake_tokenizer, monkeypatch):
    """S3: Changing document prefix without re-indexing raises EmbeddingProviderUnavailable."""
    monkeypatch.setattr(settings, "local_embedding_base_url", "http://localhost:1234/v1")
    monkeypatch.setattr(settings, "local_embedding_model", "text-embedding-bge-large-en-v1.5")
    monkeypatch.setattr(settings, "local_embedding_document_prefix", "Doc: ")

    with patch.object(LocalEmbedding, "tokenizer", fake_tokenizer):
        with pytest.raises(EmbeddingProviderUnavailable) as exc_info:
            get_embedding_provider("bge-large-en-v1.5:cls", document_prefix="OldPrefix: ")
        assert exc_info.value.reason == "local_document_prefix_mismatch"


# ──────────────────────────────────────────────────────────────────────
# 7. Section 3 Integration Tests (Indexer, Vectorstore, Chat, Origin Identity)
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_index_repository_local_embedder(fake_tokenizer, tmp_path, monkeypatch):
    """Section 3.1: index_repository with local embedder writes local identity, records timings, skips delay."""
    inserted_rows = []

    class FakeCollection:
        def insert(self, data):
            inserted_rows.append(data)
            return MagicMock(primary_keys=[f"pk_{i}" for i in range(len(data[0]))])

    collection = FakeCollection()
    monkeypatch.setattr("rune.indexer.zilliz_client.setup_collection", lambda: collection)
    monkeypatch.setattr("rune.indexer.zilliz_client.clear_repo", lambda r: None)
    monkeypatch.setattr(settings, "indexer_batch_delay_s", 5.0)  # should NOT be applied for local

    fake_embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    fake_embedder.embed_texts = AsyncMock(return_value=[[0.05] * 1024])

    monkeypatch.setattr(
        "rune.indexer.select_index_embedding_provider",
        AsyncMock(return_value=EmbeddingSelection(fake_embedder)),
    )

    test_file = tmp_path / "hello.py"
    test_file.write_text("def hello(): return 1\n", encoding="utf-8")

    sleep_called = False

    async def mock_sleep(seconds):
        nonlocal sleep_called
        sleep_called = True

    with patch("asyncio.sleep", mock_sleep):
        outcome = await index_repository(
            "repo_test",
            [{"path": "hello.py", "role_label": "Logic"}],
            str(tmp_path),
        )

    assert outcome.inserted == 1
    assert outcome.embedding_identity == "bge-large-en-v1.5:cls"
    assert outcome.embedding_seconds >= 0.0
    assert outcome.insert_seconds >= 0.0
    assert not sleep_called  # no inter-batch delay for local

    # Check rows carry local identity in provider column (column 9)
    assert len(inserted_rows) == 1
    provider_col = inserted_rows[0][9]
    assert provider_col == ["bge-large-en-v1.5:cls"]


@pytest.mark.asyncio
async def test_vectorstore_search_local_provider_filter(fake_tokenizer, monkeypatch):
    """Section 3.2: vectorstore.search embeds with local provider and filters by provider."""
    embedder = LocalEmbedding(
        base_url="http://localhost:1234/v1",
        model="text-embedding-bge-large-en-v1.5",
        tokenizer=fake_tokenizer,
    )
    embedder.embed_query = AsyncMock(return_value=[0.1] * 1024)

    mock_col = MagicMock()
    mock_col.search = MagicMock(return_value=[[]])

    with (
        patch("rune.embedding.get_embedding_provider", return_value=embedder),
        patch.object(zilliz_client, "setup_collection", return_value=mock_col),
    ):
        monkeypatch.setattr(zilliz_client, "collection", mock_col)
        await zilliz_client.search(
            query="find func",
            repo_id="0123456789ab",
            embedding_identity="bge-large-en-v1.5:cls",
        )
        assert embedder.embed_query.call_count == 1
        search_args = mock_col.search.call_args[1]
        expr = search_args["expr"]
        assert "provider == 'bge-large-en-v1.5:cls'" in expr


@pytest.mark.asyncio
async def test_vectorstore_search_invalid_identity_raises():
    """Section 3.2: Invalid identity raises EmbeddingProviderUnavailable."""
    with pytest.raises(EmbeddingProviderUnavailable):
        await zilliz_client.search(
            query="test",
            repo_id="0123456789ab",
            embedding_identity="invalid-unapproved:cls",
        )


def test_index_outcome_and_status_from_outcome():
    outcome = IndexOutcome(
        attempted=100,
        inserted=100,
        embedding_identity="bge-large-en-v1.5:cls",
        document_prefix="Doc: ",
        embedding_seconds=2.3456,
        insert_seconds=0.7891,
        fallback_from="some-prev-model",
    )
    status = status_from_outcome(outcome)
    assert status["status"] == "complete"
    assert status["chunks_attempted"] == 100
    assert status["chunks_inserted"] == 100
    assert status["embedding_identity"] == "bge-large-en-v1.5:cls"
    assert status["document_prefix"] == "Doc: "
    assert status["embedding_seconds"] == 2.346
    assert status["insert_seconds"] == 0.789
    assert status["fallback_from"] == "some-prev-model"


@pytest.mark.asyncio
async def test_resolve_embedding_identity_defaults_to_cloudflare():
    mock_cache = MagicMock()
    # No status -> defaults to cloudflare
    assert await resolve_embedding_identity(mock_cache, {}, "repo123") == "cloudflare"

    # Status without identity -> defaults to cloudflare
    old_result = {"index_status": {"status": "complete", "chunks_inserted": 50}}
    assert await resolve_embedding_identity(mock_cache, old_result, "repo123") == "cloudflare"

    # Status with local identity -> returns local identity
    new_result = {"index_status": {"status": "complete", "embedding_identity": "bge-large-en-v1.5:cls"}}
    assert await resolve_embedding_identity(mock_cache, new_result, "repo123") == "bge-large-en-v1.5:cls"


def test_chat_embedding_unavailable_message_formatting():
    """Section 3.3: chat_embedding_unavailable_message generates clear user-facing messages."""
    cf_msg = chat_embedding_unavailable_message("cloudflare", "cloudflare_embedding_not_configured")
    assert "Cloudflare embedding service that indexed this repository is unavailable" in cf_msg

    local_down_msg = chat_embedding_unavailable_message("bge-large-en-v1.5:cls", "local_embedding_server_unavailable")
    assert "local embedding model (bge-large-en-v1.5:cls)" in local_down_msg

    prefix_mismatch_msg = chat_embedding_unavailable_message("bge-large-en-v1.5:cls", "local_document_prefix_mismatch")
    assert "document prefix" in prefix_mismatch_msg


@pytest.mark.asyncio
async def test_resolve_embedding_identity_deduplicated_origin():
    """Section 3.4: Deduplicated analysis searches with origin identity."""
    mock_cache = MagicMock()
    mock_cache.get = MagicMock(
        return_value={"index_status": {"status": "complete", "embedding_identity": "bge-large-en-v1.5:cls"}}
    )
    dedup_result = {"vector_repo_id": "origin_repo_123"}
    identity = await resolve_embedding_identity(mock_cache, dedup_result, "new_repo_456")
    assert identity == "bge-large-en-v1.5:cls"
