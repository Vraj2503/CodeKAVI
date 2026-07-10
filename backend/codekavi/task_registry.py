"""
task_registry.py — Tracks in-flight FastAPI BackgroundTasks across shutdown.

H-02: BackgroundTasks (save_analysis, index_repository) run independently of
the io/cpu ThreadPoolExecutors. On shutdown, main.py drained the executors
but had no way to know whether a background task was still mid-flight — so
a repo could be half-indexed into Zilliz (or half-written to cache) if the
process stopped between the response being sent and the background task
finishing. This registry lets the shutdown handler wait (with a bounded
timeout) for tracked background work to actually finish first.
"""

import asyncio
import functools
import logging
import threading
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)


class BackgroundTaskRegistry:
    """Thread-safe in-flight counter for wrapped background callables."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._count = 0

    @property
    def in_flight(self) -> int:
        with self._lock:
            return self._count

    def _enter(self) -> None:
        with self._lock:
            self._count += 1

    def _exit(self) -> None:
        with self._lock:
            self._count -= 1

    def wrap(self, func: Callable[..., Any]) -> Callable[..., Any]:
        """Wrap a sync or async callable so it registers itself while running."""
        if asyncio.iscoroutinefunction(func):

            @functools.wraps(func)
            async def _tracked_async(*args: Any, **kwargs: Any) -> Any:
                self._enter()
                try:
                    return await func(*args, **kwargs)
                finally:
                    self._exit()

            return _tracked_async

        @functools.wraps(func)
        def _tracked_sync(*args: Any, **kwargs: Any) -> Any:
            self._enter()
            try:
                return func(*args, **kwargs)
            finally:
                self._exit()

        return _tracked_sync

    async def wait_for_drain(self, timeout: float, poll_interval: float = 0.25) -> None:
        """Poll until every tracked task finishes or ``timeout`` seconds elapse."""
        deadline = time.monotonic() + timeout
        while self.in_flight > 0:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            await asyncio.sleep(min(poll_interval, remaining))

        remaining = self.in_flight
        if remaining:
            logger.warning(
                f"Background task drain timed out after {timeout}s with "
                f"{remaining} task(s) still in flight; proceeding with shutdown anyway."
            )
