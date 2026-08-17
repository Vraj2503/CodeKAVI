"""
rune.llm — LLM explanation pipeline.

Multi-provider abstraction for generating code explanations,
architecture summaries, and file-level annotations.
"""

from rune.llm.explainer import Explainer
from rune.llm.providers import GeminiProvider, GroqProvider, get_provider

__all__ = [
    "Explainer",
    "GeminiProvider",
    "GroqProvider",
    "get_provider",
]
