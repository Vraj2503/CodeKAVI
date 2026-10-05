import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

import aiohttp

from rune.settings import settings

logger = logging.getLogger(__name__)

# Constants for Cloudflare
CF_MODEL = "@cf/baai/bge-large-en-v1.5"
CF_MAX_RETRIES = 6
CF_INITIAL_BACKOFF = 2

# ``provider`` is persisted alongside every vector. It is intentionally a
# compact *embedding-space identity*, not the host that happened to serve the
# request: vectors from the same model with different pooling are incompatible.
CLOUDFLARE_IDENTITY = "cloudflare"  # legacy namespace; keeps existing indexes searchable
_IDENTITY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,29}(?::[a-z0-9._-]+)?$")


class EmbeddingProviderUnavailable(RuntimeError):  # noqa: N818
    """The provider needed for an existing index cannot currently be used.

    ``reason`` is deliberately a short, safe code. Routes can give users a
    useful explanation without exposing an upstream URL or response body.
    """

    def __init__(self, identity: str, reason: str):
        super().__init__(f"Embedding provider {identity!r} is unavailable: {reason}")
        self.identity = identity
        self.reason = reason


@dataclass(frozen=True)
class LocalModelSpec:
    """A local model whose embedding space has been explicitly approved."""

    model_aliases: tuple[str, ...]
    identity: str
    pooling: str
    dimension: int
    max_tokens: int
    tokenizer_repo: str
    default_chunk_tokens: int = 512
    default_query_prefix: str = ""


# Do not accept an arbitrary OpenAI-compatible embedding model merely because
# it emits 1024 dimensions. The registry makes an embedding-space migration a
# conscious code change and, in particular, rejects bge's mean pooling.
_LOCAL_MODEL_SPECS = (
    LocalModelSpec(
        model_aliases=(
            "bge-large-en-v1.5",
            "text-embedding-bge-large-en-v1.5",
        ),
        identity="bge-large-en-v1.5:cls",
        pooling="cls",
        dimension=1024,
        max_tokens=512,
        tokenizer_repo="BAAI/bge-large-en-v1.5",
        default_chunk_tokens=512,
        default_query_prefix="",
    ),
    LocalModelSpec(
        model_aliases=(
            "qwen3-embedding-0.6b",
            "text-embedding-qwen3-embedding-0.6b",
            "qwen3-embedding-0.6b-f16",
            "text-embedding-qwen3-embedding-0.6b-f16",
            "qwen-qwen3-embedding-0.6b",
            "text-embedding-qwen-qwen3-embedding-0.6b",
        ),
        identity="qwen3-embedding-0.6b:last-token",
        pooling="last-token",
        dimension=1024,
        max_tokens=32768,
        tokenizer_repo="Qwen/Qwen3-Embedding-0.6B",
        default_chunk_tokens=512,
        default_query_prefix="Instruct: Retrieve semantically similar code or relevant passages for the query\nQuery: ",
    ),
)


def _normalise_model_name(model: str) -> str:
    """Normalise LM Studio's display/model names for the small allow-list."""
    name = model.strip().lower().replace("_", "-")
    name = name.rsplit("/", 1)[-1]
    name = name.removesuffix(".gguf")
    name = name.removeprefix("text-embedding-")
    return name


def _local_model_spec(model: str, pooling: str) -> LocalModelSpec:
    normalised = _normalise_model_name(model)
    requested_pooling = pooling.strip().lower()
    for spec in _LOCAL_MODEL_SPECS:
        aliases = {_normalise_model_name(a) for a in spec.model_aliases}
        if normalised in aliases:
            if requested_pooling != spec.pooling:
                raise ValueError(
                    f"Local model {model!r} must use {spec.pooling!r} pooling, not {pooling!r}; "
                    "the embedding spaces are incompatible"
                )
            return spec
    raise ValueError(f"Local embedding model {model!r} is not in the approved embedding registry")


def validate_embedding_identity(identity: str) -> str:
    """Return a safe, registered identity before it is interpolated in Milvus."""
    if identity == CLOUDFLARE_IDENTITY:
        return identity
    if not _IDENTITY_PATTERN.fullmatch(identity):
        raise ValueError(f"Invalid embedding identity: {identity!r}")
    if identity not in {spec.identity for spec in _LOCAL_MODEL_SPECS}:
        raise ValueError(f"Unrecognised embedding identity: {identity!r}")
    return identity


