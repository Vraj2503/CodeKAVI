"""
codekavi.exceptions — Custom exceptions for CodeKavi.
"""


class CodeKaviError(Exception):
    """Base exception for all CodeKavi errors."""

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class ProviderError(CodeKaviError):
    """Exception raised when an LLM provider fails."""

    pass


class RateLimitError(CodeKaviError):
    """Exception raised when API rate limits are exceeded."""

    pass


class CloneError(CodeKaviError):
    """Exception raised when repository cloning fails."""

    pass


class VectorStoreError(CodeKaviError):
    """Exception raised when vector database operations fail."""

    pass
