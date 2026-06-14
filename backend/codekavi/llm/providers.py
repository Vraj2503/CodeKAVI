"""
providers.py — LLM provider abstraction layer.

Provides a unified interface over different LLM providers.
Currently supports:
  - Groq (default for generation) — via native Groq SDK
  - Gemini — Google's Gemini 2.0 Flash model (used for embeddings)

Groq uses the official groq Python SDK.
Gemini uses the google-genai SDK with the same import pattern as indexer.py.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import dotenv
from google import genai as google_genai
from google.genai import types as google_types
from groq import Groq

from codekavi.settings import settings

dotenv.load_dotenv()
logger = logging.getLogger(__name__)

# Retry config for 429 rate-limit errors
_MAX_RETRIES = 3
_RETRY_DELAYS = [5, 15, 30]  # seconds between retries

# Provider specific ThreadPoolExecutor removed. We use the global ContextVar-based executor.


# ─────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────


@dataclass
class LLMResponse:
    """Standardized response from any LLM provider."""

    content: str
    model: str
    provider: str
    usage: dict = field(default_factory=dict)
    finish_reason: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class Message:
    """A single message in a conversation."""

    role: str  # "system", "user", "assistant"
    content: str


# ─────────────────────────────────────────────
# Groq provider (DEFAULT for generation)
# ─────────────────────────────────────────────


class GroqProvider:
    """
    Groq LLM provider — uses the native Groq Python SDK.

    API key is read from GROQ_API_KEY env var.
    """

    name = "groq"

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or settings.groq_model
        api_key = settings.groq_api_key

        if not api_key:
            raise ValueError("GROQ_API_KEY not found. Set the GROQ_API_KEY environment variable.")

        self._client = Groq(api_key=api_key)
        logger.info(f"GroqProvider initialized with model={self.model_name}")

    # ─────────────────────────────────────────
    # Sync interface (backward-compatible with Explainer)
    # Uses time.sleep in a background thread — OK, does not block event loop.
    # ─────────────────────────────────────────

    def complete(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> LLMResponse:
        """SYNCHRONOUS method. Retries on 429 with blocking sleep in thread."""
        model_name = model or self.model_name
        chat_messages = [{"role": m.role, "content": m.content} for m in messages]

        kwargs: dict = {
            "model": model_name,
            "messages": chat_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = self._client.chat.completions.create(**kwargs)
                break
            except Exception as e:
                if "429" in str(e) and attempt < _MAX_RETRIES:
                    delay = _RETRY_DELAYS[attempt]
                    logger.warning(
                        f"Groq 429 rate limit hit (attempt {attempt + 1}/{_MAX_RETRIES}). Retrying in {delay}s..."
                    )
                    import time as time_module

                    time_module.sleep(delay)
                    continue
                logger.error(f"Groq API error: {e}")
                raise

        choice = response.choices[0]
        content = choice.message.content or ""

        usage = {}
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens or 0,
                "completion_tokens": response.usage.completion_tokens or 0,
                "total_tokens": response.usage.total_tokens or 0,
            }

        finish_reason = choice.finish_reason or ""

        return LLMResponse(
            content=content,
            model=model_name,
            provider=self.name,
            usage=usage,
            finish_reason=finish_reason,
        )

    # ─────────────────────────────────────────
    # Async interface (for orchestrator)
    # Uses asyncio.sleep — non-blocking, proper async retry.
    # ─────────────────────────────────────────

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> str:
        """
        ASYNC method for the orchestrator. Non-blocking.

        Wraps the sync Groq SDK call in run_in_executor.
        Retries with asyncio.sleep — keeps the event loop responsive.
        """
        from typing import Any

        from codekavi.utils import current_executor

        messages: list[Any] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        loop = asyncio.get_running_loop()

        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = await loop.run_in_executor(
                    current_executor.get(None),
                    lambda: self._client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    ),
                )
                return response.choices[0].message.content or ""
            except Exception as e:
                if "429" in str(e) and attempt < _MAX_RETRIES:
                    delay = _RETRY_DELAYS[attempt]
                    logger.warning(
                        f"Groq 429 rate limit hit in generate() "
                        f"(attempt {attempt + 1}/{_MAX_RETRIES}). "
                        f"Retrying in {delay}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"Groq API error in generate(): {e}")
                raise

        return ""  # unreachable

    async def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """
        ASYNC streaming for chat streaming.
        Each chunk is yielded as it arrives from the sync stream.
        """
        from typing import Any

        messages: list[Any] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        def _create_stream():
            return self._client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )

        from codekavi.utils import current_executor

        executor = current_executor.get(None)

        loop = asyncio.get_running_loop()
        stream = await loop.run_in_executor(executor, _create_stream)

        while True:
            chunk = await loop.run_in_executor(executor, lambda: next(stream, None))
            if chunk is None:
                break
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def available_models(self) -> list[str]:
        """Return list of supported models."""
        return ["llama-3.3-70b-versatile"]


# ─────────────────────────────────────────────
# Gemini provider (kept for embeddings)
# ─────────────────────────────────────────────


class GeminiProvider:
    """
    Gemini LLM provider — uses Google's Gemini models via the google-genai SDK.

    API key is read from GEMINI_API_KEY env var.
    Kept in the codebase for embedding use in indexer.py / vectorstore.py.
    """

    name = "gemini"

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or settings.gemini_model
        api_key = settings.gemini_api_key

        if not api_key:
            raise ValueError("GEMINI_API_KEY not found. Set the GEMINI_API_KEY environment variable.")

        self._client = google_genai.Client(api_key=api_key)
        logger.info(f"GeminiProvider initialized with model={self.model_name}")

    # ─────────────────────────────────────────
    # Sync interface (backward-compatible with Explainer)
    # ─────────────────────────────────────────

    def complete(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> LLMResponse:
        """
        SYNCHRONOUS method.

        Converts the Message list into Gemini's system_instruction + contents format.
        """
        model_name = model or self.model_name

        system_parts = []
        user_parts = []
        for msg in messages:
            if msg.role == "system":
                system_parts.append(msg.content)
            else:
                user_parts.append(msg.content)

        system_instruction = "\n\n".join(system_parts) if system_parts else None
        user_content = "\n\n".join(user_parts) if user_parts else ""

        config_kwargs: dict = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        config = google_types.GenerateContentConfig(**config_kwargs)

        try:
            response = self._client.models.generate_content(
                model=model_name,
                contents=user_content,
                config=config,
            )
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise

        content = response.text or ""

        usage = {}
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            usage = {
                "prompt_tokens": getattr(um, "prompt_token_count", 0),
                "completion_tokens": getattr(um, "candidates_token_count", 0),
                "total_tokens": getattr(um, "total_token_count", 0),
            }

        finish_reason = ""
        if response.candidates:
            fr = response.candidates[0].finish_reason
            finish_reason = str(fr) if fr else ""

        return LLMResponse(
            content=content,
            model=model_name,
            provider=self.name,
            usage=usage,
            finish_reason=finish_reason,
        )

    # ─────────────────────────────────────────
    # Async interface (for orchestrator)
    # ─────────────────────────────────────────

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> str:
        """
        ASYNC method for the orchestrator. Non-blocking.

        Wraps the sync SDK call in run_in_executor.
        """
        from codekavi.utils import current_executor

        config_kwargs: dict = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_prompt:
            config_kwargs["system_instruction"] = system_prompt
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        config = google_types.GenerateContentConfig(**config_kwargs)

        def _sync_call():
            return self._client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )

        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(current_executor.get(None), _sync_call)
        return response.text or ""

    async def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """
        ASYNC streaming for future chat streaming.
        """
        config_kwargs: dict = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_prompt:
            config_kwargs["system_instruction"] = system_prompt

        config = google_types.GenerateContentConfig(**config_kwargs)

        def _create_stream():
            return self._client.models.generate_content_stream(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )

        from codekavi.utils import current_executor

        executor = current_executor.get(None)

        loop = asyncio.get_running_loop()
        stream = await loop.run_in_executor(executor, _create_stream)

        while True:
            chunk = await loop.run_in_executor(executor, lambda: next(stream, None))
            if chunk is None:
                break
            if chunk.text:
                yield chunk.text

    def available_models(self) -> list[str]:
        """Return list of supported models."""
        return ["gemini-2.0-flash"]


# ─────────────────────────────────────────────
# Provider factory (cached singleton)
# ─────────────────────────────────────────────

_provider_cache: dict[str, GroqProvider | GeminiProvider] = {}


def get_provider(task: str = "chat") -> GroqProvider:
    """
    Returns GroqProvider by default for all generation tasks.
    Gemini is only used for embeddings (via indexer.py / vectorstore.py directly).

    Args:
        task: Task type hint (e.g. "chat", "overview", "viz_data").
              Currently unused but reserved for future model routing.

    Returns:
        A cached GroqProvider instance (process-level singleton).
        The GroqProvider and GeminiProvider classes are intentionally stateless —
        they hold only the API client and model name, no per-request state.
    """
    from typing import cast

    if "groq" not in _provider_cache:
        _provider_cache["groq"] = GroqProvider()
    return cast(GroqProvider, _provider_cache["groq"])
