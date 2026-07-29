"""
Configuration for CodeKavi — directories, files, and extensions to ignore
during repository traversal.
"""

import os

# Base directory where cloned repos are stored
CLONE_BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cloned_repos")

# Directories to ignore during traversal
IGNORED_DIRS = {
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    "node_modules",
    "venv",
    ".venv",
    "env",
    ".env",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    ".coverage",
    ".nyc_output",
    ".idea",
    ".vscode",
    ".DS_Store",
    "vendor",
    "bower_components",
    ".sass-cache",
    "tmp",
    ".tmp",
    "logs",
    ".eggs",
    "*.egg-info",
    ".gradle",
    ".cargo",
    "target",  # Rust / Java build output
    "Pods",  # iOS CocoaPods
    ".terraform",
}

# File extensions to ignore
IGNORED_EXTENSIONS = {
    ".pyc",
    ".pyo",
    ".class",
    ".o",
    ".so",
    ".dll",
    ".dylib",
    ".exe",
    ".bin",
    ".dat",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".log",
    ".lock",
    ".pid",
    ".swp",
    ".swo",
    ".DS_Store",
    ".ico",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".svg",
    ".webp",
    ".mp3",
    ".mp4",
    ".wav",
    ".avi",
    ".mov",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".rar",
    ".7z",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".map",
    ".min.js",
    ".min.css",
    ".pack",
    ".idx",
}

# Specific filenames to ignore
IGNORED_FILES = {
    ".DS_Store",
    "Thumbs.db",
    ".gitkeep",
    ".gitattributes",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Pipfile.lock",
    "poetry.lock",
    "composer.lock",
    "Gemfile.lock",
    "Cargo.lock",
}

# Maximum file size to read (in bytes) — skip very large files
MAX_FILE_SIZE_BYTES = 512 * 1024  # 512 KB
MAX_NOTEBOOK_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB

# File extension → language mapping
EXTENSION_LANGUAGE_MAP = {
    ".py": "Python",
    ".js": "JavaScript",
    ".jsx": "JavaScript (React)",
    ".ts": "TypeScript",
    ".tsx": "TypeScript (React)",
    ".java": "Java",
    ".kt": "Kotlin",
    ".go": "Go",
    ".rs": "Rust",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C/C++ Header",
    ".hpp": "C++ Header",
    ".cs": "C#",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".m": "Objective-C",
    ".r": "R",
    ".R": "R",
    ".scala": "Scala",
    ".dart": "Dart",
    ".lua": "Lua",
    ".sh": "Shell",
    ".bash": "Bash",
    ".zsh": "Zsh",
    ".ps1": "PowerShell",
    ".bat": "Batch",
    ".html": "HTML",
    ".htm": "HTML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".sass": "Sass",
    ".less": "Less",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".xml": "XML",
    ".toml": "TOML",
    ".ini": "INI",
    ".cfg": "Config",
    ".conf": "Config",
    ".md": "Markdown",
    ".rst": "reStructuredText",
    ".txt": "Text",
    ".sql": "SQL",
    ".graphql": "GraphQL",
    ".proto": "Protocol Buffers",
    ".dockerfile": "Dockerfile",
    ".tf": "Terraform",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".astro": "Astro",
    ".ex": "Elixir",
    ".exs": "Elixir Script",
    ".erl": "Erlang",
    ".hs": "Haskell",
    ".ml": "OCaml",
    ".jl": "Julia",
    ".pl": "Perl",
    ".pm": "Perl Module",
    ".clj": "Clojure",
    ".ipynb": "Jupyter Notebook",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".mdx": "MDX",
    ".jsonc": "JSON",
    ".csv": "Data",
    ".tsv": "Data",
    ".env": "Dotenv",
    ".gradle": "Gradle",
    ".cmake": "CMake",
}

# Special filenames → language mapping
FILENAME_LANGUAGE_MAP = {
    "Dockerfile": "Dockerfile",
    "Makefile": "Makefile",
    "CMakeLists.txt": "CMake",
    "Rakefile": "Ruby",
    "Gemfile": "Ruby",
    "Vagrantfile": "Ruby",
    "Procfile": "Procfile",
    ".gitignore": "Git Config",
    "docker-compose.yml": "Docker Compose",
    "docker-compose.yaml": "Docker Compose",
    "requirements.txt": "Python",
    "setup.py": "Python",
    "setup.cfg": "Python",
    "pyproject.toml": "Python",
    "package.json": "Node.js",
    "tsconfig.json": "TypeScript Config",
    "webpack.config.js": "Webpack Config",
    "vite.config.js": "Vite Config",
    "vite.config.ts": "Vite Config",
    "next.config.js": "Next.js Config",
    "tailwind.config.js": "Tailwind Config",
    "Cargo.toml": "Rust (Cargo)",
    "go.mod": "Go Module",
    "go.sum": "Go Dependencies",
    "build.gradle": "Gradle",
    "pom.xml": "Maven",
}


# ─────────────────────────────────────────────
# Smart file selection
# ─────────────────────────────────────────────
MAX_FILES_FOR_LLM = 30
MAX_TOTAL_INPUT_TOKENS = 80000
MAX_PARALLEL_LLM_CALLS = 5

# ─────────────────────────────────────────────
# Embedding model (single source of truth)
# ─────────────────────────────────────────────
# Used by both indexer.py (write path) and vectorstore.py (read path).
# If you change this, ALL previously indexed repos must be re-analyzed
# because the old vectors will be in a different embedding space.
EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSION = 1024


# ─────────────────────────────────────────────
# Layer detection (single canonical copy)
# ─────────────────────────────────────────────
# Used by indexer.py, orchestrator.py, and visualize.py.
# Change this list to update layer detection across the whole app.


def detect_layer(file_path: str) -> str:
    """
    Detect architectural layer from file path keywords.
    Used for metadata-based filtering in RAG retrieval and visualization grouping.
    """
    path_lower = file_path.lower()
    checks = [
        (["route", "controller", "api", "endpoint", "view", "screen", "page"], "routes"),
        (["model", "schema", "entity", "type", "interface", "dto"], "models"),
        (["service", "logic", "handler", "pipeline", "rag", "middleware", "orchestrat"], "services"),
        (["db", "database", "repo", "migration", "prisma", "drizzle", "sequelize"], "database"),
        (["util", "helper", "lib", "common", "shared", "tool", "script", "cli"], "utils"),
        (["config", "setting", "constant", "env"], "config"),
        (
            [
                "component",
                "layout",
                "ui",
                "css",
                "style",
                "theme",
                "hook",
                "composable",
                "store",
                "redux",
                "zustand",
                "state",
                "asset",
                "static",
                "public",
            ],
            "frontend",
        ),
        (["test", "spec", "__test__", "__spec__"], "tests"),
    ]
    for keywords, layer in checks:
        if any(kw in path_lower for kw in keywords):
            return layer
    return "other"


# ─────────────────────────────────────────────
# Configuration Settings are now imported from codekavi.settings


def detect_language(filepath: str) -> str:
    """
    Detect programming language from filename or extension.

    Canonical implementation — imported by traverser, analyzer, and indexer.
    Checks FILENAME_LANGUAGE_MAP first (e.g. Dockerfile, Makefile), then falls
    back to EXTENSION_LANGUAGE_MAP, and finally returns "Unknown".
    """
    basename = os.path.basename(filepath)
    if basename in FILENAME_LANGUAGE_MAP:
        return FILENAME_LANGUAGE_MAP[basename]
    _, ext = os.path.splitext(basename)
    return EXTENSION_LANGUAGE_MAP.get(ext.lower(), "Unknown")
