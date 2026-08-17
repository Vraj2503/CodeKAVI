"""routes/_errors.py — shared helper to scrub internal exception detail from client responses.

Unexpected (500-class) failures must never leak stack context, library
versions, or absolute file paths to the caller. Validation errors we raise
ourselves (e.g. ``HTTPException(400, detail=str(ValueError(...)))``) are
deliberate, safe messages and should NOT go through this helper.
"""

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def internal_error(exc: Exception, *, context: str, status: int = 500) -> HTTPException:
    """Log the full exception server-side and return a scrubbed HTTPException."""
    logger.error("%s: %s", context, exc, exc_info=True)
    return HTTPException(status_code=status, detail="Internal server error.")


def scrub_message(exc: Exception, *, context: str) -> str:
    """Log the full exception server-side and return a generic message for SSE/stream events."""
    logger.error("%s: %s", context, exc, exc_info=True)
    return "Internal server error."
