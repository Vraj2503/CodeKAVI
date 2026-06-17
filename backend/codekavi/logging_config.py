"""
codekavi.logging_config — JSON-structured logging config & middleware.
"""

import json
import logging
import uuid
from contextvars import ContextVar
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from codekavi.settings import settings

# ContextVars to hold request_id and repo_id context across async boundaries
request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
repo_id_ctx: ContextVar[str | None] = ContextVar("repo_id", default=None)


class JSONFormatter(logging.Formatter):
    """
    Formatter that outputs logs as a single-line JSON object.
    Includes request_id and repo_id from ContextVars, plus stage and duration.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_data: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "filename": record.filename,
            "lineno": record.lineno,
        }

        # Add context fields if present
        req_id = request_id_ctx.get()
        if req_id:
            log_data["request_id"] = req_id

        rep_id = repo_id_ctx.get()
        if rep_id:
            log_data["repo_id"] = rep_id

        # Extract extra fields if present
        for key in ("stage", "duration_ms", "token_count", "estimated_cost_usd", "cache_tier", "hit"):
            if hasattr(record, key):
                log_data[key] = getattr(record, key)

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware that generates/propagates a Request ID.
    Attaches the ID as a header on the response.
    """

    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token = request_id_ctx.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = req_id
            return response
        finally:
            request_id_ctx.reset(token)


def setup_logging() -> None:
    """Configures the root logger to use JSONFormatter and configures Sentry if DSN is set."""
    root_logger = logging.getLogger()

    # Optional Sentry integration
    sentry_dsn = getattr(settings, "sentry_dsn", "")
    if sentry_dsn:
        try:
            import sentry_sdk

            sentry_sdk.init(dsn=sentry_dsn)
            root_logger.info("Sentry SDK initialized successfully")
        except ImportError:
            root_logger.warning("sentry-sdk not installed; skipping Sentry initialization")

    # Reconfigure handlers for structured console logs
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(JSONFormatter())
    root_logger.addHandler(console_handler)
    root_logger.setLevel(logging.INFO)
