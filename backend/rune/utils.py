"""
rune.utils — Shared utility functions for Rune.
"""

import asyncio
import logging
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from functools import partial
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ContextVar to hold the request-scoped or lifespan-scoped ThreadPoolExecutor.
# Avoids using a module-level mutable global.
current_io_executor: ContextVar[ThreadPoolExecutor] = ContextVar("current_io_executor")
current_cpu_executor: ContextVar[ThreadPoolExecutor] = ContextVar("current_cpu_executor")


async def run_sync(func, *args, executor_type='io', **kwargs):
    """
    Run a synchronous function in the appropriate executor.
    Falls back to the event loop's default executor if none is set.
    """
    loop = asyncio.get_running_loop()
    try:
        executor = current_cpu_executor.get() if executor_type == 'cpu' else current_io_executor.get()
    except LookupError:
        executor = None  # type: ignore[assignment]
    return await loop.run_in_executor(executor, partial(func, *args, **kwargs))


class BoundedContentCache:
    """
    Size-bounded LRU cache for file contents during classification/analysis.
    Prevents memory blow-up on large repositories by evicting least-recently used
    file contents when the total size in bytes exceeds max_bytes.
    """

    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        self.current_bytes = 0
        self.cache: OrderedDict[str, tuple[str, int]] = OrderedDict()

    def __setitem__(self, key: str, value: str) -> None:
        val_bytes = len(value.encode("utf-8", errors="ignore"))

        # If a single file content is larger than the cache limit, do not cache it
        if val_bytes > self.max_bytes:
            return

        # Evict oldest entries until we have enough space
        while self.current_bytes + val_bytes > self.max_bytes and self.cache:
            _oldest_key, (_, oldest_val_bytes) = self.cache.popitem(last=False)
            self.current_bytes -= oldest_val_bytes

        self.cache[key] = (value, val_bytes)
        self.current_bytes += val_bytes

    def __getitem__(self, key: str) -> str:
        if key in self.cache:
            # Move to end (MRU)
            self.cache.move_to_end(key)
            return self.cache[key][0]
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key][0]
        return default

    def pop(self, key: str, default: Any = None) -> Any:
        if key in self.cache:
            val, val_bytes = self.cache.pop(key)
            self.current_bytes -= val_bytes
            return val
        return default

    def __contains__(self, key: str) -> bool:
        return key in self.cache

    def clear(self) -> None:
        self.cache.clear()
        self.current_bytes = 0


def get_explainer(model: str | None = None):
    """
    Create an Explainer instance with the current provider.
    Raises HTTPException if GROQ_API_KEY is not set.
    """
    from rune.llm import Explainer, get_provider
    from rune.settings import settings

    api_key = settings.groq_api_key
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY environment variable not set. Set it to your Groq API key to enable LLM explanations.",
        )

    provider = get_provider()
    return Explainer(provider, model=model)
