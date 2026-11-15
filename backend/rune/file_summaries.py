"""
file_summaries.py — one written sentence per important file, once per analysis (T34).

A purpose line from the source exists for 35% of CodeKAVI's files and 1% of React's;
the rest get a line built from facts ("Defines: ..."), which says what a file holds
but not what it is for. This pass asks an LLM for one sentence per file, from the
facts the analysis already has (purpose, routes, symbols with signatures and doc
lines), never from file contents: about 200 input tokens a file.

It runs in the background after the record is saved: the top files by importance
(FILE_SUMMARY_MAX_FILES), 25 per call, so at most 6 calls for 150 files, and none
when a commit is reused (its origin's sentences are read through _origin_repo_id).
Sentences go into the fact store's `summary` field, which every view reads first
(fact_store.file_description); `summaries_status` goes onto the record. Any
failure leaves the views on their purpose lines.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from rune.config import shown_in_views
from rune.fact_store import facts_repo_id
from rune.llm.prompts import UNTRUSTED_CODE_DISCLAIMER
from rune.utils import run_sync

logger = logging.getLogger(__name__)

SUMMARY_BATCH = 25
MAX_SUMMARY_CHARS = 160
MAX_SYMBOLS_IN_PROMPT = 8
#: Roles a sentence adds little to: config and build files, re-export barrels.
_SKIPPED_ROLES = frozenset({"config", "build", "barrel"})

SYSTEM_PROMPT = (
    "You describe source files for an engineer who is new to a codebase. For each file listed, write "
    f"one sentence of at most {MAX_SUMMARY_CHARS} characters that says what the file does in this "
    "application, based only on the facts given. Do not start with the file name. Return only a JSON "
    "object that maps each file path, exactly as given, to its sentence.\n\n" + UNTRUSTED_CODE_DISCLAIMER
)


def pick_files(file_profiles: list[dict[str, Any]], facts: dict[str, dict], max_files: int) -> list[str]:
    """The most important files worth a sentence: not tests, docs, config or barrels, and with facts to go on."""
    ranked = sorted((p for p in file_profiles if p.get("path")), key=lambda p: -(p.get("importance_score") or 0))
    picked: list[str] = []
    for profile in ranked:
        path, role = profile["path"], profile.get("role")
        if role in _SKIPPED_ROLES or not shown_in_views(path, role) or path not in facts:
            continue
        picked.append(path)
        if len(picked) == max_files:
            break
    return picked


def build_prompt(batch: list[tuple[str, dict, str]]) -> str:
    """The facts for one batch: per file its role, purpose, routes and main symbols. No file contents."""
    blocks = []
    for path, file_facts, role_label in batch:
        lines = [f"## {path}", f"Role: {role_label or 'unknown'}"]
        if file_facts.get("purpose"):
            lines.append(f"Purpose: {file_facts['purpose']}")
        if file_facts.get("routes"):
            lines.append("Routes: " + ", ".join(file_facts["routes"][:5]))
        symbols = sorted(
            file_facts.get("symbols") or [], key=lambda s: (-(s.get("complexity") or 0), s.get("line") or 0)
        )
        for symbol in symbols[:MAX_SYMBOLS_IN_PROMPT]:
            text = f"- {symbol.get('kind', 'function')} {symbol.get('name', '')}{symbol.get('signature') or ''}"
            lines.append(text + (f": {symbol['doc']}" if symbol.get("doc") else ""))
        blocks.append("\n".join(lines))
    return (
        "Files:\n\n" + "\n\n".join(blocks) + '\n\nReturn JSON {"<file path>": "<one sentence>"} for every file above.'
    )


def parse_summaries(text: str, batch_paths: list[str]) -> dict[str, str]:
    """The sentences worth keeping: for paths in the batch, non-empty, one line, short enough."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    wanted = set(batch_paths)
    kept: dict[str, str] = {}
    for path, sentence in data.items():
        if path not in wanted or not isinstance(sentence, str):
            continue  # a path the model invented, or not a sentence
        sentence = " ".join(sentence.split())
        if sentence and len(sentence) <= MAX_SUMMARY_CHARS:
            kept[path] = sentence
    return kept


def _status(status: str, **counts: int) -> dict[str, Any]:
    return {"status": status, **counts}


async def summarize_files(repo_id: str, record: dict, cache: Any, user_id: str, provider: Any = None) -> None:
    """Background task: write a sentence for each important file of this analysis."""
    from rune.quota import get_token_tracker
    from rune.settings import settings

    if not settings.file_summaries:
        return
    source = facts_repo_id(record, repo_id)
    try:
        # The analyze routes pass the record as they built it, with FileProfile
        # objects, not the dicts a saved record holds: reading them as dicts
        # failed before the first call, and the job ended without a status.
        profiles = [p if isinstance(p, dict) else p.model_dump() for p in record.get("file_profiles") or []]
        roles = {p.get("path"): p.get("role_label") or p.get("role") or "" for p in profiles}
        # Facts for a margin of candidates, since some are skipped below.
        ranked = sorted((p for p in profiles if p.get("path")), key=lambda p: -(p.get("importance_score") or 0))
        candidates = [p["path"] for p in ranked[: settings.file_summary_max_files * 2]]
        facts = await run_sync(cache.facts.get, source, candidates)
        paths = pick_files(profiles, facts, settings.file_summary_max_files)
        if not paths:
            return

        if provider is None:
            from rune.llm.providers import get_provider

            provider = get_provider("file_summaries")
        tracker = get_token_tracker()
        summaries: dict[str, str] = {}
        calls = failed = 0
        stopped_by_quota = False
        for start in range(0, len(paths), SUMMARY_BATCH):
            batch = paths[start : start + SUMMARY_BATCH]
            if not tracker.check_quota(user_id):
                stopped_by_quota = True
                break
            try:
                text, _usage = await provider.generate_with_usage(
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=build_prompt([(path, facts[path], roles.get(path, "")) for path in batch]),
                    temperature=0.2,
                    max_tokens=4000,
                    json_mode=True,
                    user_id=user_id,
                )
                calls += 1
                summaries.update(parse_summaries(text, batch))
            except Exception as e:
                failed += 1
                logger.warning(f"File summaries for {repo_id}: a batch of {len(batch)} failed: {e}")

        if summaries:
            await run_sync(cache.facts.put_summaries, source, summaries)
        if stopped_by_quota:
            status = "quota_exceeded"
        elif not summaries:
            status = "failed"
        elif failed:
            status = "partial"
        else:
            status = "complete"
        logger.info(f"File summaries for {repo_id}: {status}, {len(summaries)} of {len(paths)} files in {calls} calls")
        await run_sync(
            cache.update,
            repo_id,
            {"summaries_status": _status(status, files=len(paths), summarized=len(summaries), calls=calls)},
        )
    except asyncio.CancelledError:
        await run_sync(cache.update, repo_id, {"summaries_status": _status("interrupted")})
        raise
    except Exception as e:
        logger.warning(f"File summaries for {repo_id} failed: {e}", exc_info=True)
        await run_sync(cache.update, repo_id, {"summaries_status": _status("failed")})
