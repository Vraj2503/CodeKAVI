import asyncio
import logging
import aiohttp
from typing import Any

from google import genai
from google.genai import types

from codekavi.settings import settings

logger = logging.getLogger(__name__)

# Constants for Cloudflare
CF_MODEL = "@cf/baai/bge-large-en-v1.5"
CF_MAX_RETRIES = 6
CF_INITIAL_BACKOFF = 2

# Constants for Gemini
GEMINI_MAX_RETRIES = 1  # Set to 1 to fail-fast and immediately trigger Cloudflare fallback
GEMINI_INITIAL_BACKOFF = 0


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


class GeminiEmbedding:
    """Gemini embedding provider configured to output 1024-d vectors."""

    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.model = settings.embedding_model
        # Configure output dimensionality to match Cloudflare (1024)
        self.config = types.EmbedContentConfig(output_dimensionality=1024)
        self._client: genai.Client | None = None

    def _get_client(self) -> genai.Client | None:
        if not self.api_key:
            return None
        if self._client is not None:
            return self._client
        try:
            self._client = genai.Client(api_key=self.api_key)
            return self._client
        except Exception as e:
            logger.error(f"Error initializing GenAI client: {e}")
            return None

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a batch of texts using Gemini with exponential backoff on 429 errors.
        """
        client = self._get_client()
        if not client:
            raise ValueError("Gemini API key not configured")

        backoff = GEMINI_INITIAL_BACKOFF

        for attempt in range(1, GEMINI_MAX_RETRIES + 1):
            try:
                response = await asyncio.to_thread(
                    client.models.embed_content,
                    model=self.model,
                    contents=texts,
                    config=self.config,
                )
                return [e.values for e in response.embeddings]

            except Exception as e:
                err_str = str(e)
                is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

                if is_rate_limit and attempt < GEMINI_MAX_RETRIES:
                    logger.warning(
                        f"Gemini rate-limited (attempt {attempt}/{GEMINI_MAX_RETRIES}). "
                        f"Waiting {backoff:.0f}s before retry…"
                    )
                    await asyncio.sleep(backoff)
                    backoff *= 2
                    continue
                else:
                    logger.error(f"Gemini embed failed permanently: {e}")
                    raise

        raise RuntimeError("Exhausted retries for Gemini embedding")


class CloudflareEmbedding:
    """Cloudflare Workers AI embedding provider for @cf/baai/bge-large-en-v1.5 (1024-d)."""

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
