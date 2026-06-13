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
)


def _detect_language(filepath: str) -> str:
    """Detect file language from its name or extension."""
    basename = os.path.basename(filepath)

    # Check special filenames first
    if basename in FILENAME_LANGUAGE_MAP:
        return FILENAME_LANGUAGE_MAP[basename]

    # Check extension
    _, ext = os.path.splitext(basename)
    ext = ext.lower()
    if ext in EXTENSION_LANGUAGE_MAP:
        return EXTENSION_LANGUAGE_MAP[ext]

    return "Unknown"


def _should_ignore_dir(dirname: str) -> bool:
    """Check if a directory should be skipped."""
    return dirname in IGNORED_DIRS or dirname.startswith(".")


def _should_ignore_file(filepath: str) -> bool:
    """Check if a file should be skipped based on name, extension, or size."""
    basename = os.path.basename(filepath)

    # Ignored filenames
    if basename in IGNORED_FILES:
        return True

    # Ignored extensions
    _, ext = os.path.splitext(basename)
    if ext.lower() in IGNORED_EXTENSIONS:
        return True

    # Skip hidden files
    if basename.startswith(".") and basename not in FILENAME_LANGUAGE_MAP:
        return True

    # Skip files that are too large
    try:
        if os.path.getsize(filepath) > MAX_FILE_SIZE_BYTES:
            return True
    except OSError:
        return True

    return False


def _format_size(size_bytes: int) -> str:
    """Human-readable file size."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def traverse_repo(clone_path: str) -> dict:
    """
    Walk through the cloned repo and collect metadata for all relevant files.

    Returns:
        dict with:
          - total_files: int
          - total_size: int (bytes)
          - total_size_formatted: str
          - languages: dict[str, int]  (language → file count)
          - tree: list of dicts (hierarchical folder structure)
          - files: list of dicts (flat list of file metadata)
    """
    all_files = []
    languages: dict[str, int] = {}
    total_size = 0

    # Build a hierarchical tree structure
    tree = _build_tree(clone_path, clone_path)

    # Also build a flat file list with metadata
    for root, dirs, files in os.walk(clone_path):
        # Filter out ignored directories (modifying dirs in-place prunes os.walk)
        dirs[:] = sorted([d for d in dirs if not _should_ignore_dir(d)])

        for filename in sorted(files):
            filepath = os.path.join(root, filename)

            if _should_ignore_file(filepath):
                continue

            rel_path = os.path.relpath(filepath, clone_path)
            file_size = os.path.getsize(filepath)
            language = _detect_language(filepath)

            # Track language stats
            languages[language] = languages.get(language, 0) + 1
            total_size += file_size

            all_files.append({
                "path": rel_path,
                "name": filename,
                "extension": os.path.splitext(filename)[1].lower(),
                "language": language,
                "size": file_size,
                "size_formatted": _format_size(file_size),
                "depth": rel_path.count(os.sep),
            })

    # Sort languages by count (descending)
    sorted_languages = dict(sorted(languages.items(), key=lambda x: x[1], reverse=True))

    return {
        "total_files": len(all_files),
        "total_size": total_size,
        "total_size_formatted": _format_size(total_size),
        "languages": sorted_languages,
        "tree": tree,
        "files": all_files,
    }


def _build_tree(current_path: str, root_path: str) -> list:
    """
    Recursively build a nested tree structure for the directory.

    Each node:
      - name: str
      - type: "dir" | "file"
      - path: relative path from root
      - children: list (only for dirs)
      - size, size_formatted, language (only for files)
    """
    from typing import Any
    entries: list[dict[str, Any]] = []

    try:
        items = sorted(os.listdir(current_path))
    except PermissionError:
        return entries

    # Directories first, then files
    dirs = []
    files = []

    for item in items:
        item_path = os.path.join(current_path, item)
        if os.path.isdir(item_path):
            if not _should_ignore_dir(item):
                dirs.append(item)
        else:
            if not _should_ignore_file(item_path):
                files.append(item)

    for d in dirs:
        dir_path = os.path.join(current_path, d)
        rel_path = os.path.relpath(dir_path, root_path)
        children = _build_tree(dir_path, root_path)
        entries.append({
            "name": d,
            "type": "dir",
            "path": rel_path,
            "children": children,
        })

    for f in files:
        file_path = os.path.join(current_path, f)
        rel_path = os.path.relpath(file_path, root_path)
        file_size = os.path.getsize(file_path)
        entries.append({
            "name": f,
            "type": "file",
            "path": rel_path,
            "size": file_size,
            "size_formatted": _format_size(file_size),
            "language": _detect_language(file_path),
        })

    return entries
