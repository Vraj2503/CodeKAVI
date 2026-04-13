"""
prompts.py — Prompt templates for code explanation generation.

Each template is a function that takes structured data and returns
a list of Messages ready for the LLM provider.

Prompt design principles:
  - Give the LLM rich context (file role, dependencies, codebase structure)
  - Ask for specific, structured output
  - Keep system prompts focused and expert-level
  - Use Markdown formatting in responses for the HTML artifact
"""

from __future__ import annotations
from codekavi.llm.providers import Message


# ─────────────────────────────────────────────
# System prompts
# ─────────────────────────────────────────────

SYSTEM_CODE_ANALYST = """You are CodeKavi, an expert code analyst that explains codebases to developers.

Your explanations should be:
- Clear and precise — assume the reader is a developer but new to this codebase
- Structured with Markdown headings, bullet points, and code references
- Focused on WHY and HOW, not just WHAT
- Highlighting architectural decisions, patterns, and relationships
- Concise but thorough — no filler text

When referencing code, use backtick formatting for identifiers like `function_name` or `ClassName`.
When mentioning files, use their relative paths like `src/utils/helper.py`."""


SYSTEM_ARCHITECTURE_ANALYST = """You are CodeKavi, an expert software architect who explains how codebases are structured.

Your job is to produce a clear, narrative explanation of a codebase's architecture.
Think of it as writing the "Architecture Guide" that a new team member would read on day one.

Your explanations should:
- Start with a high-level overview (what does this project do?)
- Describe the major components/modules and their responsibilities
- Explain how data flows through the system
- Highlight key design patterns and architectural decisions
- Note any notable dependencies or third-party integrations
- Use Markdown formatting with clear headings and structure

Be specific — reference actual file names, modules, and function names from the codebase."""


# ─────────────────────────────────────────────
# File-level explanation prompts
# ─────────────────────────────────────────────

def build_file_explanation_prompt(
    file_path: str,
    file_content: str,
    language: str,
    role: str,
    role_label: str,
    importance_score: float,
    depends_on: list[str],
    used_by: list[str],
    repo_name: str,
    max_content_chars: int = 12000,
) -> list[Message]:
    """
    Build a prompt to explain what a single file does.

    Args:
        file_path:         Relative path of the file
        file_content:      Source code of the file (will be truncated if too long)
        language:          Programming language
        role:              Classification role (entry_point, core_module, etc.)
        role_label:        Human-readable role label
        importance_score:  0-100 importance score
        depends_on:        List of files this file imports
        used_by:           List of files that import this file
        repo_name:         Repository name for context
        max_content_chars: Max characters of source code to include

    Returns:
        List of Messages for the LLM.
    """
    # Truncate very long files
    if len(file_content) > max_content_chars:
        half = max_content_chars // 2
        file_content = (
            file_content[:half]
            + f"\n\n... [TRUNCATED — {len(file_content) - max_content_chars} chars omitted] ...\n\n"
            + file_content[-half:]
        )

    deps_str = ", ".join(f"`{d}`" for d in depends_on[:15]) if depends_on else "None"
    used_str = ", ".join(f"`{u}`" for u in used_by[:15]) if used_by else "None"

    user_prompt = f"""Explain the following file from the **{repo_name}** repository.

## File Metadata
- **Path**: `{file_path}`
- **Language**: {language}
- **Role**: {role_label} (classified as `{role}`)
- **Importance**: {importance_score}/100
- **Depends on**: {deps_str}
- **Used by**: {used_str}

## Source Code
```{language.lower()}
{file_content}
```

## Instructions
Provide a clear explanation covering:
1. **Purpose** — What is this file's primary responsibility? (1-2 sentences)
2. **Key Components** — List the main functions, classes, or exports and what each does
3. **How it fits** — How does this file relate to the broader codebase? Why do other files depend on it (or why does it depend on others)?
4. **Notable patterns** — Any design patterns, architectural decisions, or gotchas worth highlighting

Keep the explanation focused and developer-oriented. Use Markdown formatting."""

    return [
        Message(role="system", content=SYSTEM_CODE_ANALYST),
        Message(role="user", content=user_prompt),
    ]


# ─────────────────────────────────────────────
# Architecture summary prompt
# ─────────────────────────────────────────────

