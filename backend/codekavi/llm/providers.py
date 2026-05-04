"""
providers.py — LLM provider abstraction layer.

Provides a unified interface over different LLM providers.
Currently supports:
  - Groq (default for generation) — via OpenAI-compatible SDK
  - Gemini — Google's Gemini 2.0 Flash model (used for embeddings)

Groq uses the OpenAI SDK pointed at Groq's endpoint.
Gemini uses the google-genai SDK with the same import pattern as indexer.py.
"""

from __future__ import annotations

import os
import time
import asyncio
import logging
from dataclasses import dataclass, field
from typing import AsyncIterator
from concurrent.futures import ThreadPoolExecutor

import dotenv

dotenv.load_dotenv()
logger = logging.getLogger(__name__)

# Thread pool for wrapping sync SDK calls in async handlers
_executor = ThreadPoolExecutor(max_workers=6)

# Retry config for 429 rate-limit errors
_MAX_RETRIES = 3
_RETRY_DELAYS = [5, 15, 30]  # seconds between retries


# ─────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────

@dataclass
class LLMResponse:
    """Standardized response from any LLM provider."""
    content: str
    model: str
    provider: str
    usage: dict = field(default_factory=dict)  # { prompt_tokens, completion_tokens, total_tokens }
    finish_reason: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class Message:
    """A single message in a conversation."""
    role: str       # "system", "user", "assistant"
    content: str


# ─────────────────────────────────────────────
# Groq provider (DEFAULT for generation)
# ─────────────────────────────────────────────

from openai import OpenAI


class GroqProvider:
    """
    Groq LLM provider — uses Groq's OpenAI-compatible API.

    API key is read from GROQ_API_KEY env var.
    Uses the openai SDK pointed at https://api.groq.com/openai/v1.
    """

    name = "groq"

    def __init__(self, model_name: str = "llama-3.3-70b-versatile"):
        self.model_name = model_name
        api_key = os.environ.get("GROQ_API_KEY", "")

        if not api_key:
            raise ValueError(
                "GROQ_API_KEY not found. Set the GROQ_API_KEY environment variable."
            )

        self._client = OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=api_key,
        )
        logger.info(f"GroqProvider initialized with model={self.model_name}")

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
        SYNCHRONOUS method matching the original GroqProvider.complete() interface.

        Converts Message list to OpenAI chat format, calls Groq via OpenAI SDK.
        Retries up to 3 times on 429 rate-limit errors with exponential backoff.
        """
        model_name = model or self.model_name

        # Convert Message objects to OpenAI chat format
        openai_messages = [{"role": m.role, "content": m.content} for m in messages]

        kwargs = {
            "model": model_name,
            "messages": openai_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        # Retry loop for 429 errors
        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = self._client.chat.completions.create(**kwargs)
                break
            except Exception as e:
                if "429" in str(e) and attempt < _MAX_RETRIES:
                    delay = _RETRY_DELAYS[attempt]
                    logger.warning(
                        f"Groq 429 rate limit hit (attempt {attempt + 1}/{_MAX_RETRIES}). "
                        f"Retrying in {delay}s..."
                    )
                    time.sleep(delay)
                    continue
                logger.error(f"Groq API error: {e}")
                raise

        # Extract response
        choice = response.choices[0]
        content = choice.message.content or ""

        # Extract usage
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

        Wraps the sync OpenAI/Groq call in run_in_executor.
        Retries up to 3 times on 429 rate-limit errors with exponential backoff.
        """
        loop = asyncio.get_event_loop()

        def _sync_call():
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": user_prompt})

            kwargs = {
                "model": self.model_name,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            # Retry loop for 429 errors
            for attempt in range(_MAX_RETRIES + 1):
                try:
                    response = self._client.chat.completions.create(**kwargs)
                    return response.choices[0].message.content or ""
                except Exception as e:
                    if "429" in str(e) and attempt < _MAX_RETRIES:
                        delay = _RETRY_DELAYS[attempt]
                        logger.warning(
                            f"Groq 429 rate limit hit in generate() "
                            f"(attempt {attempt + 1}/{_MAX_RETRIES}). "
                            f"Retrying in {delay}s..."
                        )
                        time.sleep(delay)
                        continue
                    logger.error(f"Groq API error in generate(): {e}")
                    raise

        return await loop.run_in_executor(_executor, _sync_call)

    async def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """
        ASYNC streaming for chat streaming.

        Uses stream=True on the OpenAI/Groq call, yields text chunks.
        """
        loop = asyncio.get_event_loop()

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        # Run the initial stream creation in executor (blocking call)
        def _create_stream():
            return self._client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )

        stream = await loop.run_in_executor(_executor, _create_stream)

        # Iterate through the stream chunks
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def available_models(self) -> list[str]:
        """Return list of supported models."""
        return ["llama-3.3-70b-versatile"]


