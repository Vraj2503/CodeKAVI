"""
codekavi.settings — Settings management using pydantic-settings.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Keys & Credentials
    groq_api_key: str = Field(default="", validation_alias="GROQ_API_KEY")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    cloudflare_account_id: str = Field(default="", validation_alias="CLOUDFLARE_ACCOUNT_ID")
    cloudflare_api_token: str = Field(default="", validation_alias="CLOUDFLARE_API_TOKEN")
    zilliz_uri: str = Field(default="", validation_alias="ZILLIZ_URI")
    zilliz_api_key: str = Field(default="", validation_alias="ZILLIZ_API_KEY")
    # Use rediss:// scheme for TLS connections (required for production Redis
    # providers like AWS ElastiCache, Upstash, Redis Cloud). The redis-py client
    # auto-detects rediss:// and wraps the socket in ssl.SSLContext.
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        validation_alias="REDIS_URL",
        description="Redis connection URL. Use rediss:// for TLS (production).",
    )
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    supabase_service_key: str = Field(default="", validation_alias="SUPABASE_SERVICE_KEY")
    supabase_jwt_secret: str = Field(default="", validation_alias="SUPABASE_JWT_SECRET")
    # Supabase issues "authenticated" as the aud claim for logged-in users by
    # default. Validated on every token (see auth.py) to prevent tokens minted
    # for a different Supabase project/audience from being accepted here.
    supabase_audience: str = Field(default="authenticated", validation_alias="SUPABASE_AUDIENCE")

    # Optional/CORS Config
    cors_origins: str = Field(default="http://localhost:3000", validation_alias="CORS_ORIGINS")
    sentry_dsn: str = Field(default="", validation_alias="SENTRY_DSN")

    # Model Names
    groq_model: str = Field(default="llama-3.3-70b-versatile", validation_alias="GROQ_MODEL")
    gemini_model: str = Field(default="gemini-2.0-flash", validation_alias="GEMINI_MODEL")
    embedding_model: str = Field(default="gemini-embedding-2", validation_alias="EMBEDDING_MODEL")

    # Bounded cache / limits
    max_content_cache_bytes: int = Field(default=10 * 1024 * 1024, validation_alias="MAX_CONTENT_CACHE_BYTES")  # 10MB
    repo_size_limit_bytes: int = Field(default=100 * 1024 * 1024, validation_alias="REPO_SIZE_LIMIT_BYTES")  # 100MB
    repo_file_limit: int = Field(default=2000, validation_alias="REPO_FILE_LIMIT")  # 2000 files

    # H-02 — bounded wait on shutdown for in-flight BackgroundTasks (e.g.
    # save_analysis, index_repository) before the shared executors are drained.
    background_task_drain_timeout_s: float = Field(default=30.0, validation_alias="BACKGROUND_TASK_DRAIN_TIMEOUT_S")

    # T2.3 — graph export & viz caps
    # export_graph_json() caps connected nodes at this many (collapses surplus
    # into a synthetic __collapsed__ node). Mirror of Mermaid's 50 cap one tier up.
    graph_max_nodes: int = Field(default=100, validation_alias="GRAPH_MAX_NODES")
    # _auto_viz_dependencies() inside ExplanationOrchestrator caps hardcoded at this many edges.
    viz_max_edges: int = Field(default=100, validation_alias="VIZ_MAX_EDGES")

    # Rate Limiting
    rate_limit_ip_rpm: int = Field(default=60, validation_alias="RATE_LIMIT_IP_RPM")
    rate_limit_user_rpm: int = Field(default=20, validation_alias="RATE_LIMIT_USER_RPM")

    # Daily Quotas
    daily_user_token_quota: int = Field(default=200_000, validation_alias="DAILY_USER_TOKEN_QUOTA")
    global_daily_spend_limit_usd: float = Field(default=5.0, validation_alias="GLOBAL_DAILY_SPEND_LIMIT_USD")

    # T4.1 — Quota/breaker tunables.
    # If True, /explain and /chat will return HTTP 429 once a user exceeds
    # their daily token quota; if False they get a soft warning + degraded
    # output. Default OFF — production should set to true once observability
    # confirms the cost model is right.
    enforce_token_quota: bool = Field(default=False, validation_alias="ENFORCE_TOKEN_QUOTA")
    # M-07 — validate_providers() makes real (billed) LLM calls at startup.
    # Default OFF so cold starts (including scale-to-zero/CI) don't burn
    # untracked spend; opt in explicitly per-environment.
    validate_providers_on_startup: bool = Field(default=False, validation_alias="VALIDATE_PROVIDERS_ON_STARTUP")
    # M-08 — pause between orchestrator batches to stay under the LLM
    # provider's RPM limit (Groq's free tier is 30 RPM). Configurable so
    # deployments on higher-tier quotas don't eat a fixed 6s tax per report.
    orchestrator_batch_delay_s: float = Field(default=3.0, validation_alias="ORCHESTRATOR_BATCH_DELAY_S")
    # Cost per 1k tokens by provider. Used by TokenTracker to populate
    # ``estimated_cost_usd`` in log records. Order-of-magnitude figures —
    # actual Groq/Gemini pricing varies by tier.
    cost_per_1k_tokens_usd: dict[str, float] = Field(
        default_factory=lambda: {
            "groq": 0.0008,
            "gemini": 0.0005,
        },
        validation_alias="COST_PER_1K_TOKENS_USD",
    )


settings = Settings()


def validate_config() -> None:
    """Validate required configs are set on startup."""
    required = [
        ("GROQ_API_KEY", settings.groq_api_key),
        ("GEMINI_API_KEY", settings.gemini_api_key),
        # L-15: embeddings run through Cloudflare (indexer.py), so its
        # credentials gate the core RAG feature just like Zilliz does. If
        # they're unset, indexing silently no-ops and the repo is marked
        # "analyzed" with an empty vector index — fail fast at startup instead.
        ("CLOUDFLARE_ACCOUNT_ID", settings.cloudflare_account_id),
        ("CLOUDFLARE_API_TOKEN", settings.cloudflare_api_token),
        ("ZILLIZ_URI", settings.zilliz_uri),
        ("ZILLIZ_API_KEY", settings.zilliz_api_key),
        ("REDIS_URL", settings.redis_url),
        ("SUPABASE_URL", settings.supabase_url),
        ("SUPABASE_SERVICE_KEY", settings.supabase_service_key),
        ("SUPABASE_JWT_SECRET", settings.supabase_jwt_secret),
    ]
    missing = [name for name, val in required if not val]
    if missing:
        raise ValueError(
            f"Missing required configuration variables: {', '.join(missing)}. Please check your .env file."
        )

    # M-10: CORS_ORIGINS="*" combined with allow_credentials=True (main.py)
    # advertises a wildcard origin to credentialed traffic — every read
    # endpoint becomes world-readable from any origin. Reject at config time;
    # operators that genuinely want a wildcard must disable credentials.
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    if "*" in origins:
        raise ValueError("CORS_ORIGINS='*' is not allowed with credentialed CORS; list explicit origins.")
