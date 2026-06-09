"""
codekavi.utils — Shared utility functions for route handlers.

Consolidates duplicated helper functions:
  - run_sync: runs a sync function in a shared thread-pool executor
  - get_explainer: creates an Explainer with the current provider
"""

import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from fastapi import HTTPException

# Single shared executor for all route handlers (avoids multiple separate pools)
_executor = ThreadPoolExecutor(max_workers=16)


async def run_sync(func, *args, **kwargs):
    """Run a synchronous function in the shared thread-pool executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _executor, partial(func, *args, **kwargs)
    )


def get_explainer(model: str | None = None):
    """
    Create an Explainer instance with the current provider.
    Raises HTTPException if GEMINI_API_KEY is not set.
    """
    from codekavi.llm import get_provider, Explainer

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="GEMINI_API_KEY environment variable not set. "
                   "Set it to your Gemini API key to enable LLM explanations."
        )

    provider = get_provider()
    return Explainer(provider, model=model)