# ─────────────────────────────────────────────
# Gemini provider (kept for embeddings)
# ─────────────────────────────────────────────

from google import genai
from google.genai import types


class GeminiProvider:
    """
    Gemini LLM provider — uses Google's Gemini models via the google-genai SDK.

    API key is read from GEMINI_API_KEY env var.
    Kept in the codebase for embedding use in indexer.py / vectorstore.py.
    """

    name = "gemini"

    def __init__(self, model_name: str = "gemini-2.0-flash"):
        self.model_name = model_name
        api_key = os.environ.get("GEMINI_API_KEY", "")

        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY not found. Set the GEMINI_API_KEY environment variable."
            )

        self._client = genai.Client(api_key=api_key)
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
        SYNCHRONOUS method matching the original GroqProvider.complete() interface.

        Converts the Message list (system + user roles) into Gemini's
        system_instruction + contents format.

        Keeps existing explainer.py working without any changes.
        """
        model_name = model or self.model_name

        # Extract system and user messages from the Message list
        system_parts = []
        user_parts = []
        for msg in messages:
            if msg.role == "system":
                system_parts.append(msg.content)
            else:
                user_parts.append(msg.content)

        system_instruction = "\n\n".join(system_parts) if system_parts else None
        user_content = "\n\n".join(user_parts) if user_parts else ""

        # Build config
        config_kwargs = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        config = types.GenerateContentConfig(**config_kwargs)

        try:
            response = self._client.models.generate_content(
                model=model_name,
                contents=user_content,
                config=config,
            )
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise

        # Extract response text
        content = response.text or ""

        # Extract usage metadata
        usage = {}
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            usage = {
                "prompt_tokens": getattr(um, "prompt_token_count", 0),
                "completion_tokens": getattr(um, "candidates_token_count", 0),
                "total_tokens": getattr(um, "total_token_count", 0),
            }

        # Extract finish reason
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
        ASYNC method for the new orchestrator. Non-blocking.

        Wraps the sync SDK call in run_in_executor.
        """
        loop = asyncio.get_event_loop()

        def _sync_call():
            config_kwargs = {
                "temperature": temperature,
                "max_output_tokens": max_tokens,
            }
            if system_prompt:
                config_kwargs["system_instruction"] = system_prompt
            if json_mode:
                config_kwargs["response_mime_type"] = "application/json"

            config = types.GenerateContentConfig(**config_kwargs)

            response = self._client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )
            return response.text or ""

        return await loop.run_in_executor(_executor, _sync_call)

    async def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """
        ASYNC streaming for future chat streaming.

        Uses generate_content_stream, yields text chunks.
        """
        loop = asyncio.get_event_loop()

        config_kwargs = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_prompt:
            config_kwargs["system_instruction"] = system_prompt

        config = types.GenerateContentConfig(**config_kwargs)

        # Run the initial stream creation in executor (blocking call)
        def _create_stream():
            return self._client.models.generate_content_stream(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )

        stream = await loop.run_in_executor(_executor, _create_stream)

        # Iterate through the stream chunks
        for chunk in stream:
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
        A cached GroqProvider instance.
    """
    if "groq" not in _provider_cache:
        _provider_cache["groq"] = GroqProvider()
    return _provider_cache["groq"]
