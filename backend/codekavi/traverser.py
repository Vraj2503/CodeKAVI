"""
traverser.py — Walks through a cloned repository, filters irrelevant
files/directories, and collects structured metadata for each file.
"""

import os

from codekavi.config import (
    EXTENSION_LANGUAGE_MAP,
    FILENAME_LANGUAGE_MAP,
    IGNORED_DIRS,
    IGNORED_EXTENSIONS,
    IGNORED_FILES,
    MAX_FILE_SIZE_BYTES,
    MAX_NOTEBOOK_SIZE_BYTES,
    detect_language,
)
from codekavi.pipeline_models import RepoData, FileEntry
from codekavi.settings import settings


def _should_ignore_dir(dirname: str) -> bool:
    """Check if a directory should be skipped."""
    return dirname in IGNORED_DIRS or dirname.startswith(".")


def _get_skip_reason(filepath: str, size: int | None = None) -> str | None:
    """
    Return a human-readable reason why ``filepath`` was skipped, or ``None`` if
    the file is keepable. Centralised so traverse_repo() can surface skip
    reasons to the API caller.
    """
    basename = os.path.basename(filepath)

    if basename in IGNORED_FILES:
        return "ignored_filename"

    _, ext = os.path.splitext(basename)
    if ext.lower() in IGNORED_EXTENSIONS:
        return "ignored_extension"

    if basename.startswith(".") and basename not in FILENAME_LANGUAGE_MAP:
        return "hidden_file"

    if size is None:
        try:
            size = os.path.getsize(filepath)
        except OSError:
            return "unreadable"

    max_size = MAX_NOTEBOOK_SIZE_BYTES if ext.lower() == ".ipynb" else MAX_FILE_SIZE_BYTES
    if size > max_size:
        return f"exceeds_max_size_{max_size // 1024}KB"

    return None


def _format_size(size_bytes: int) -> str:
    """Human-readable file size."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def traverse_repo(clone_path: str) -> RepoData:
    """
    Walk through the cloned repo and collect metadata for all relevant files.
    Builds both the flat file list and the hierarchical tree in a single pass.
    """
    all_files = []
    languages: dict[str, int] = {}
    total_size = 0
    skipped_files: list[dict] = []
    # H-14: cap total pre-loaded content bytes at the same bound the downstream
    # BoundedContentCache enforces, so traversal of large monorepos (e.g. 10k+
    # small files) can't pile up hundreds of MB of file content in RepoData.files
    # before it ever reaches the bounded cache.
    preloaded_content_bytes = 0

    def _walk_tree(current_path: str) -> list[dict]:
        nonlocal total_size, preloaded_content_bytes
        entries = []
        dirs = []
        files = []

        try:
            with os.scandir(current_path) as it:
                for entry in it:
                    if entry.is_dir(follow_symlinks=False):
                        if not _should_ignore_dir(entry.name):
                            dirs.append((entry.name, entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        try:
                            stat_res = entry.stat()
                            files.append((entry.name, entry.path, stat_res))
                        except OSError:
                            continue
        except OSError:
            return entries

        # Sort to ensure deterministic output
        dirs.sort(key=lambda x: x[0])
        files.sort(key=lambda x: x[0])

        for d_name, d_path in dirs:
            rel_path = os.path.relpath(d_path, clone_path)
            children = _walk_tree(d_path)
            entries.append(
                {
                    "name": d_name,
                    "type": "dir",
                    "path": rel_path,
                    "children": children,
                }
            )

        for f_name, f_path, stat_res in files:
            rel_path = os.path.relpath(f_path, clone_path)
            file_size = stat_res.st_size

            skip_reason = _get_skip_reason(f_path, file_size)
            if skip_reason:
                skipped_files.append(
                    {
                        "path": rel_path,
                        "size": file_size,
                        "size_formatted": _format_size(file_size),
                        "reason": skip_reason,
                    }
                )
                entries.append(
                    {
                        "name": f_name,
                        "type": "skipped",
                        "path": rel_path,
                        "reason": skip_reason,
                    }
                )
                continue

            language = detect_language(f_path)
            languages[language] = languages.get(language, 0) + 1
            total_size += file_size

            # Read content if file is < 100KB to prevent subsequent disk reads,
            # but only while the running total stays within the same byte
            # budget the BoundedContentCache enforces downstream (H-14) —
            # otherwise a monorepo with thousands of small files can OOM the
            # worker before content is ever handed to the bounded cache.
            content = None
            if file_size < 100 * 1024 and preloaded_content_bytes + file_size <= settings.max_content_cache_bytes:
                try:
                    with open(f_path, "r", encoding="utf-8") as f_obj:
                        content = f_obj.read()
                    preloaded_content_bytes += file_size
                except UnicodeDecodeError:
                    pass
                except Exception:
                    pass

            file_entry = FileEntry(
                path=rel_path,
                name=f_name,
                extension=os.path.splitext(f_name)[1].lower(),
                language=language,
                size=file_size,
                size_formatted=_format_size(file_size),
                depth=rel_path.count(os.sep),
                mtime=stat_res.st_mtime,
                content=content,
            )

            all_files.append(file_entry)

            entries.append(
                {
                    "name": f_name,
                    "type": "file",
                    "path": rel_path,
                    "size": file_size,
                    "size_formatted": _format_size(file_size),
                    "language": language,
                }
            )

        return entries

    tree = _walk_tree(clone_path)
    sorted_languages = dict(sorted(languages.items(), key=lambda x: x[1], reverse=True))

    return RepoData(
        total_files=len(all_files),
        total_size=total_size,
        total_size_formatted=_format_size(total_size),
        languages=sorted_languages,
        tree=tree,
        files=all_files,
        skipped_files=skipped_files,
    )
