"""
classifier.py — File role classification engine.

Takes the dependency graph from analyzer.py and produces a rich profile
for every file in the repository, answering:
  "What role does this file play in the system?"

Roles:
  ┌────────────────────┬────────────────────────────────────────────────┐
  │ Role               │ Criteria                                      │
  ├────────────────────┼────────────────────────────────────────────────┤
  │ entry_point        │ Main script, server start, CLI entry           │
  │ orchestrator       │ High out-degree — imports many, coordinates    │
  │ core_module        │ High in+out — central hub of the system        │
  │ shared_utility     │ High in-degree, low out — used everywhere      │
  │ internal_helper    │ Moderate in-degree — used by a few modules     │
  │ leaf               │ Low/no connections — standalone file            │
  │ config             │ Configuration / environment / settings          │
  │ test               │ Test file                                       │
  │ type_definition    │ Types / interfaces / models / schemas           │
  │ data               │ Data files, fixtures, migrations               │
  │ documentation      │ Docs, READMEs, changelogs                      │
  │ build              │ Build scripts, CI/CD, Dockerfiles              │
  └────────────────────┴────────────────────────────────────────────────┘
"""

import os
import re
from collections import defaultdict

from codekavi.utils import BoundedContentCache

# ─────────────────────────────────────────────
# Filename pattern → role hints
# ─────────────────────────────────────────────

_ENTRY_POINT_BASENAMES = {
    "main.py",
    "app.py",
    "manage.py",
    "wsgi.py",
    "asgi.py",
    "server.py",
    "run.py",
    "cli.py",
    "__main__.py",
    "index.js",
    "index.ts",
    "index.mjs",
    "main.js",
    "main.ts",
    "app.js",
    "app.ts",
    "server.js",
    "server.ts",
    "main.go",
    "cmd.go",
    "Main.java",
    "App.java",
    "Application.java",
    "main.rs",
    "main.c",
    "main.cpp",
    "app.rb",
    "config.ru",
    "index.php",
    "artisan",
}

_CONFIG_BASENAMES = {
    "settings.py",
    "config.py",
    "conf.py",
    "constants.py",
    "config.js",
    "config.ts",
    "constants.js",
    "constants.ts",
    ".env",
    ".env.example",
    ".env.local",
    "next.config.js",
    "next.config.mjs",
    "nuxt.config.js",
    "nuxt.config.ts",
    "vite.config.js",
    "vite.config.ts",
    "webpack.config.js",
    "webpack.config.ts",
    "tailwind.config.js",
    "tailwind.config.ts",
    "tsconfig.json",
    "jsconfig.json",
    "babel.config.js",
    ".babelrc",
    "eslint.config.js",
    ".eslintrc.js",
    ".eslintrc.json",
    "jest.config.js",
    "jest.config.ts",
    ".prettierrc",
    ".prettierrc.js",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
}

_BUILD_BASENAMES = {
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Makefile",
    "CMakeLists.txt",
    "Rakefile",
    "Procfile",
    "Vagrantfile",
    "Jenkinsfile",
    ".travis.yml",
    ".circleci",
}

_DOC_BASENAMES = {
    "README.md",
    "README.rst",
    "README.txt",
    "README",
    "CHANGELOG.md",
    "CHANGELOG.rst",
    "HISTORY.md",
    "CONTRIBUTING.md",
    "CONTRIBUTING.rst",
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "CODE_OF_CONDUCT.md",
    "AUTHORS",
    "AUTHORS.md",
}

_TEST_PATTERNS = [
    r"test[_s]?[\\/]",  #  test/ or tests/ directory
    r"__tests__[\\/]",  #  __tests__/ (Jest convention)
    r"spec[\\/]",  #  spec/ directory (Ruby/JS)
    r"_test\.py$",  #  module_test.py
    r"_spec\.py$",  #  module_spec.py
    r"^test_",  #  test_module.py
    r"\.test\.",  #  module.test.js
    r"\.spec\.",  #  module.spec.ts
    r"_test\.go$",  #  handler_test.go
    r"Test\.java$",  #  HandlerTest.java
]

_TYPE_DEF_PATTERNS = [
    r"types?\.",  #  types.ts, type.py
    r"interfaces?\.",  #  interface.ts
    r"models?\.",  #  models.py, model.ts
    r"schemas?\.",  #  schema.py, schemas.ts
    r"entities?\.",  #  entity.py
    r"dto\.",  #  dto.ts
    r"\.d\.ts$",  #  global.d.ts (TS declaration)
]