# ──────────────────────────────────────────────────────────────────────
# H-12 — Shared aiohttp session for Cloudflare embedding.
#
# Opening a fresh ``aiohttp.ClientSession`` per ``embed_texts`` call means a
# brand-new TLS handshake + connection pool on every RAG search round-trip
# and on every indexing batch (thousands during a large repo index), which
# roughly doubles tail latency. A single process-wide session keeps
# connections warm via keep-alive and is reused across all callers.
# It is created lazily inside the running event loop and closed on app
# shutdown via ``close_cloudflare_session()`` (wired into main.py lifespan).
# ──────────────────────────────────────────────────────────────────────
_cf_session: aiohttp.ClientSession | None = None
_cf_session_lock = asyncio.Lock()


async def get_cloudflare_session() -> aiohttp.ClientSession:
    """Return the process-wide Cloudflare aiohttp session, creating it lazily."""
    global _cf_session
    if _cf_session is not None and not _cf_session.closed:
        return _cf_session
    async with _cf_session_lock:
        # Re-check under the lock — another coroutine may have created it
        # while we were waiting.
        if _cf_session is None or _cf_session.closed:
            _cf_session = aiohttp.ClientSession()
    return _cf_session


async def close_cloudflare_session() -> None:
    """Close the shared Cloudflare session. Call once on app shutdown."""
    global _cf_session
    if _cf_session is not None and not _cf_session.closed:
        await _cf_session.close()
    _cf_session = None


# LM Studio is also called repeatedly during a large index. Keep a separate
# pool so a local connection is just as cheap to reuse as Cloudflare's.
_local_session: aiohttp.ClientSession | None = None
_local_session_lock = asyncio.Lock()


async def get_local_session() -> aiohttp.ClientSession:
    """Return the process-wide session used for OpenAI-compatible local APIs."""
    global _local_session
    if _local_session is not None and not _local_session.closed:
        return _local_session
    async with _local_session_lock:
        if _local_session is None or _local_session.closed:
            _local_session = aiohttp.ClientSession()
    return _local_session


async def close_local_session() -> None:
    """Close the shared local embedding session on app shutdown."""
    global _local_session
    if _local_session is not None and not _local_session.closed:
        await _local_session.close()
    _local_session = None


