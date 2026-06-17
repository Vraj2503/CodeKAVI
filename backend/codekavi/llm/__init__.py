"""
codekavi.llm — LLM explanation pipeline.

Multi-provider abstraction for generating code explanations,
architecture summaries, and file-level annotations.
"""

from codekavi.llm.explainer import Explainer
from codekavi.llm.providers import GeminiProvider, GroqProvider, get_provider

__all__ = [
    "Explainer",
    "GeminiProvider",
    "GroqProvider",
    "get_provider",
]