_DATA_PATTERNS = [
    r"migrations?[\\/]",  #  migrations/
    r"seeds?[\\/]",  #  seeds/
    r"fixtures?[\\/]",  #  fixtures/
    r"data[\\/]",  #  data/
    r"\.sql$",  #  schema.sql
]

# Source code extensions (for content analysis)
_SOURCE_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".go",
    ".java",
    ".kt",
    ".rs",
    ".rb",
    ".php",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".swift",
    ".scala",
    ".dart",
    ".ex",
    ".exs",
    ".vue",
    ".svelte",
}


# ─────────────────────────────────────────────
# Content-based role signals
# ─────────────────────────────────────────────


def _content_signals(
    abs_path: str,
    ext: str,
    content_cache: dict[str, str] | BoundedContentCache | None = None,
    rel_path: str | None = None,
) -> dict:
    """
    Read up to 4KB of a source file and detect structural signals.
    Returns a dict of boolean flags.
    """
    signals = {
        "has_main_guard": False,
        "has_main_function": False,
        "starts_server": False,
        "has_class_defs": False,
        "has_route_defs": False,
        "exports_only": False,
        "mostly_constants": False,
    }

    if ext.lower() not in _SOURCE_EXTENSIONS:
        return signals

    # Use content_cache if available, otherwise read from disk
    if content_cache and rel_path and rel_path in content_cache:
        content = content_cache[rel_path][:4096]
    else:
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                content = f.read(4096)
        except OSError:
            return signals

    # Python main guard
    if "if __name__" in content and "__main__" in content:
        signals["has_main_guard"] = True

    # Main / entry functions
    if re.search(r"def\s+main\s*\(", content):
        signals["has_main_function"] = True
    if re.search(r"func\s+main\s*\(", content):  # Go
        signals["has_main_function"] = True
    if re.search(r"public\s+static\s+void\s+main", content):  # Java
        signals["has_main_function"] = True

    # Server startup
    if re.search(r"app\.listen\s*\(", content) or re.search(r"createServer\s*\(", content):
        signals["starts_server"] = True
    if re.search(r"\.run\s*\(", content) and any(kw in content for kw in ["Flask", "FastAPI", "uvicorn", "Django"]):
        signals["starts_server"] = True
    if "uvicorn.run" in content:
        signals["starts_server"] = True

    # Class definitions (model/type files often have many)
    class_count = len(re.findall(r"(?:class|interface|struct|enum)\s+\w+", content))
    if class_count >= 2:
        signals["has_class_defs"] = True

    # Route definitions (controller/router files)
    route_indicators = [
        r"@app\.\w+\(",  # Flask/FastAPI decorators
        r"@router\.\w+\(",  # FastAPI router
        r"router\.\w+\(",  # Express router
        r"@Get\(|@Post\(|@Put\(",  # NestJS/Spring
        r"path\s*\(",  # Django URLs
        r"urlpatterns",  # Django
    ]
    route_count = sum(len(re.findall(p, content)) for p in route_indicators)
    if route_count >= 2:
        signals["has_route_defs"] = True

    # "Exports-only" file (like __init__.py or index.ts barrel)
    code_lines = [
        ln.strip()
        for ln in content.split("\n")
        if ln.strip() and not ln.strip().startswith("#") and not ln.strip().startswith("//")
    ]
    if code_lines:
        export_lines = sum(1 for ln in code_lines if ln.startswith(("from ", "export ", "module.exports", "__all__")))
        if export_lines / len(code_lines) > 0.7:
            signals["exports_only"] = True

    # Mostly constants (UPPER_CASE assignments)
    const_lines = sum(1 for ln in code_lines if re.match(r"^[A-Z][A-Z_0-9]+\s*=", ln))
    if len(code_lines) > 3 and const_lines / len(code_lines) > 0.4:
        signals["mostly_constants"] = True

    return signals


# ─────────────────────────────────────────────
# Core: classify every file
# ─────────────────────────────────────────────


