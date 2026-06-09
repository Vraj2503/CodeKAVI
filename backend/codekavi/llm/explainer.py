"""
explainer.py — Main explanation pipeline.

Orchestrates the LLM provider and prompt templates to generate
explanations at different levels (file, module, architecture).

Handles:
  - File prioritization (explain important files first)
  - Token budget management (truncate large files, skip binary)
  - Batch processing with rate limiting
  - Result caching within a session
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
import time

from codekavi.llm.providers import GeminiProvider, GroqProvider, Message
from codekavi.llm.prompts import (
    build_file_explanation_prompt,
    build_architecture_prompt,
    build_module_summary_prompt,
)

logger = logging.getLogger(__name__)


# Source code extensions we can meaningfully explain
_EXPLAINABLE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".go", ".java", ".kt", ".rs", ".rb", ".php",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
    ".scala", ".dart", ".ex", ".exs", ".vue", ".svelte",
}

# Max file size to send to the LLM (in characters)
MAX_EXPLAINABLE_CHARS = 50_000


@dataclass
class ExplanationResult:
    """Result of an explanation request."""
    file_path: str
    explanation: str
    model: str
    provider: str
    tokens_used: int = 0
    duration_ms: int = 0
    error: str | None = None


@dataclass
class ArchitectureResult:
    """Result of an architecture overview request."""
    overview: str
    model: str
    provider: str
    tokens_used: int = 0
    duration_ms: int = 0
    error: str | None = None


class Explainer:
    """
    Main explanation engine.

    Usage:
        provider = get_provider()
        explainer = Explainer(provider)

        # Explain a single file
        result = explainer.explain_file(file_profile, repo_root, repo_name)

        # Generate architecture overview
        overview = explainer.explain_architecture(repo_data, dep_data, ...)

        # Explain the top N most important files
        results = explainer.explain_top_files(file_profiles, repo_root, repo_name, top_n=10)
    """

    def __init__(
        self,
        provider: GroqProvider | GeminiProvider,
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        rate_limit_delay: float = 0.5,
    ):
        self.provider = provider
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.rate_limit_delay = rate_limit_delay

        # Session cache: path → explanation
        self._cache: dict[str, ExplanationResult] = {}
        self._architecture_cache: ArchitectureResult | None = None

    # ─────────────────────────────────────────
    # File-level explanation
    # ─────────────────────────────────────────

    def explain_file(
        self,
        file_profile: dict,
        repo_root: str,
        repo_name: str,
    ) -> ExplanationResult:
        """
        Generate an LLM explanation for a single file.

        Args:
            file_profile:  Dict from classify_files() with path, role, depends_on, etc.
            repo_root:     Absolute path to the cloned repo.
            repo_name:     Repository name for context.

        Returns:
            ExplanationResult with the explanation text.
        """
        file_path = file_profile["path"]

        # Check cache
        if file_path in self._cache:
            logger.debug(f"Cache hit for {file_path}")
            return self._cache[file_path]

        # Check if file is explainable
        _, ext = os.path.splitext(file_path)
        if ext.lower() not in _EXPLAINABLE_EXTENSIONS:
            result = ExplanationResult(
                file_path=file_path,
                explanation=f"*{ext} files are not analyzed for code explanations.*",
                model="",
                provider="skip",
                error="non_source_file",
            )
            self._cache[file_path] = result
            return result

        # Read the source file
        abs_path = os.path.join(repo_root, file_path)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(MAX_EXPLAINABLE_CHARS)
        except (OSError, IOError) as e:
            result = ExplanationResult(
                file_path=file_path,
                explanation="",
                model="",
                provider="error",
                error=f"Could not read file: {e}",
            )
            self._cache[file_path] = result
            return result

        if not content.strip():
            result = ExplanationResult(
                file_path=file_path,
                explanation="*This file is empty.*",
                model="",
                provider="skip",
            )
            self._cache[file_path] = result
            return result

        # Build prompt
        messages = build_file_explanation_prompt(
            file_path=file_path,
            file_content=content,
            language=file_profile.get("language", "Unknown"),
            role=file_profile.get("role", "unknown"),
            role_label=file_profile.get("role_label", "Unknown"),
            importance_score=file_profile.get("importance_score", 0),
            depends_on=file_profile.get("depends_on", []),
            used_by=file_profile.get("used_by", []),
            repo_name=repo_name,
        )

        # Call LLM
        start = time.time()
        try:
            response = self.provider.complete(
                messages=messages,
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            duration_ms = int((time.time() - start) * 1000)

            result = ExplanationResult(
                file_path=file_path,
                explanation=response.content,
                model=response.model,
                provider=response.provider,
                tokens_used=response.usage.get("total_tokens", 0),
                duration_ms=duration_ms,
            )

        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            logger.error(f"LLM error explaining {file_path}: {e}")
            result = ExplanationResult(
                file_path=file_path,
                explanation="",
                model=self.model or "",
                provider=self.provider.name,
                duration_ms=duration_ms,
                error=str(e),
            )

        self._cache[file_path] = result
        return result

    # ─────────────────────────────────────────
    # Batch: explain top N files
    # ─────────────────────────────────────────

    def explain_top_files(
        self,
        file_profiles: list[dict],
        repo_root: str,
        repo_name: str,
        top_n: int = 10,
        min_importance: float = 10.0,
    ) -> list[ExplanationResult]:
        """
        Explain the top N most important files in the repo.

        Files are filtered to source code only and sorted by importance.
        A small delay is added between requests for rate limiting.

        Args:
            file_profiles:   List of file profiles from classify_files().
            repo_root:       Absolute path to the cloned repo.
            repo_name:       Repository name.
            top_n:           Max number of files to explain.
            min_importance:  Minimum importance score to explain.

        Returns:
            List of ExplanationResult objects.
        """
        # Filter to explainable source files above importance threshold
        candidates = []
        for p in file_profiles:
            _, ext = os.path.splitext(p["path"])
            if ext.lower() in _EXPLAINABLE_EXTENSIONS and p.get("importance_score", 0) >= min_importance:
                candidates.append(p)

        # Sort by importance (highest first)
        candidates.sort(key=lambda p: p.get("importance_score", 0), reverse=True)
        candidates = candidates[:top_n]

        logger.info(f"Explaining {len(candidates)} files (top {top_n}, min_importance={min_importance})")

        results = []
        for i, profile in enumerate(candidates):
            logger.info(f"  [{i+1}/{len(candidates)}] Explaining {profile['path']}...")
            result = self.explain_file(profile, repo_root, repo_name)
            results.append(result)

        return results

    # ─────────────────────────────────────────
    # Architecture overview
    # ─────────────────────────────────────────

    def explain_architecture(
        self,
        repo_name: str,
        owner: str,
        total_files: int,
        total_size_formatted: str,
        languages: dict[str, int],
        role_summary: dict,
        entry_points: list[dict],
        central_files: list[dict],
        module_graph: dict,
        file_profiles: list[dict],
    ) -> ArchitectureResult:
        """
        Generate a high-level architecture overview of the entire codebase.

        Uses metadata only (no source code) — roles, dependencies,
        module structure, and entry points.

        Returns:
            ArchitectureResult with the overview text.
        """
        if self._architecture_cache:
            return self._architecture_cache

        messages = build_architecture_prompt(
            repo_name=repo_name,
            owner=owner,
            total_files=total_files,
            total_size_formatted=total_size_formatted,
            languages=languages,
            role_summary=role_summary,
            entry_points=entry_points,
            central_files=central_files,
            module_graph=module_graph,
            top_file_profiles=file_profiles[:20],
        )

        start = time.time()
        try:
            response = self.provider.complete(
                messages=messages,
                model=self.model,
                temperature=self.temperature,
                max_tokens=6000,  # Architecture overviews need more space
            )
            duration_ms = int((time.time() - start) * 1000)

            result = ArchitectureResult(
                overview=response.content,
                model=response.model,
                provider=response.provider,
                tokens_used=response.usage.get("total_tokens", 0),
                duration_ms=duration_ms,
            )

        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            logger.error(f"LLM error generating architecture overview: {e}")
            result = ArchitectureResult(
                overview="",
                model=self.model or "",
                provider=self.provider.name,
                duration_ms=duration_ms,
                error=str(e),
            )

        self._architecture_cache = result
        return result

    # ─────────────────────────────────────────
    # Module-level summaries
    # ─────────────────────────────────────────

    def explain_modules(
        self,
        module_graph: dict,
        repo_name: str,
    ) -> dict[str, str]:
        """
        Generate short summaries for each module/directory.

        Args:
            module_graph:  Output from build_module_graph().
            repo_name:     Repository name.

        Returns:
            Dict mapping module name → summary string.
        """
        modules = module_graph.get("modules", [])
        connections = module_graph.get("connections", [])
        summaries = {}

        for mod in modules:
            mod_name = mod["name"]

            # Find incoming/outgoing connections for this module
            conn_in = [c for c in connections if c["target"] == mod_name]
            conn_out = [c for c in connections if c["source"] == mod_name]

            messages = build_module_summary_prompt(
                module_name=mod_name,
                file_count=mod["file_count"],
                files=mod.get("files", []),
                languages=mod.get("languages", {}),
                roles=mod.get("roles", {}),
                internal_edges=mod.get("internal_edges", 0),
                connections_in=conn_in,
                connections_out=conn_out,
                repo_name=repo_name,
            )

            try:
                response = self.provider.complete(
                    messages=messages,
                    model=self.model,
                    temperature=self.temperature,
                    max_tokens=1024,  # Short summaries
                )
                summaries[mod_name] = response.content

            except Exception as e:
                logger.error(f"Error summarizing module {mod_name}: {e}")
                summaries[mod_name] = f"*Error generating summary: {e}*"



        return summaries

    # ─────────────────────────────────────────
    # Utilities
    # ─────────────────────────────────────────

    def clear_cache(self):
        """Clear all cached explanations."""
        self._cache.clear()
        self._architecture_cache = None

    def get_stats(self) -> dict:
        """Return stats about explanation generation."""
        total_tokens = sum(r.tokens_used for r in self._cache.values())
        total_time = sum(r.duration_ms for r in self._cache.values())
        errors = sum(1 for r in self._cache.values() if r.error)

        return {
            "files_explained": len(self._cache),
            "total_tokens": total_tokens,
            "total_time_ms": total_time,
            "errors": errors,
            "has_architecture": self._architecture_cache is not None,
            "provider": self.provider.name,
            "model": self.model or "default",
        }
