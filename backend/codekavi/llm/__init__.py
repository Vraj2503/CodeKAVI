"""
codekavi.llm — LLM explanation pipeline.

Multi-provider abstraction for generating code explanations,
architecture summaries, and file-level annotations.
"""

from codekavi.llm.providers import GeminiProvider, get_provider
from codekavi.llm.explainer import Explainer

__all__ = [
    "GeminiProvider",
    "get_provider",
    "Explainer",
]