def classify_files(
    repo_root: str,
    file_list: list[dict],
    dep_data: dict,
    content_cache: dict[str, str] | BoundedContentCache | None = None,
) -> list[dict]:
    """
    Produce a rich profile for every file in the repo.

    Args:
        repo_root:  Absolute path to the cloned repo.
        file_list:  Flat file list from traverser (each has 'path', 'language', 'size', etc.).
        dep_data:   Output from analyze_dependencies() — edges, adjacency, reverse, entry_points, etc.

    Returns:
        list of file profiles, each with:
          - path, name, language, size
          - role:          primary classification string
          - role_label:    human-readable label
          - role_confidence: float 0.0-1.0
          - depends_on:    [files this file imports]
          - used_by:       [files that import this file]
          - in_degree, out_degree
          - importance_score:  numeric rank
          - tags:          list of descriptive tags
    """
    adjacency = dep_data.get("adjacency", {})
    reverse_adjacency = dep_data.get("reverse_adjacency", {})
    entry_point_files = {ep["file"] for ep in dep_data.get("entry_points", [])}
    entry_point_scores = {ep["file"]: ep["score"] for ep in dep_data.get("entry_points", [])}

    # Pre-compute global stats for relative scoring
    all_in_degrees = []
    all_out_degrees = []
    for f in file_list:
        p = f["path"]
        all_in_degrees.append(len(reverse_adjacency.get(p, [])))
        all_out_degrees.append(len(adjacency.get(p, [])))

    max_in = max(all_in_degrees) if all_in_degrees else 1
    max_out = max(all_out_degrees) if all_out_degrees else 1
    avg_in = sum(all_in_degrees) / len(all_in_degrees) if all_in_degrees else 0
    avg_out = sum(all_out_degrees) / len(all_out_degrees) if all_out_degrees else 0

    profiles = []

    for file_info in file_list:
        rel_path = file_info["path"]
        basename = os.path.basename(rel_path)
        _, ext = os.path.splitext(basename)
        abs_path = os.path.join(repo_root, rel_path)

        in_degree = len(reverse_adjacency.get(rel_path, []))
        out_degree = len(adjacency.get(rel_path, []))
        depends_on = adjacency.get(rel_path, [])
        used_by = reverse_adjacency.get(rel_path, [])

        # Collect signals
        signals = _content_signals(abs_path, ext, content_cache=content_cache, rel_path=rel_path)

        # ── Classify ──
        role, role_label, confidence, tags = _determine_role(
            rel_path=rel_path,
            basename=basename,
            ext=ext,
            in_degree=in_degree,
            out_degree=out_degree,
            max_in=max_in,
            max_out=max_out,
            avg_in=avg_in,
            avg_out=avg_out,
            signals=signals,
            is_entry_point=rel_path in entry_point_files,
            entry_score=entry_point_scores.get(rel_path, 0),
        )

        # ── Importance score ──
        importance = _compute_importance(
            in_degree=in_degree,
            out_degree=out_degree,
            max_in=max_in,
            role=role,
            entry_score=entry_point_scores.get(rel_path, 0),
            depth=rel_path.count(os.sep),
        )

        profiles.append(
            {
                "path": rel_path,
                "name": basename,
                "language": file_info.get("language", "Unknown"),
                "size": file_info.get("size", 0),
                "size_formatted": file_info.get("size_formatted", ""),
                "role": role,
                "role_label": role_label,
                "role_confidence": round(confidence, 2),
                "depends_on": list(depends_on) if isinstance(depends_on, (list, set)) else depends_on,
                "used_by": list(used_by) if isinstance(used_by, (list, set)) else used_by,
                "in_degree": in_degree,
                "out_degree": out_degree,
                "importance_score": round(importance, 2),
                "tags": tags,
            }
        )

    # Sort by importance (highest first)
    profiles.sort(key=lambda x: x["importance_score"], reverse=True)

    return profiles


# ─────────────────────────────────────────────
# Role determination logic
# ─────────────────────────────────────────────

_ROLE_LABELS = {
    "entry_point": "Entry Point",
    "orchestrator": "Orchestrator / Controller",
    "core_module": "Core Module",
    "shared_utility": "Shared Utility",
    "internal_helper": "Internal Helper",
    "router": "Router / Routes",
    "config": "Configuration",
    "test": "Test",
    "type_definition": "Type / Model Definition",
    "data": "Data / Migration",
    "documentation": "Documentation",
    "build": "Build / DevOps",
    "barrel": "Barrel / Re-export",
    "leaf": "Standalone / Leaf",
}