class CloudflareEmbedding:
    """Cloudflare Workers AI embedding provider for @cf/baai/bge-large-en-v1.5 (1024-d)."""

    identity = CLOUDFLARE_IDENTITY
    is_local = False

    def __init__(self):
        self.account_id = settings.cloudflare_account_id
        self.api_token = settings.cloudflare_api_token
        self.endpoint = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/ai/run/{CF_MODEL}"

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a batch of texts using Cloudflare REST API with exponential backoff.
        """
        if not self.account_id or not self.api_token:
            raise ValueError("Cloudflare credentials not configured")

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

        # We must truncate very long chunks because bge-large-en has a 512 token limit.
        # ~2000 chars is roughly 500 tokens for code.
        truncated_texts = [text[:2000] for text in texts]

        payload = {"text": truncated_texts}
        backoff = CF_INITIAL_BACKOFF

        # H-12: reuse the process-wide session so connections stay warm via
        # keep-alive instead of paying a fresh TLS handshake per call.
        session = await get_cloudflare_session()
        for attempt in range(1, CF_MAX_RETRIES + 1):
            try:
                async with session.post(self.endpoint, headers=headers, json=payload) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("success"):
                            result_data = data.get("result", {}).get("data", [])
                            if result_data and isinstance(result_data[0], dict) and "values" in result_data[0]:
                                return [item["values"] for item in result_data]
                            elif result_data and isinstance(result_data[0], list):
                                return result_data
                            else:
                                return result_data
                        else:
                            raise ValueError(f"Cloudflare API returned error: {data.get('errors')}")

                    is_transient = resp.status in (429, 500, 502, 503, 504)
                    if is_transient and attempt < CF_MAX_RETRIES:
                        logger.warning(
                            f"Cloudflare HTTP {resp.status} (attempt {attempt}/{CF_MAX_RETRIES}). "
                            f"Waiting {backoff:.0f}s before retry…"
                        )
                        await asyncio.sleep(backoff)
                        backoff *= 2
                        continue
                    else:
                        resp_text = await resp.text()
                        raise RuntimeError(f"Cloudflare embed failed with status {resp.status}: {resp_text}")

            except aiohttp.ClientError as e:
                if attempt < CF_MAX_RETRIES:
                    logger.warning(
                        f"Cloudflare network error (attempt {attempt}/{CF_MAX_RETRIES}). "
                        f"Waiting {backoff:.0f}s before retry…"
                    )
                    await asyncio.sleep(backoff)
                    backoff *= 2
                    continue
                else:
                    logger.error(f"Cloudflare network error failed permanently: {e}")
                    raise

        raise RuntimeError("Exhausted retries for Cloudflare embedding")

    @property
    def is_configured(self) -> bool:
        return bool(self.account_id and self.api_token)

    async def embed_query(self, query: str) -> list[float]:
        """Cloudflare has no separate query prefix in the legacy namespace."""
        vectors = await self.embed_texts([query])
        if not vectors:
            raise EmbeddingProviderUnavailable(self.identity, "cloudflare_empty_response")
        return vectors[0]


class LocalEmbedding:
    """OpenAI-compatible local embeddings, currently served by LM Studio.

    The model and pooling pair is checked against ``_LOCAL_MODEL_SPECS`` before
    any vector is accepted. This keeps a model change from silently contaminating
    an existing Milvus partition which happens to have the same dimension.
    """

    is_local = True

    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        pooling: str | None = None,
        document_prefix: str | None = None,
        query_prefix: str | None = None,
        tokenizer_path: str | None = None,
        tokenizer: Any = None,
    ) -> None:
        self.base_url = (base_url if base_url is not None else settings.local_embedding_base_url).rstrip("/")
        self.model = model if model is not None else settings.local_embedding_model
        self.api_key = api_key if api_key is not None else settings.local_embedding_api_key
        self.document_prefix = (
            document_prefix if document_prefix is not None else settings.local_embedding_document_prefix
        )
        self.tokenizer_path = tokenizer_path if tokenizer_path is not None else settings.local_embedding_tokenizer_path
        self._custom_tokenizer = tokenizer
        self._loaded_tokenizer = None
        if not self.base_url or not self.model:
            raise ValueError("LOCAL_EMBEDDING_BASE_URL and LOCAL_EMBEDDING_MODEL must be configured")
        self.spec = _local_model_spec(
            self.model,
            pooling if pooling is not None else settings.local_embedding_pooling,
        )
        self.identity = self.spec.identity
        self.endpoint = f"{self.base_url}/embeddings"

        if query_prefix is not None:
            self.query_prefix = query_prefix
        elif settings.local_embedding_query_prefix != "":
            self.query_prefix = settings.local_embedding_query_prefix
        else:
            self.query_prefix = self.spec.default_query_prefix

    @property
    def max_tokens(self) -> int:
        configured = settings.local_embedding_max_tokens
        if configured > 0:
            return min(self.spec.max_tokens, configured)
        return self.spec.max_tokens

    @property
    def chunk_tokens(self) -> int:
        configured = settings.local_embedding_chunk_tokens
        target = configured if configured > 0 else self.spec.default_chunk_tokens
        return min(self.max_tokens, target)

    @property
    def batch_size(self) -> int:
        return settings.local_embedding_batch_size

    @property
    def tokenizer(self):
        """Load the exact tokenizer locally; never download during an index run."""
        if self._custom_tokenizer is not None:
            return self._custom_tokenizer
        if self._loaded_tokenizer is not None:
            return self._loaded_tokenizer
        try:
            from tokenizers import Tokenizer

            if self.tokenizer_path:
                self._loaded_tokenizer = Tokenizer.from_file(self.tokenizer_path)
                return self._loaded_tokenizer

            from huggingface_hub import hf_hub_download

            path = hf_hub_download(self.spec.tokenizer_repo, "tokenizer.json", local_files_only=True)
            self._loaded_tokenizer = Tokenizer.from_file(path)
            return self._loaded_tokenizer
        except Exception as e:
            raise EmbeddingProviderUnavailable(self.identity, "local_tokenizer_unavailable") from e

    def _token_count(self, text: str, prefix: str) -> int:
        return len(self.tokenizer.encode(f"{prefix}{text}").ids)

    def document_token_count(self, text: str) -> int:
        """Count the document prefix and model special tokens as sent to LM Studio."""
        return self._token_count(text, self.document_prefix)

    def query_token_count(self, text: str) -> int:
        """Count the query prefix and model special tokens as sent to LM Studio."""
        return self._token_count(text, self.query_prefix)

    def truncate_query(self, query: str) -> str:
        """Keep user queries within the model limit without sending an over-limit input."""
        if self.query_token_count(query) <= self.max_tokens:
            return query
        low, high = 0, len(query)
        while low < high:
            mid = (low + high + 1) // 2
            if self.query_token_count(query[:mid]) <= self.max_tokens:
                low = mid
            else:
                high = mid - 1
        if low == 0:
            raise EmbeddingProviderUnavailable(self.identity, "local_query_prefix_exceeds_token_limit")
        return query[:low]

    def _assert_document_fits(self, text: str) -> None:
        if self.document_token_count(text) > self.max_tokens:
            raise ValueError(
                f"Document chunk exceeds {self.max_tokens} tokens for local embedding identity {self.identity}"
            )

    async def _embed_inputs(self, inputs: list[str]) -> list[list[float]]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {"model": self.model, "input": inputs}
        timeout = aiohttp.ClientTimeout(total=settings.local_embedding_timeout_s)
        try:
            session = await get_local_session()
            async with session.post(self.endpoint, headers=headers, json=payload, timeout=timeout) as response:
                if response.status != 200:
                    await response.read()  # release the pooled connection; do not log upstream text
                    raise EmbeddingProviderUnavailable(self.identity, "local_embedding_server_unavailable")
                body = await response.json()
        except EmbeddingProviderUnavailable:
            raise
        except (TimeoutError, aiohttp.ClientError, ValueError) as e:
            raise EmbeddingProviderUnavailable(self.identity, "local_embedding_server_unavailable") from e

        rows = body.get("data") if isinstance(body, dict) else None
        if not isinstance(rows, list) or len(rows) != len(inputs):
            raise EmbeddingProviderUnavailable(self.identity, "local_embedding_invalid_response")
        try:
            ordered = sorted(rows, key=lambda row: row.get("index", 0))
            vectors = [row["embedding"] for row in ordered]
        except (AttributeError, KeyError, TypeError) as e:
            raise EmbeddingProviderUnavailable(self.identity, "local_embedding_invalid_response") from e
        if any(not isinstance(vector, list) or len(vector) != self.spec.dimension for vector in vectors):
            raise EmbeddingProviderUnavailable(self.identity, "local_embedding_dimension_mismatch")
        return vectors

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed document chunks after enforcing the registry's token limit."""
        for text in texts:
            self._assert_document_fits(text)
        return await self._embed_inputs([f"{self.document_prefix}{text}" for text in texts])

    async def embed_query(self, query: str) -> list[float]:
        """Embed one query in the same space as this local index."""
        bounded_query = self.truncate_query(query)
        vectors = await self._embed_inputs([f"{self.query_prefix}{bounded_query}"])
        return vectors[0]

    async def check_available(self) -> None:
        """Verify the actual loaded model endpoint and tokenizer before clearing a repo's vectors."""
        _ = self.tokenizer
        await self._embed_inputs([f"{self.document_prefix}CodeKAVI local embedding health check"])


