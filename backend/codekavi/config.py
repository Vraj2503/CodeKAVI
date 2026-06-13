"""
Configuration for CodeKavi — directories, files, and extensions to ignore
during repository traversal.
"""

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

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
    "target",       # Rust / Java build output
    "Pods",         # iOS CocoaPods
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
    ".ipynb": "Jupyter Notebook"
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
    ".env": "Environment",
    ".env.example": "Environment",
    "docker-compose.yml": "Docker Compose",
    "docker-compose.yaml": "Docker Compose",
    "requirements.txt": "Python (pip)",
    "setup.py": "Python (setup)",
    "setup.cfg": "Python (setup)",
    "pyproject.toml": "Python (pyproject)",
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
EMBEDDING_DIMENSION = 3072


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
        (["route", "controller", "api", "endpoint"], "api"),
        (["model", "schema", "entity"], "model"),
        (["service", "logic", "handler", "pipeline", "rag"], "service"),
        (["db", "database", "repo", "migration"], "database"),
        (["util", "helper", "lib", "common"], "utility"),
        (["config", "setting", "constant"], "config"),
        (["component", "page", "layout", "ui", "css", "style", "theme"], "frontend"),
        (["test", "spec"], "test"),
    ]
    for keywords, layer in checks:
        if any(kw in path_lower for kw in keywords):
            return layer
    return "other"


# ─────────────────────────────────────────────
# Configuration Settings (Pydantic settings)
# ─────────────────────────────────────────────


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Keys & Credentials
    groq_api_key: str = Field(default="", validation_alias="GROQ_API_KEY")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    zilliz_uri: str = Field(default="", validation_alias="ZILLIZ_URI")
    zilliz_api_key: str = Field(default="", validation_alias="ZILLIZ_API_KEY")
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    supabase_service_key: str = Field(default="", validation_alias="SUPABASE_SERVICE_KEY")

    # Optional/CORS Config
    cors_origins: str = Field(default="http://localhost:3000", validation_alias="CORS_ORIGINS")

    # Model Names
    groq_model: str = Field(default="llama-3.3-70b-versatile", validation_alias="GROQ_MODEL")
    gemini_model: str = Field(default="gemini-2.0-flash", validation_alias="GEMINI_MODEL")
    embedding_model: str = Field(default="gemini-embedding-2", validation_alias="EMBEDDING_MODEL")

    # Bounded cache / limits
    max_content_cache_bytes: int = Field(default=10 * 1024 * 1024, validation_alias="MAX_CONTENT_CACHE_BYTES") # 10MB
    repo_size_limit_bytes: int = Field(default=100 * 1024 * 1024, validation_alias="REPO_SIZE_LIMIT_BYTES") # 100MB
    repo_file_limit: int = Field(default=2000, validation_alias="REPO_FILE_LIMIT") # 2000 files

    # Rate Limiting
    rate_limit_ip_rpm: int = Field(default=60, validation_alias="RATE_LIMIT_IP_RPM")
    rate_limit_user_rpm: int = Field(default=20, validation_alias="RATE_LIMIT_USER_RPM")

    # Daily Quotas
    daily_user_token_quota: int = Field(default=200_000, validation_alias="DAILY_USER_TOKEN_QUOTA")
    global_daily_spend_limit_usd: float = Field(default=5.0, validation_alias="GLOBAL_DAILY_SPEND_LIMIT_USD")

settings = Settings()

def validate_config() -> None:
    """Validate required configs are set on startup."""
    required = [
        ("GROQ_API_KEY", settings.groq_api_key),
        ("GEMINI_API_KEY", settings.gemini_api_key),
        ("ZILLIZ_URI", settings.zilliz_uri),
        ("ZILLIZ_API_KEY", settings.zilliz_api_key),
        ("REDIS_URL", settings.redis_url),
        ("SUPABASE_URL", settings.supabase_url),
        ("SUPABASE_SERVICE_KEY", settings.supabase_service_key),
    ]
    missing = [name for name, val in required if not val]
    if missing:
        raise ValueError(f"Missing required configuration variables: {', '.join(missing)}")