def _determine_role(
    rel_path: str,
    basename: str,
    ext: str,
    in_degree: int,
    out_degree: int,
    max_in: int,
    max_out: int,
    avg_in: float,
    avg_out: float,
    signals: dict,
    is_entry_point: bool,
    entry_score: int,
) -> tuple[str, str, float, list[str]]:
    """
    Determine the primary role of a file.
    Returns (role, role_label, confidence, tags).
    """
    candidates: list[tuple[str, float, list[str]]] = []

    # ── 1. Documentation (check first — these are never code) ──
    if basename in _DOC_BASENAMES or (ext.lower() in {".md", ".rst", ".txt"} and _is_doc_path(rel_path)):
        candidates.append(("documentation", 0.95, ["docs"]))

    # ── 2. Test files ──
    if _matches_patterns(rel_path, _TEST_PATTERNS) or _matches_patterns(basename, _TEST_PATTERNS):
        tags = ["test", "automated"]
        if "unit" in rel_path.lower():
            tags.append("unit")
        elif "integration" in rel_path.lower() or "e2e" in rel_path.lower():
            tags.append("integration")
        candidates.append(("test", 0.92, tags))

    # ── 3. Build / DevOps ──
    if basename in _BUILD_BASENAMES or _is_ci_path(rel_path):
        candidates.append(("build", 0.90, ["devops", "infrastructure"]))

    # ── 4. Config files ──
    if basename in _CONFIG_BASENAMES or signals.get("mostly_constants"):
        tags = ["config"]
        if signals.get("mostly_constants"):
            tags.append("constants")
        candidates.append(("config", 0.88, tags))

    # ── 5. Data / migration files ──
    if _matches_patterns(rel_path, _DATA_PATTERNS):
        candidates.append(("data", 0.85, ["data"]))

    # ── 6. Type / model definitions ──
    if _matches_patterns(basename, _TYPE_DEF_PATTERNS) or (
        signals.get("has_class_defs") and in_degree > avg_in and out_degree <= 1
    ):
        tags = ["types"]
        if signals.get("has_class_defs"):
            tags.append("classes")
        candidates.append(("type_definition", 0.80, tags))

    # ── 7. Barrel / re-export files ──
    if signals.get("exports_only") or (
        basename in {"__init__.py", "index.ts", "index.js"} and out_degree > 3 and in_degree <= 2
    ):
        candidates.append(("barrel", 0.82, ["barrel", "re-export"]))

    # ── 8. Entry point ──
    if is_entry_point or basename in _ENTRY_POINT_BASENAMES:
        conf = min(0.95, 0.6 + entry_score * 0.05)
        tags = ["entry"]
        if signals.get("has_main_guard") or signals.get("has_main_function"):
            tags.append("main")
            conf = max(conf, 0.90)
        if signals.get("starts_server"):
            tags.append("server")
            conf = max(conf, 0.92)
        candidates.append(("entry_point", conf, tags))

    # ── 9. Router / route handler ──
    if signals.get("has_route_defs"):
        tags = ["routes", "api"]
        candidates.append(("router", 0.85, tags))

    # ── 10. Graph-based roles (only for source files with connections) ──
    if ext.lower() in _SOURCE_EXTENSIONS:
        in_ratio = in_degree / max_in if max_in > 0 else 0
        out_ratio = out_degree / max_out if max_out > 0 else 0

        # Core module: high both in and out
        if in_degree >= 3 and out_degree >= 2 and in_ratio >= 0.3 and out_ratio >= 0.2:
            candidates.append(("core_module", 0.75 + in_ratio * 0.2, ["core", "hub"]))

        # Orchestrator: high out-degree, moderate/low in-degree
        elif out_degree >= 3 and out_ratio >= 0.3 and in_degree <= avg_in:
            candidates.append(("orchestrator", 0.70 + out_ratio * 0.2, ["orchestrator", "controller"]))

        # Shared utility: high in-degree, low out-degree
        elif in_degree >= 3 and in_ratio >= 0.3 and out_degree <= avg_out:
            candidates.append(("shared_utility", 0.75 + in_ratio * 0.2, ["shared", "utility"]))

        # Internal helper: moderate in-degree
        elif in_degree >= 1 and in_degree < 3 and out_degree <= 2:
            candidates.append(("internal_helper", 0.60, ["helper"]))

        # Leaf: no or minimal connections
        elif in_degree == 0 and out_degree == 0:
            candidates.append(("leaf", 0.50, ["standalone", "isolated"]))
        elif in_degree == 0 and out_degree >= 1 and not is_entry_point:
            # Imports others but nobody imports it — could be entry or orphan
            candidates.append(("leaf", 0.45, ["unused", "potential_entry"]))

    # ── Pick the best candidate ──
    if not candidates:
        return "leaf", _ROLE_LABELS["leaf"], 0.30, ["unclassified"]

    # Sort by confidence, highest first
    candidates.sort(key=lambda x: x[1], reverse=True)
    role, confidence, tags = candidates[0]
    role_label = _ROLE_LABELS.get(role, role.replace("_", " ").title())

    return role, role_label, confidence, tags


