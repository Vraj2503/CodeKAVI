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
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from codekavi.exceptions import ProviderError

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
# Circuit breaker (T4.2)
# ─────────────────────────────────────────────
# A simple three-state (closed/open/half_open) breaker shared across both
# GroqProvider and GeminiProvider. The breaker short-circuits calls when the
# provider has failed repeatedly so callers don't pay the full 50s retry cost
# on every request — instead they get an immediate ProviderError, and
# routes/explain.py can swap in the deterministic-tour fallback.

_DEFAULT_FAILURE_THRESHOLD = 5
_DEFAULT_RESET_TIMEOUT = 60.0  # seconds


class CircuitBreaker:
    """
    Thread-safe three-state circuit breaker (closed | open | half_open).

    States:
      * closed     — normal operation; requests pass through.
      * open       — provider is failing; requests are rejected with no
                     network call. Auto-transitions to ``half_open`` after
                     ``reset_timeout`` seconds.
      * half_open  — single trial request allowed; success closes the
                     breaker, failure re-opens it for another full timeout.

    The breaker is provider-agnostic: wrap any callable with ``call_via`` or
    just construct one per provider instance (see GroqProvider / GeminiProvider).
    """

    def __init__(
        self,
        name: str = "provider",
        failure_threshold: int = _DEFAULT_FAILURE_THRESHOLD,
        reset_timeout: float = _DEFAULT_RESET_TIMEOUT,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self._lock = threading.Lock()
        self._failures = 0
        self._last_failure_time = 0.0
        self._state = "closed"  # closed | open | half_open

    # ── read-only telemetry ────────────────────────────────────────────

    @property
    def state(self) -> str:
        """Return the current state, auto-transitioning open→half_open if the timeout has passed."""
        with self._lock:
            self._maybe_close_to_half_open_locked()
            return self._state

    def snapshot(self) -> dict:
        """Cheap, lock-free snapshot for metrics/log endpoints."""
        return {
            "name": self.name,
            "state": self.state,
            "failures": self._failures,
            "threshold": self.failure_threshold,
            "reset_timeout": self.reset_timeout,
        }

    # ── core API ───────────────────────────────────────────────────────

    def can_execute(self) -> bool:
        """Return True if a call should be allowed right now."""
        with self._lock:
            self._maybe_close_to_half_open_locked()
            if self._state == "closed":
                return True
            # ``open`` rejects calls; ``half_open`` admits one trial.
            return self._state == "half_open"

    def record_success(self) -> None:
        """Mark a successful call — closes an open/half-open breaker."""
        with self._lock:
            previous = self._state
            if previous != "closed":
                logger.info(f"Circuit breaker[{self.name}] closing after success")
            self._failures = 0
            self._state = "closed"
        if previous != "closed":
            self._emit_transition(previous, "closed")

    def record_failure(self) -> None:
        """Mark a failed call — opens the breaker once threshold is reached."""
        with self._lock:
            previous = self._state
            self._failures += 1
            self._last_failure_time = time.time()
            if previous == "half_open":
                # trial failed — back to open for another full timeout
                self._state = "open"
                logger.warning(
                    f"Circuit breaker[{self.name}] re-opened after half-open trial failure"
                )
                self._emit_transition(previous, self._state)
                return
            if self._failures >= self.failure_threshold:
                if previous != "open":
                    logger.warning(
                        f"Circuit breaker[{self.name}] opened after "
                        f"{self._failures} failures (threshold={self.failure_threshold})"
                    )
                self._state = "open"
                if previous != "open":
                    self._emit_transition(previous, self._state)

    @staticmethod
    def _emit_transition(_from: str, _to: str) -> None:
        """T4.3 — emit a metric for the breaker state transition (best-effort)."""
        try:
            from codekavi.metrics import record_breaker_transition

            record_breaker_transition(_from or "unknown", _to)
        except Exception as e:
            logger.debug(f"breaker metric emit failed: {e}")

    def reset(self) -> None:
        """Force-close the breaker. Useful for tests and admin endpoints."""
        with self._lock:
            self._failures = 0
            self._state = "closed"

    # ── internals ──────────────────────────────────────────────────────

    def _maybe_close_to_half_open_locked(self) -> None:
        """Caller MUST hold ``self._lock``. Promote open→half_open once the timeout elapses."""
        if self._state == "open" and (time.time() - self._last_failure_time) > self.reset_timeout:
            self._state = "half_open"
            logger.info(
                f"Circuit breaker[{self.name}] half-open after {self.reset_timeout}s — admitting one trial"
            )


# Module-level breakers, one per provider. Shared across all provider
# instances (the codebase uses a single cached provider per process).
_breakers: dict[str, CircuitBreaker] = {}


def get_breaker(provider_name: str) -> CircuitBreaker:
    """Return (lazily creating) the shared CircuitBreaker for ``provider_name``."""
    if provider_name not in _breakers:
        _breakers[provider_name] = CircuitBreaker(name=provider_name)
    return _breakers[provider_name]


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
        # T4.2 — shared process-level breaker. ``record_success/record_failure``
        # are called from complete()/generate()/generate_stream() below.
        self._breaker = get_breaker("groq")
        logger.info(f"GroqProvider initialized with model={self.model_name}")

    # ─────────────────────────────────────────
    # Circuit breaker + quota hooks (T4.1, T4.2)
    # ─────────────────────────────────────────

    def _rejected_by_breaker(self) -> ProviderError | None:
        """Return a ProviderError if the breaker rejects this call, else None."""
        if self._breaker.can_execute():
            return None
        from codekavi.exceptions import ProviderError

        snapshot = self._breaker.snapshot()
        logger.warning(
            f"GroqProvider call rejected by circuit breaker "
            f"(state={snapshot['state']}, failures={snapshot['failures']})"
        )
        return ProviderError(
            "Circuit breaker open for groq — call rejected without network I/O",
            detail=f"state={snapshot['state']}, failures={snapshot['failures']}",
        )

    @staticmethod
    def _record_usage(user_id: str | None, provider: str, tokens: int, latency_ms: int) -> None:
        """T4.1 — record usage against TokenTracker (best-effort, never raises).

        T4.3 — adjacent: emit tokens + cost metrics to the Prometheus counters.
        """
        if not tokens:
            return
        try:
            from codekavi.quota import get_token_tracker

            tracker = get_token_tracker()
            tracker.record(user_id=user_id, provider=provider, tokens=tokens)
            cost = tracker.estimate_cost_usd(provider, tokens)
            try:
                from codekavi.metrics import record_llm_usage

                record_llm_usage(provider=provider, tokens=tokens, cost_usd=cost)
            except Exception as em:  # metric path is best-effort
                logger.debug(f"metrics emit skipped: {em}")
            logger.info(
                f"llm_usage provider={provider} tokens={tokens} cost_usd={cost:.6f} "
                f"latency_ms={latency_ms} user_id={user_id or 'anon'}",
                extra={
                    "stage": "llm_usage",
                    "token_count": tokens,
                    "estimated_cost_usd": cost,
                    "duration_ms": latency_ms,
                    "provider": provider,
                },
            )
        except Exception as e:  # never break the user-facing call
            logger.debug(f"quota record skipped: {e}")

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
        user_id: str | None = None,
    ) -> LLMResponse:
        """SYNCHRONOUS method. Retries on 429 with blocking sleep in thread."""
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

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
                err_str = str(e)
                is_rate_limit = "429" in err_str or "rate limit" in err_str.lower()
                if is_rate_limit and attempt < _MAX_RETRIES:
                    delay = _RETRY_DELAYS[attempt]
                    logger.warning(
                        f"Groq 429 rate limit hit (attempt {attempt + 1}/{_MAX_RETRIES}). Retrying in {delay}s..."
                    )
                    import time as time_module

                    time_module.sleep(delay)
                    continue
                logger.error(f"Groq API error: {e}")
                # T4.2 — any non-retry error trips the breaker so subsequent
                # requests don't pay the retry-tax.
                self._breaker.record_failure()
                if is_rate_limit:
                    from codekavi.exceptions import RateLimitError

                    raise RateLimitError(f"Groq rate limit exceeded: {e}", detail=err_str) from e
                from codekavi.exceptions import ProviderError

                raise ProviderError(f"Groq API call failed: {e}", detail=err_str) from e

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

        # T4.2 — successful path closes the breaker / clears failures.
        self._breaker.record_success()

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
        # T4.2 — breaker check before any network I/O.
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

        from typing import Any

        from codekavi.utils import current_executor

        messages: list[Any] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        loop = asyncio.get_running_loop()

        for attempt in range(_MAX_RETRIES + 1):
            try:
                start_ts = asyncio.get_event_loop().time()
                response = await loop.run_in_executor(
                    current_executor.get(None),
                    lambda: self._client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    ),
                )
                self._breaker.record_success()
                # T4.1 — record usage if the API returned token counts.
                usage_obj = getattr(response, "usage", None)
                tokens = int(getattr(usage_obj, "total_tokens", 0) or 0) if usage_obj else 0
                latency_ms = int((asyncio.get_event_loop().time() - start_ts) * 1000)
                if tokens:
                    self._record_usage(user_id=None, provider=self.name, tokens=tokens, latency_ms=latency_ms)
                return response.choices[0].message.content or ""
            except Exception as e:
                err_str = str(e)
                is_rate_limit = "429" in err_str or "rate limit" in err_str.lower()
                if is_rate_limit and attempt < _MAX_RETRIES:
                    delay = _RETRY_DELAYS[attempt]
                    logger.warning(
                        f"Groq 429 rate limit hit in generate() "
                        f"(attempt {attempt + 1}/{_MAX_RETRIES}). "
                        f"Retrying in {delay}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"Groq API error in generate(): {e}")
                # T4.2 — failures feed the breaker so subsequent calls fail fast.
                self._breaker.record_failure()
                if is_rate_limit:
                    from codekavi.exceptions import RateLimitError

                    raise RateLimitError(f"Groq rate limit exceeded in generate(): {e}", detail=err_str) from e
                from codekavi.exceptions import ProviderError

                raise ProviderError(f"Groq API call failed in generate(): {e}", detail=err_str) from e

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
        # T4.2 — refuse streaming outright when the breaker is open so callers
        # can fall back to a deterministic response (chat/stream contract).
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

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
        try:
            stream = await loop.run_in_executor(executor, _create_stream)
        except Exception as e:
            logger.error(f"Groq stream init failed: {e}")
            self._breaker.record_failure()
            from codekavi.exceptions import ProviderError

            raise ProviderError(f"Groq stream init failed: {e}") from e

        emitted_any = False
        while True:
            chunk = await loop.run_in_executor(executor, lambda: next(stream, None))
            if chunk is None:
                break
            if chunk.choices and chunk.choices[0].delta.content:
                emitted_any = True
                yield chunk.choices[0].delta.content
        if emitted_any:
            self._breaker.record_success()

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
        # T4.2 — shared process-level breaker for Gemini too.
        self._breaker = get_breaker("gemini")
        logger.info(f"GeminiProvider initialized with model={self.model_name}")

    # ─────────────────────────────────────────
    # Circuit breaker helpers (T4.2)
    # ─────────────────────────────────────────

    def _rejected_by_breaker(self) -> ProviderError | None:
        """Return a ProviderError if the breaker rejects this call, else None."""
        if self._breaker.can_execute():
            return None
        from codekavi.exceptions import ProviderError

        snapshot = self._breaker.snapshot()
        logger.warning(
            f"GeminiProvider call rejected by circuit breaker "
            f"(state={snapshot['state']}, failures={snapshot['failures']})"
        )
        return ProviderError(
            "Circuit breaker open for gemini — call rejected without network I/O",
            detail=f"state={snapshot['state']}, failures={snapshot['failures']}",
        )

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
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

        model_name = model or self.model_name

        system_parts = []
        user_parts = []
        for msg in messages:
            if msg.role == "system":
                system_parts.append(msg.content)
            else:
                user_parts.append(msg.content)

        user_content = "\n\n".join(user_parts) if user_parts else ""
        system_instruction = "\n\n".join(system_parts) if system_parts else None

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
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "rate limit"])
            # T4.2 — failures feed the breaker.
            self._breaker.record_failure()
            if is_rate_limit:
                from codekavi.exceptions import RateLimitError

                raise RateLimitError(f"Gemini rate limit exceeded: {e}", detail=err_str) from e
            from codekavi.exceptions import ProviderError

            raise ProviderError(f"Gemini API call failed: {e}", detail=err_str) from e

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

        self._breaker.record_success()

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
        # T4.2 — breaker check before any network I/O.
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

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
        try:
            response = await loop.run_in_executor(current_executor.get(None), _sync_call)
            self._breaker.record_success()
            return response.text or ""
        except Exception as e:
            logger.error(f"Gemini API error in generate(): {e}")
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "rate limit"])
            self._breaker.record_failure()
            if is_rate_limit:
                from codekavi.exceptions import RateLimitError

                raise RateLimitError(f"Gemini rate limit exceeded in generate(): {e}", detail=err_str) from e
            from codekavi.exceptions import ProviderError

            raise ProviderError(f"Gemini API call failed in generate(): {e}", detail=err_str) from e

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
        # T4.2 — refuse streaming when the breaker is open so callers can
        # degrade gracefully to a non-streaming fallback.
        rejected = self._rejected_by_breaker()
        if rejected is not None:
            raise rejected

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
        try:
            stream = await loop.run_in_executor(executor, _create_stream)
        except Exception as e:
            logger.error(f"Gemini stream init failed: {e}")
            self._breaker.record_failure()
            from codekavi.exceptions import ProviderError

            raise ProviderError(f"Gemini stream init failed: {e}") from e

        emitted_any = False
        while True:
            chunk = await loop.run_in_executor(executor, lambda: next(stream, None))
            if chunk is None:
                break
            if chunk.text:
                emitted_any = True
                yield chunk.text
        if emitted_any:
            self._breaker.record_success()

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


def validate_providers() -> None:
    """Verify configured models are reachable on startup."""
    import os

    # Skip during testing to avoid hitting live APIs
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return

    logger.info("Verifying LLM providers connectivity...")
    try:
        groq_provider = GroqProvider()
        groq_provider.complete([Message(role="user", content="ping")], max_tokens=2)
        logger.info("Groq connectivity verified.")
    except Exception as e:
        logger.error(f"Groq connectivity check failed: {e}")
        raise RuntimeError(f"Groq connectivity check failed: {e}") from e

    try:
        gemini_provider = GeminiProvider()
        gemini_provider._client.models.embed_content(  # type: ignore[attr-defined]
            model=settings.embedding_model,
            contents="ping",
        )
        logger.info("Gemini connectivity verified.")
    except Exception as e:
        logger.error(f"Gemini connectivity check failed: {e}")
        raise RuntimeError(f"Gemini connectivity check failed: {e}") from e
