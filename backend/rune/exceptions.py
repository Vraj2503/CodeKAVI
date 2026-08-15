"""
rune.exceptions — Custom exceptions for Rune.
"""


class RuneError(Exception):
    """Base exception for all Rune errors."""

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class ProviderError(RuneError):
    """Exception raised when an LLM provider fails."""

    pass


class RateLimitError(RuneError):
    """Exception raised when API rate limits are exceeded."""

    pass


class CloneError(RuneError):
    """Exception raised when repository cloning fails."""

    pass


class VectorStoreError(RuneError):
    """Exception raised when vector database operations fail."""

    pass


class IndexingError(RuneError):
    """Exception raised when embedding/chunk data is misaligned or fails to persist."""

    pass