# ─────────────────────────────────────────────
# Importance scoring
# ─────────────────────────────────────────────


def _compute_importance(
    in_degree: int,
    out_degree: int,
    max_in: int,
    role: str,
    entry_score: int,
    depth: int,
) -> float:
    """
    Compute a 0-100 importance score for a file.
    Higher = more important to understand the codebase.
    """
    score = 0.0

    # In-degree (being depended on) is the strongest signal
    if max_in > 0:
        score += (in_degree / max_in) * 40

    # Out-degree (importing many things = orchestrator)
    score += min(out_degree * 2, 20)

    # Role bonuses
    role_bonuses = {
        "entry_point": 25,
        "core_module": 20,
        "orchestrator": 15,
        "shared_utility": 15,
        "router": 12,
        "config": 8,
        "type_definition": 8,
        "barrel": 5,
        "internal_helper": 5,
        "test": 3,
        "build": 2,
        "documentation": 1,
        "data": 2,
        "leaf": 1,
    }
    score += role_bonuses.get(role, 0)

    # Entry point boost
    score += entry_score * 2

    # Root-level files slightly more important
    if depth == 0:
        score += 3

    return min(score, 100.0)


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────


def _matches_patterns(text: str, patterns: list[str]) -> bool:
    """Check if any regex pattern matches the text."""
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _is_doc_path(path: str) -> bool:
    """Check if the path is in a documentation directory."""
    parts = path.lower().split(os.sep)
    return any(p in {"docs", "doc", "documentation", "wiki"} for p in parts)


def _is_ci_path(path: str) -> bool:
    """Check if the path is a CI/CD config."""
    lower = path.lower()
    return any(
        ci in lower
        for ci in [
            ".github/workflows",
            ".gitlab-ci",
            ".circleci",
            "jenkins",
            ".travis",
            "azure-pipelines",
            ".buildkite",
        ]
    )


# ─────────────────────────────────────────────
# Summary statistics
# ─────────────────────────────────────────────


def summarize_roles(profiles: list[dict]) -> dict:
    """
    Produce a summary of role distribution across the repo.

    Returns:
        dict with:
          - role_counts:      { role: count }
          - role_distribution: { role: percentage }
          - top_files:        top 10 most important files
          - dependency_hubs:  files with most connections
    """
    role_counts: dict[str, int] = defaultdict(int)
    total = len(profiles)

    for p in profiles:
        role_counts[p["role"]] += 1

    # Sort by count
    role_counts = dict(sorted(role_counts.items(), key=lambda x: x[1], reverse=True))

    role_distribution = {}
    for role, count in role_counts.items():
        role_distribution[role] = round((count / total) * 100, 1) if total > 0 else 0

    # Top files by importance
    top_files = [{"file": p["path"], "role": p["role"], "importance": p["importance_score"]} for p in profiles[:10]]

    # Dependency hubs (most total connections)
    hubs = sorted(profiles, key=lambda x: x["in_degree"] + x["out_degree"], reverse=True)
    dependency_hubs = [
        {
            "file": h["path"],
            "role": h["role"],
            "in_degree": h["in_degree"],
            "out_degree": h["out_degree"],
            "total_connections": h["in_degree"] + h["out_degree"],
        }
        for h in hubs[:10]
        if h["in_degree"] + h["out_degree"] > 0
    ]

    return {
        "total_files": total,
        "role_counts": role_counts,
        "role_distribution": role_distribution,
        "top_files": top_files,
        "dependency_hubs": dependency_hubs,
    }
