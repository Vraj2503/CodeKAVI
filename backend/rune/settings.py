"""
rune.settings — Settings management using pydantic-settings.
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
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")

    # Model Names
    groq_model: str = Field(default="openai/gpt-oss-120b", validation_alias="GROQ_MODEL")
    gemini_model: str = Field(default="gemini-2.0-flash", validation_alias="GEMINI_MODEL")
    embedding_model: str = Field(default="gemini-embedding-2", validation_alias="EMBEDDING_MODEL")
    # RAG embedding provider. ``cloudflare`` is intentionally the default so
    # deploying without new environment variables behaves exactly as before.
    embedding_provider: str = Field(default="cloudflare", validation_alias="EMBEDDING_PROVIDER")
    # Fallback behavior when the local provider is unreachable at index start:
    # "cloudflare" (default) falls back to Cloudflare Workers AI when configured.
    # "none" stops the indexing run as failed immediately (mandatory for speed runs).
    embedding_fallback: str = Field(default="cloudflare", validation_alias="EMBEDDING_FALLBACK")
    local_embedding_base_url: str = Field(
        default="http://localhost:1234/v1",
        validation_alias="LOCAL_EMBEDDING_BASE_URL",
    )
    local_embedding_model: str = Field(
        default="text-embedding-bge-large-en-v1.5",
        validation_alias="LOCAL_EMBEDDING_MODEL",
    )
    local_embedding_api_key: str = Field(default="", validation_alias="LOCAL_EMBEDDING_API_KEY")
    local_embedding_pooling: str = Field(default="cls", validation_alias="LOCAL_EMBEDDING_POOLING")
    # Prefixes are deliberately opt-in. Changing a document prefix requires a
    # re-index because it changes the stored vector space.
    local_embedding_document_prefix: str = Field(default="", validation_alias="LOCAL_EMBEDDING_DOCUMENT_PREFIX")
    local_embedding_query_prefix: str = Field(default="", validation_alias="LOCAL_EMBEDDING_QUERY_PREFIX")
    # Optional explicit tokenizer.json. When unset, LocalEmbedding only uses
    # the matching tokenizer already present in Hugging Face's local cache.
    local_embedding_tokenizer_path: str = Field(default="", validation_alias="LOCAL_EMBEDDING_TOKENIZER_PATH")
    local_embedding_timeout_s: float = Field(default=30.0, validation_alias="LOCAL_EMBEDDING_TIMEOUT_S")
    local_embedding_chunk_overlap_tokens: int = Field(
        default=64,
        validation_alias="LOCAL_EMBEDDING_CHUNK_OVERLAP_TOKENS",
    )
    # Target chunk size in tokens (R4a). 0 uses the model spec's default (512 for bge-large and qwen3).
    local_embedding_chunk_tokens: int = Field(default=0, validation_alias="LOCAL_EMBEDDING_CHUNK_TOKENS")
    # Hard token context ceiling for local models. 0 uses the model spec's max context.
    local_embedding_max_tokens: int = Field(default=0, validation_alias="LOCAL_EMBEDDING_MAX_TOKENS")
    # Batch size for local embedding requests (S7). Defaults to 32 chunks per POST.
    local_embedding_batch_size: int = Field(default=32, validation_alias="LOCAL_EMBEDDING_BATCH_SIZE")
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
    # Number of trusted reverse proxies in front of the app that append to
    # X-Forwarded-For. The IP this many hops from the end of the chain is the
    # last one written by our own infra; anything left of that is client-supplied
    # and spoofable.
    trusted_proxy_hops: int = Field(default=1, validation_alias="TRUSTED_PROXY_HOPS")

    # Daily Quotas
    daily_user_token_quota: int = Field(default=200_000, validation_alias="DAILY_USER_TOKEN_QUOTA")
    global_daily_spend_limit_usd: float = Field(default=5.0, validation_alias="GLOBAL_DAILY_SPEND_LIMIT_USD")

    # T4.1 — Quota/breaker tunables.
    # If True, /explain and /chat will return HTTP 429 once a user exceeds
    # their daily token quota; if False they get a soft warning + degraded
    # output. Default ON — set ENFORCE_TOKEN_QUOTA=false to opt out (e.g. while
    # tuning the cost model in a non-prod env).
    enforce_token_quota: bool = Field(default=True, validation_alias="ENFORCE_TOKEN_QUOTA")
    # M-07 — validate_providers() makes real (billed) LLM calls at startup.
    # Default OFF so cold starts (including scale-to-zero/CI) don't burn
    # untracked spend; opt in explicitly per-environment.
    validate_providers_on_startup: bool = Field(default=False, validation_alias="VALIDATE_PROVIDERS_ON_STARTUP")
    # M-08 — pause between orchestrator batches to stay under the LLM
    # provider's RPM limit (Groq's free tier is 30 RPM). Configurable so
    # deployments on higher-tier quotas don't eat a fixed 6s tax per report.
    orchestrator_batch_delay_s: float = Field(default=3.0, validation_alias="ORCHESTRATOR_BATCH_DELAY_S")
    indexer_batch_delay_s: float = Field(
        default=1.0,
        validation_alias="INDEXER_BATCH_DELAY_S",
        description="Seconds to pause between embedding batches. Set to 0 for testing speed.",
    )
    # Leave test code and fixtures (config.is_test_path) out of the vector index.
    # Tests describe each feature in plain sentences, so they outrank the code that
    # implements it: on React (52% of chunks are tests) top-5 retrieval of the right
    # file went from 13% to 50% without them, and indexing does half the work.
    index_exclude_tests: bool = Field(default=True, validation_alias="INDEX_EXCLUDE_TESTS")
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


def parsed_cors_origins() -> list[str]:
    """CORS_ORIGINS, split and trimmed once — reused by validate_config and main.py."""
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]


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

    provider = settings.embedding_provider.strip().lower()
    if provider not in ("cloudflare", "local"):
        raise ValueError(
            f"Invalid EMBEDDING_PROVIDER={settings.embedding_provider!r}; must be 'cloudflare' or 'local'."
        )
    fallback = settings.embedding_fallback.strip().lower()
    if fallback not in ("cloudflare", "none"):
        raise ValueError(f"Invalid EMBEDDING_FALLBACK={settings.embedding_fallback!r}; must be 'cloudflare' or 'none'.")

    # M-10: CORS_ORIGINS="*" combined with allow_credentials=True (main.py)
    # advertises a wildcard origin to credentialed traffic — every read
    # endpoint becomes world-readable from any origin. Reject at config time;
    # operators that genuinely want a wildcard must disable credentials.
    origins = parsed_cors_origins()
    if "*" in origins:
        raise ValueError("CORS_ORIGINS='*' is not allowed with credentialed CORS; list explicit origins.")
