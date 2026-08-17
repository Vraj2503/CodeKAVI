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
  │ ml_model           │ ML/DL model definition (nn.Module, keras)      │
  │ ml_training        │ ML training loop / fit() script                │
  │ ml_pipeline        │ ML data pipeline (DataLoader, transforms)      │
  └────────────────────┴────────────────────────────────────────────────┘
"""

import os
import re
from collections import Counter, defaultdict
from typing import Any

from rune.complexity import file_complexity
from rune.config import MAX_FILE_SIZE_BYTES
from rune.pipeline_models import DepGraph, FileEntry, FileProfile
from rune.utils import BoundedContentCache

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
    ".ipynb",
}


def _full_source(file_info: FileEntry, abs_path: str) -> str | None:
    """
    Whole-file text for metrics that cannot work on a prefix.

    The shared `content_cache` deliberately stores only the first 4KB — enough
    for the role signals, useless for counting branches, since most of a file's
    control flow lives past byte 4096. The traverser already pre-loads full
    content for files under 100KB, so this is usually free; the disk read is
    the fallback for the ones it skipped.
    """
    if file_info.content is not None:
        return file_info.content
    try:
        if os.path.getsize(abs_path) > MAX_FILE_SIZE_BYTES:
            return None
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return None


# ─────────────────────────────────────────────
# Content-based role signals
# ─────────────────────────────────────────────


def _content_signals(
    abs_path: str,
    ext: str,
    content_cache: dict[str, str] | BoundedContentCache | None = None,
    rel_path: str | None = None,
    precomputed_signals: list[str] | None = None,
) -> dict:
    """
    Read up to 4KB of a source file and detect structural signals.
    Returns a dict of boolean flags.
    """
    signals: dict[str, Any] = {
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

    # Use content_cache if available (but notebooks aren't cached), otherwise read from disk
    if content_cache and rel_path and rel_path in content_cache:
        content = content_cache[rel_path][:4096]
    else:
        try:
            if ext.lower() == ".ipynb":
                import json

                with open(abs_path, encoding="utf-8", errors="ignore") as f:
                    nb = json.load(f)
                code_cells = [
                    "".join(c.get("source", [])) if isinstance(c.get("source"), list) else c.get("source", "")
                    for c in nb.get("cells", [])
                    if c.get("cell_type") == "code"
                ]
                content = "\n".join(code_cells)[:16384]  # Read up to 16KB of actual code
            else:
                with open(abs_path, encoding="utf-8", errors="ignore") as f:
                    content = f.read(4096)
        except Exception:
            return signals

    if precomputed_signals is not None:
        if "main_guard" in precomputed_signals:
            signals["has_main_guard"] = True
        if "main_fn" in precomputed_signals:
            signals["has_main_function"] = True
        if "starts_server" in precomputed_signals:
            signals["starts_server"] = True
    else:
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

    # ML/DL framework signals
    signals["has_ml_model_def"] = False
    signals["has_ml_training"] = False
    signals["has_ml_pipeline"] = False
    signals["ml_frameworks"] = []

    _ml_fw_patterns = {
        "pytorch": [r"\bimport\s+torch\b", r"\bfrom\s+torch\b", r"\bimport\s+torchvision\b"],
        "tensorflow": [r"\bimport\s+tensorflow\b", r"\bfrom\s+tensorflow\b"],
        "keras": [r"\bimport\s+keras\b", r"\bfrom\s+keras\b", r"\bfrom\s+tensorflow\.keras\b"],
        "jax": [r"\bimport\s+jax\b", r"\bfrom\s+jax\b", r"\bimport\s+flax\b", r"\bfrom\s+flax\b"],
        "sklearn": [r"\bimport\s+sklearn\b", r"\bfrom\s+sklearn\b"],
    }
    detected_fw = []
    for fw, patterns in _ml_fw_patterns.items():
        if any(re.search(p, content) for p in patterns):
            detected_fw.append(fw)
    signals["ml_frameworks"] = detected_fw

    # Model definition signals
    if re.search(r"class\s+\w+\s*\(\s*(?:nn\.Module|keras\.Model|tf\.keras\.Model)\s*\)", content):
        signals["has_ml_model_def"] = True
    if re.search(r"(?:nn\.Sequential|keras\.Sequential|tf\.keras\.Sequential)\s*\(", content):
        signals["has_ml_model_def"] = True
    if re.search(
        r"(?:nn\.(?:Conv|Linear|LSTM|GRU|BatchNorm|Dropout|Embedding|Transformer)|layers\.(?:Dense|Conv))", content
    ):
        signals["has_ml_model_def"] = True

    # Training signals
    if re.search(r"(?:\.backward\(\)|optimizer\.(?:step|zero_grad)|model\.fit\(|model\.train\(\))", content):
        signals["has_ml_training"] = True

    # Data pipeline signals
    if re.search(r"(?:DataLoader|Dataset|transforms\.(?:Compose|Normalize)|tf\.data)", content):
        signals["has_ml_pipeline"] = True

    return signals


# ─────────────────────────────────────────────
# Core: classify every file
# ─────────────────────────────────────────────


def classify_files(
    repo_root: str,
    file_list: list[FileEntry],
    dep_data: DepGraph,
    content_cache: dict[str, str] | BoundedContentCache | None = None,
) -> list[FileProfile]:
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
    adjacency = dep_data.adjacency or {}
    reverse_adjacency = dep_data.reverse_adjacency or {}
    entry_point_files = {ep.get("file") for ep in (dep_data.entry_points or []) if ep.get("file")}
    entry_point_scores = {ep.get("file"): ep.get("score", 0) for ep in (dep_data.entry_points or []) if ep.get("file")}

    # Pre-compute global stats for relative scoring (single-pass aggregation)
    max_in = 0
    max_out = 0
    sum_in = 0
    sum_out = 0
    count = 0
    for f in file_list:
        p = f.path
        ind = len(reverse_adjacency.get(p, []))
        outd = len(adjacency.get(p, []))
        if ind > max_in:
            max_in = ind
        if outd > max_out:
            max_out = outd
        sum_in += ind
        sum_out += outd
        count += 1

    max_in = max_in if max_in > 0 else 1
    max_out = max_out if max_out > 0 else 1
    avg_in = sum_in / count if count else 0
    avg_out = sum_out / count if count else 0

    profiles = []

    for file_info in file_list:
        rel_path = file_info.path
        basename = os.path.basename(rel_path)
        _, ext = os.path.splitext(basename)
        abs_path = os.path.join(repo_root, rel_path)
        language = file_info.language
        file_size = file_info.size

        in_degree = len(reverse_adjacency.get(rel_path, []))
        out_degree = len(adjacency.get(rel_path, []))
        depends_on = adjacency.get(rel_path, [])
        used_by = reverse_adjacency.get(rel_path, [])

        # Collect signals
        precomputed = dep_data.file_signals.get(rel_path)
        signals = _content_signals(
            abs_path, ext, content_cache=content_cache, rel_path=rel_path, precomputed_signals=precomputed
        )

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

        # ── Size / complexity metrics ──
        # Only source files. Counting "lines of code" in a PNG or a lockfile is
        # noise, and parsing them costs a disk read for nothing.
        metrics: dict[str, Any] = {}
        if ext.lower() in _SOURCE_EXTENSIONS:
            source = _full_source(file_info, abs_path)
            if source is not None:
                metrics = file_complexity(source, rel_path)

        # ── Importance score ──
        importance = _compute_importance(
            in_degree=in_degree,
            out_degree=out_degree,
            max_in=max_in,
            role=role,
            entry_score=entry_point_scores.get(rel_path, 0),
            depth=rel_path.count("/"),
        )

        profiles.append(
            FileProfile(
                path=rel_path,
                name=basename,
                language=language,
                size=file_size,
                role=role,
                role_label=role_label,
                role_confidence=round(confidence, 2),
                depends_on=list(depends_on) if isinstance(depends_on, list | set) else depends_on,
                used_by=list(used_by) if isinstance(used_by, list | set) else used_by,
                in_degree=in_degree,
                out_degree=out_degree,
                importance_score=round(importance, 2),
                tags=tags,
                # Absent (not zero) when the file was never measured — a
                # fabricated 1 is indistinguishable from a genuinely simple
                # file, so consumers must be able to tell "no data" apart.
                loc=metrics.get("loc"),
                complexity=metrics.get("complexity"),
                complexity_source=metrics.get("complexity_source"),
            )
        )

    # Sort by importance (highest first)
    profiles.sort(key=lambda x: x.importance_score, reverse=True)

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
    "ml_model": "ML Model Definition",
    "ml_training": "ML Training Script",
    "ml_pipeline": "ML Data Pipeline",
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

    # ── 9.5 ML/DL roles ──
    if signals.get("has_ml_model_def") and signals.get("ml_frameworks"):
        tags = ["ml", "model", *signals.get("ml_frameworks", [])]
        candidates.append(("ml_model", 0.90, tags))
    elif signals.get("has_ml_training") and signals.get("ml_frameworks"):
        tags = ["ml", "training", *signals.get("ml_frameworks", [])]
        candidates.append(("ml_training", 0.85, tags))
    elif signals.get("has_ml_pipeline") and signals.get("ml_frameworks"):
        tags = ["ml", "pipeline", *signals.get("ml_frameworks", [])]
        candidates.append(("ml_pipeline", 0.82, tags))

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
        "ml_model": 18,
        "ml_training": 12,
        "ml_pipeline": 10,
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
    parts = path.lower().split("/")
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


def summarize_roles(profiles: list[FileProfile]) -> dict:
    """
    Summarize the distribution of roles across the repo.

    Returns:
      - dict containing:
          - total_files: int
          - role_counts: dict[str, int]
          - role_distribution: dict[str, float] (percentages)
          - top_files:        list of most important files
          - dependency_hubs:  files with most connections
    """
    role_counts: dict[str, int] = defaultdict(int)
    total = len(profiles)

    for p in profiles:
        role_counts[p.role] += 1

    # Sort by count
    role_counts = dict(sorted(role_counts.items(), key=lambda x: x[1], reverse=True))

    role_distribution = {}
    for role, count in role_counts.items():
        role_distribution[role] = round((count / total) * 100, 1) if total > 0 else 0

    # Top files by importance
    top_files = [{"file": p.path, "role": p.role, "importance": p.importance_score} for p in profiles[:10]]

    # Dependency hubs (most total connections)
    hubs = sorted(profiles, key=lambda x: x.in_degree + x.out_degree, reverse=True)
    dependency_hubs = [
        {
            "file": h.path,
            "role": h.role,
            "in_degree": h.in_degree,
            "out_degree": h.out_degree,
            "total_connections": h.in_degree + h.out_degree,
        }
        for h in hubs[:10]
        if h.in_degree + h.out_degree > 0
    ]

    return {
        "total_files": total,
        "role_counts": role_counts,
        "role_distribution": role_distribution,
        "top_files": top_files,
        "dependency_hubs": dependency_hubs,
    }


# ─────────────────────────────────────────────
# Repo type detection
# ─────────────────────────────────────────────

_ML_ROLES = {"ml_model", "ml_training", "ml_pipeline"}
_TEMPLATE_EXTENSIONS = {".html", ".vue", ".svelte", ".ejs", ".hbs", ".pug", ".jinja", ".jinja2"}


def detect_repo_type(file_profiles: list[FileProfile], dep_data: DepGraph) -> str:
    """
    Detect the overall type of the repository from its file role distribution.

    Returns one of: "web_app", "ml_pipeline", "microservice", "cli_tool", "library".
    Used to hint the data flow LLM prompt and pick a flow style on the frontend.
    """
    if not file_profiles:
        return "library"

    role_counts = Counter(p.role for p in file_profiles)
    has_ml = any(role_counts[r] for r in _ML_ROLES)
    has_router = role_counts["router"] > 0
    has_entry = role_counts["entry_point"] > 0 or bool(dep_data.entry_points)
    has_docker = any(p.role == "build" and "infrastructure" in p.tags for p in file_profiles)
    has_templates = any(os.path.splitext(p.name)[1].lower() in _TEMPLATE_EXTENSIONS for p in file_profiles)

    if has_ml:
        return "ml_pipeline"
    if has_router and has_templates:
        return "web_app"
    if has_router and (has_docker or role_counts["config"] > 0):
        return "microservice"
    if has_router:
        return "web_app"
    if has_entry:
        return "cli_tool"
    return "library"


if __name__ == "__main__":

    def _profile(role: str, name: str = "f.py", tags: list[str] | None = None) -> FileProfile:
        return FileProfile(
            path=name,
            name=name,
            language="Python",
            size=10,
            role=role,
            role_label=role,
            role_confidence=0.9,
            depends_on=[],
            used_by=[],
            in_degree=0,
            out_degree=0,
            importance_score=0.0,
            tags=tags or [],
        )

    empty_dep = DepGraph(
        edges=[],
        adjacency={},
        reverse_adjacency={},
        file_imports={},
        entry_points=[],
        file_signals={},
        central_files=[],
        stats={},
    )

    assert detect_repo_type([], empty_dep) == "library"
    assert detect_repo_type([_profile("ml_training")], empty_dep) == "ml_pipeline"
    assert detect_repo_type([_profile("router"), _profile("index.html", name="index.html")], empty_dep) == "web_app"
    assert (
        detect_repo_type(
            [_profile("router"), _profile("build", name="Dockerfile", tags=["devops", "infrastructure"])], empty_dep
        )
        == "microservice"
    )
    assert detect_repo_type([_profile("entry_point")], empty_dep) == "cli_tool"
    assert detect_repo_type([_profile("shared_utility")], empty_dep) == "library"
    print("detect_repo_type: all checks passed")