@dataclass(frozen=True)
class EmbeddingSelection:
    provider: object
    fallback_from: str | None = None


def _cloudflare_is_configured(provider: object) -> bool:
    """Keep the test seam compatible with simple fake Cloudflare embedders."""
    configured = getattr(provider, "is_configured", None)
    if configured is not None:
        return bool(configured)
    return bool(getattr(provider, "account_id", None) and getattr(provider, "api_token", None))


_cached_providers: dict[Any, Any] = {}


def clear_provider_cache() -> None:
    """Clear cached embedding providers (for tests and dynamic configuration updates)."""
    _cached_providers.clear()


def get_embedding_provider(identity: str, document_prefix: str | None = None):
    """Build or return the cached provider that produced ``identity``; never substitute another."""
    identity = validate_embedding_identity(identity)
    if identity == CLOUDFLARE_IDENTITY:
        cache_key = ("cloudflare", settings.cloudflare_account_id, settings.cloudflare_api_token)
        provider = _cached_providers.get(cache_key)
        if provider is None:
            provider = CloudflareEmbedding()
            _cached_providers[cache_key] = provider
        if not _cloudflare_is_configured(provider):
            raise EmbeddingProviderUnavailable(identity, "cloudflare_embedding_not_configured")
        return provider

    cache_key = (
        identity,
        settings.local_embedding_base_url,
        settings.local_embedding_model,
        settings.local_embedding_api_key,
        settings.local_embedding_pooling,
        settings.local_embedding_document_prefix,
        settings.local_embedding_query_prefix,
        settings.local_embedding_tokenizer_path,
        settings.local_embedding_timeout_s,
        settings.local_embedding_chunk_overlap_tokens,
        settings.local_embedding_chunk_tokens,
        settings.local_embedding_max_tokens,
        settings.local_embedding_batch_size,
    )
    provider = _cached_providers.get(cache_key)
    if provider is None:
        try:
            provider = LocalEmbedding()
        except ValueError as e:
            raise EmbeddingProviderUnavailable(identity, "local_embedding_configuration_changed") from e
        if provider.identity != identity:
            raise EmbeddingProviderUnavailable(identity, "local_embedding_configuration_changed")
        _cached_providers[cache_key] = provider

    if document_prefix is not None and document_prefix != provider.document_prefix:
        raise EmbeddingProviderUnavailable(identity, "local_document_prefix_mismatch")

    return provider