def build_architecture_prompt(
    repo_name: str,
    owner: str,
    total_files: int,
    total_size_formatted: str,
    languages: dict[str, int],
    role_summary: dict,
    entry_points: list[dict],
    central_files: list[dict],
    module_graph: dict,
    top_file_profiles: list[dict],
) -> list[Message]:
    """
    Build a prompt for generating an architecture overview of the entire codebase.

    This gives the LLM a bird's-eye view using the structural analysis
    (no source code — just metadata, roles, and relationships).
    """
    # Format languages
    lang_str = ", ".join(f"{lang} ({count})" for lang, count in list(languages.items())[:10])

    # Format role distribution
    role_dist = role_summary.get("role_distribution", {})
    role_str = "\n".join(f"  - {role}: {pct}%" for role, pct in list(role_dist.items())[:10])

    # Format entry points
    entries_str = "\n".join(
        f"  - `{ep['file']}` (score: {ep.get('score', '?')}, reasons: {', '.join(ep.get('reasons', []))})"
        for ep in entry_points[:8]
    )

    # Format central files
    central_str = "\n".join(
        f"  - `{cf['file']}` — role: {cf.get('role', '?')}, in-degree: {cf.get('in_degree', 0)}, out-degree: {cf.get('out_degree', 0)}"
        for cf in central_files[:10]
    )

    # Format module connections
    modules = module_graph.get("modules", [])
    connections = module_graph.get("connections", [])
    modules_str = "\n".join(
        f"  - **{m['name']}/** — {m['file_count']} files, avg importance: {m.get('importance', 0)}, "
        f"languages: {', '.join(m.get('languages', {}).keys())}"
        for m in modules[:15]
    )
    connections_str = "\n".join(
        f"  - {c['source']}/ → {c['target']}/ (weight: {c['weight']})"
        for c in connections[:20]
    )

    # Format top files with their roles
    top_files_str = "\n".join(
        f"  - `{fp['path']}` — {fp.get('role_label', fp.get('role', '?'))}, "
        f"importance: {fp.get('importance_score', 0)}, "
        f"deps: {len(fp.get('depends_on', []))}, used by: {len(fp.get('used_by', []))}"
        for fp in top_file_profiles[:20]
    )

    user_prompt = f"""Analyze the structure of the **{owner}/{repo_name}** repository and write an architecture overview.

## Repository Stats
- **Total files**: {total_files}
- **Total size**: {total_size_formatted}
- **Languages**: {lang_str}

## File Role Distribution
{role_str}

## Entry Points (most likely starting points)
{entries_str}

## Central / Most Important Files
{central_str}

## Module / Directory Structure
{modules_str}

## Cross-Module Dependencies
{connections_str}

## Top Files by Importance
{top_files_str}

## Instructions
Write a comprehensive architecture overview covering:

1. **Project Overview** — What is this project? What problem does it solve? (infer from structure, file names, and dependencies)
2. **High-Level Architecture** — What are the main components/layers? How are they organized?
3. **Module Breakdown** — What does each major directory/module do?
4. **Data Flow** — How does data flow through the system? What are the main pipelines?
5. **Key Design Patterns** — What architectural patterns are being used? (MVC, microservices, layered, etc.)
6. **Technology Stack** — What frameworks, libraries, and tools are in use?
7. **Suggested Reading Order** — If a new developer wanted to understand this codebase, what files should they read first and in what order?

Use Markdown formatting with clear headings. Be specific — reference actual file and module names."""

    return [
        Message(role="system", content=SYSTEM_ARCHITECTURE_ANALYST),
        Message(role="user", content=user_prompt),
    ]


# ─────────────────────────────────────────────
# Module summary prompt
# ─────────────────────────────────────────────

def build_module_summary_prompt(
    module_name: str,
    file_count: int,
    files: list[str],
    languages: dict[str, int],
    roles: dict[str, int],
    internal_edges: int,
    connections_in: list[dict],
    connections_out: list[dict],
    repo_name: str,
) -> list[Message]:
    """
    Build a prompt for explaining what a single module/directory does.
    """
    files_str = "\n".join(f"  - `{f}`" for f in files[:30])
    lang_str = ", ".join(f"{l} ({c})" for l, c in languages.items())
    role_str = ", ".join(f"{r} ({c})" for r, c in roles.items())

    in_str = ", ".join(f"`{c['source']}/`" for c in connections_in[:10]) if connections_in else "None"
    out_str = ", ".join(f"`{c['target']}/`" for c in connections_out[:10]) if connections_out else "None"

    user_prompt = f"""Explain the **{module_name}/** module in the **{repo_name}** repository.

## Module Info
- **Files**: {file_count}
- **Languages**: {lang_str}
- **File roles**: {role_str}
- **Internal dependencies**: {internal_edges} edges between files in this module
- **Depends on modules**: {out_str}
- **Used by modules**: {in_str}

## Files in this module
{files_str}

## Instructions
Write a concise explanation (3-5 sentences) of:
1. What this module's responsibility is
2. What its key files do
3. How it relates to the rest of the codebase

Use Markdown formatting."""

    return [
        Message(role="system", content=SYSTEM_CODE_ANALYST),
        Message(role="user", content=user_prompt),
    ]
