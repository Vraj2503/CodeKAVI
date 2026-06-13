"""
helpers.py — Shared utility functions.

A leaf utility module imported by main.py and src/index.js (conceptually).
Tests: shared_utility role detection, high in-degree scoring.
"""

import re


def format_greeting(name: str) -> str:
    """Format a greeting message."""
    return f"Hello, {name}!"


def validate_input(value: str) -> str:
    """Validate and sanitize input."""
    if not value or not isinstance(value, str):
        raise ValueError("Input must be a non-empty string")
    # Strip anything that's not alphanumeric or space
    cleaned = re.sub(r"[^\w\s]", "", value)
    return cleaned.strip()


CONFIG = {
    "max_retries": 3,
    "timeout_s": 30,
}