def local_embedding_is_configured() -> bool:
    """Configuration-only check used when /analyze decides whether to schedule indexing."""
    return bool(settings.local_embedding_base_url and settings.local_embedding_model)


def indexing_embedding_is_configured() -> bool:
    """Whether the selected provider can at least be attempted for a new index."""
    provider_name = settings.embedding_provider.strip().lower()
    if provider_name == "local":
        return local_embedding_is_configured() or bool(settings.cloudflare_account_id and settings.cloudflare_api_token)
    if provider_name == "cloudflare":
        return bool(settings.cloudflare_account_id and settings.cloudflare_api_token)
    return False


async def select_index_embedding_provider(repo_id: str = "") -> EmbeddingSelection:
    """Choose once for a whole index; local failures fall back before any rows are written."""
    provider_name = settings.embedding_provider.strip().lower()
    if provider_name == "cloudflare":
        return EmbeddingSelection(get_embedding_provider(CLOUDFLARE_IDENTITY))
    if provider_name != "local":
        raise EmbeddingProviderUnavailable("unknown", "embedding_provider_not_supported")

    local_identity = "local"
    try:
        local = LocalEmbedding()
        local_identity = local.identity
        await local.check_available()
        return EmbeddingSelection(local)
    except (EmbeddingProviderUnavailable, ValueError) as local_error:
        reason = (
            local_error.reason
            if isinstance(local_error, EmbeddingProviderUnavailable)
            else "local_embedding_unavailable"
        )
        fallback_mode = settings.embedding_fallback.strip().lower()
        if fallback_mode == "cloudflare":
            fallback = CloudflareEmbedding()
            if _cloudflare_is_configured(fallback):
                logger.warning(
                    "Local embedding %s unavailable at index start (%s) for repo %s; using Cloudflare fallback",
                    local_identity,
                    reason,
                    repo_id or "unknown",
                )
                return EmbeddingSelection(fallback, fallback_from=local_identity)
        if fallback_mode == "none":
            raise EmbeddingProviderUnavailable(local_identity, reason) from local_error
        raise EmbeddingProviderUnavailable(local_identity, "local_embedding_unavailable_no_fallback") from local_error
