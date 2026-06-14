"""
file_selector.py — Smart file selection for LLM context windows.

Scores and ranks files by importance, then selects the top N within a
token budget.  Uses data already computed by analyzer.py and classifier.py
so no extra I/O is needed.

Data shapes expected (verified from source):
  - file_list:      list[dict] from traverser.traverse_repo()["files"]
                     Each entry: { "path", "name", "extension", "language",
                                   "size", "size_formatted", "depth" }
  - analysis:       dict from analyzer.analyze_dependencies()
                     Keys: "edges", "adjacency", "reverse_adjacency",
                           "file_imports", "entry_points", "central_files", "stats"
                     entry_points:  list[dict] with { "file", "score", "reasons" }
                     central_files: list[dict] with { "file", "in_degree",
                                   "out_degree", "score", "role" }
  - classification: list[dict] from classifier.classify_files()
                     Each entry: { "path", "role", "role_label",
                                   "importance_score", "in_degree", "out_degree",
                                   "depends_on", "used_by", ... }
                     Roles: "entry_point", "orchestrator", "core_module",
                            "shared_utility", "internal_helper", "router",
                            "config", "test", "type_definition", "data",
                            "documentation", "build", "barrel", "leaf"
"""

from __future__ import annotations

import os
import re

from codekavi.config import MAX_FILES_FOR_LLM, MAX_TOTAL_INPUT_TOKENS


class SmartFileSelector:
    """Score every file in the repo and return the top N within a token budget."""

    MAX_FILES = MAX_FILES_FOR_LLM  # 30
    MAX_TOTAL_TOKENS = MAX_TOTAL_INPUT_TOKENS  # 80 000

    # ──────────────────────────────────────
    # Public API
    # ──────────────────────────────────────

    def select_files(
        self,
        file_list: list[dict],
        analysis: dict,
        classification: list[dict],
    ) -> list[dict]:
        """
        Score each file by importance and return up to *MAX_FILES* entries
        whose cumulative estimated token count stays under *MAX_TOTAL_TOKENS*.

        Returns a list of dicts:
            [ { "path": str, "score": float, "estimated_tokens": int }, ... ]
        sorted by score descending.
        """
        entry_point_files = {ep["file"] for ep in analysis.get("entry_points", [])}
        central_file_set = {cf["file"] for cf in analysis.get("central_files", [])}
        reverse_adj = analysis.get("reverse_adjacency", {})

        # Build a lookup from path → classifier profile
        profile_map: dict[str, dict] = {}
        for prof in classification:
            profile_map[prof["path"]] = prof

        scored: list[dict] = []
        for finfo in file_list:
            path = finfo["path"]
            profile = profile_map.get(path, {})

            score = self._score_file(
                path=path,
                reverse_adj=reverse_adj,
                central_file_set=central_file_set,
                entry_point_files=entry_point_files,
                profile=profile,
            )

            # Estimate tokens: 1 token ≈ 4 characters
            size_bytes = finfo.get("size", 0)
            estimated_tokens = max(size_bytes // 4, 1)

            scored.append(
                {
                    "path": path,
                    "score": round(score, 2),
                    "estimated_tokens": estimated_tokens,
                }
            )

        # Sort by score descending
        scored.sort(key=lambda x: x["score"], reverse=True)

        # Pick top N within token budget
        selected: list[dict] = []
        tokens_used = 0
        for item in scored:
            if len(selected) >= self.MAX_FILES:
                break
            if tokens_used + item["estimated_tokens"] > self.MAX_TOTAL_TOKENS:
                continue  # skip this file, try the next (smaller) one
            selected.append(item)
            tokens_used += item["estimated_tokens"]

        return selected

    # ──────────────────────────────────────
    # Scoring logic
    # ──────────────────────────────────────

    def _score_file(
        self,
        path: str,
        reverse_adj: dict,
        central_file_set: set[str],
        entry_point_files: set[str],
        profile: dict,
    ) -> float:
        """
        Compute a numeric importance score for a single file.

        Uses the ACTUAL role names emitted by classifier.py:
            entry_point, orchestrator, core_module, shared_utility,
            internal_helper, router, config, test, type_definition,
            data, documentation, build, barrel, leaf
        """
        score = 1.0  # default baseline
        role = profile.get("role", "")
        lower_path = path.lower()
        basename = os.path.basename(lower_path)

        # ── Role-based boosts ──
        role_bonuses = {
            "entry_point": 10,
            "core_module": 9,
            "orchestrator": 8,
            "shared_utility": 7,
            "router": 6,
            "config": 7,
            "type_definition": 4,
            "internal_helper": 3,
            "barrel": 2,
            "documentation": 2,
            "build": 1,
            "data": 1,
            "leaf": 0,
            "test": 0,
        }
        score += role_bonuses.get(role, 0)

        # ── Graph-based boosts ──
        if path in central_file_set:
            score += 5

        if path in entry_point_files:
            score += 8

        # High in-degree (many files depend on THIS file)
        in_degree = len(reverse_adj.get(path, []))
        score += min(in_degree * 1.5, 7)

        # ── Path-based boosts ──
        if re.search(r"(route|controller|api)", lower_path):
            score += 4
        if re.search(r"(model|schema)", lower_path):
            score += 3
        if "readme" in basename:
            score += 6

        # ── Path-based penalties ──
        if re.search(r"(test|spec|mock)", lower_path):
            score -= 3
        if re.search(r"(migration|generated|vendor|lock)", lower_path):
            score -= 5

        return max(score, 0)
