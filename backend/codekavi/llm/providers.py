"""
providers.py — LLM provider abstraction layer.

Provides a unified interface over different LLM providers.
Currently supports:
  - Groq (primary) — ultra-fast inference, OpenAI-compatible API

Designed for easy extension to OpenAI, Anthropic, Gemini, etc.
"""

from __future__ import annotations

import os
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Generator
import dotenv

dotenv.load_dotenv()
logger = logging.getLogger(__name__)


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
# Base provider interface
# ─────────────────────────────────────────────

class LLMProvider(ABC):
    """
    Abstract base class for LLM providers.

    Subclasses must implement:
      - complete()   — standard request/response
      - stream()     — streaming token-by-token (optional)
      - available_models() — list of supported models
    """

    name: str = "base"

    @abstractmethod
    def complete(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> LLMResponse:
        """Send a completion request and return the full response."""
        ...

    def stream(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> Generator[str, None, None]:
        """Stream tokens one at a time. Default falls back to complete()."""
        response = self.complete(messages, model, temperature, max_tokens)
        yield response.content

    @abstractmethod
    def available_models(self) -> list[str]:
        """Return list of models this provider supports."""
        ...

    def _messages_to_dicts(self, messages: list[Message]) -> list[dict]:
        """Convert Message objects to API-ready dicts."""
        return [{"role": m.role, "content": m.content} for m in messages]


# ─────────────────────────────────────────────
# Groq provider
# ─────────────────────────────────────────────

# Models available on Groq (as of April 2026)
GROQ_MODELS = {
    "llama-3.3-70b-versatile": {
        "context_window": 32768,
        "description": "Llama 3.3 70B — high quality, versatile",
        "tier": "primary",
    },
    "llama-3.1-8b-instant": {
        "context_window": 8192,
        "description": "Llama 3.1 8B — fast, cost-effective",
        "tier": "fast",
    },
    "llama4-scout-17b-16e-instruct": {
        "context_window": 8192,
        "description": "Llama 4 Scout 17B — newer architecture",
        "tier": "primary",
    },
    "mixtral-8x7b-32768": {
        "context_window": 32768,
        "description": "Mixtral 8x7B — good balance of speed + quality",
        "tier": "primary",
    },
}

# Default model to use
GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile"


class GroqProvider(LLMProvider):
    """
    Groq LLM provider — ultra-fast inference via GroqCloud.

    Uses the official `groq` Python SDK.
    API key is read from GROQ_API_KEY env var or passed directly.
    """

    name = "groq"

    def __init__(self, api_key: str | None = None, default_model: str | None = None):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.default_model = default_model or GROQ_DEFAULT_MODEL

        if not self.api_key:
            raise ValueError(
                "Groq API key not found. Set the GROQ_API_KEY environment variable "
                "or pass api_key directly."
            )

        # Lazy import to avoid forcing groq as a hard dependency
        try:
            from groq import Groq
        except ImportError:
            raise ImportError(
                "The 'groq' package is required for GroqProvider. "
                "Install it with: pip install groq"
            )

        self._client = Groq(api_key=self.api_key)
        logger.info(f"GroqProvider initialized with model={self.default_model}")

    def complete(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> LLMResponse:
        """Send a chat completion request to Groq."""
        model = model or self.default_model
        msg_dicts = self._messages_to_dicts(messages)

        kwargs = {
            "messages": msg_dicts,
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = self._client.chat.completions.create(**kwargs)
        except Exception as e:
            logger.error(f"Groq API error: {e}")
            raise

        choice = response.choices[0]
        usage = {}
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }

        return LLMResponse(
            content=choice.message.content or "",
            model=model,
            provider=self.name,
            usage=usage,
            finish_reason=choice.finish_reason or "",
        )

    def stream(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> Generator[str, None, None]:
        """Stream tokens from Groq."""
        model = model or self.default_model
        msg_dicts = self._messages_to_dicts(messages)

        try:
            stream = self._client.chat.completions.create(
                messages=msg_dicts,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )

            for chunk in stream:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content

        except Exception as e:
            logger.error(f"Groq streaming error: {e}")
            raise

    def available_models(self) -> list[str]:
        """Return list of Groq-supported models."""
        return list(GROQ_MODELS.keys())


# ─────────────────────────────────────────────
# Provider factory
# ─────────────────────────────────────────────

_PROVIDERS = {
    "groq": GroqProvider,
}


def get_provider(
    name: str = "groq",
    api_key: str | None = None,
    default_model: str | None = None,
) -> LLMProvider:
    """
    Factory function to create an LLM provider by name.

    Args:
        name:          Provider name ("groq", ...)
        api_key:       API key (or set via env var)
        default_model: Override the default model

    Returns:
        An initialized LLMProvider instance.
    """
    provider_cls = _PROVIDERS.get(name.lower())
    if not provider_cls:
        available = ", ".join(_PROVIDERS.keys())
        raise ValueError(f"Unknown provider '{name}'. Available: {available}")

    return provider_cls(api_key=api_key, default_model=default_model)
