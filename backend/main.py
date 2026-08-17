"""
main.py — FastAPI application entry point for Rune.

All route handlers live in rune.routes.*
This file only wires up the app, middleware, health check, and lifespan.
"""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from rune.cache import AnalysisCache
from rune.cloner import MAX_REPO_AGE_HOURS, cleanup_old_repos
from rune.limiter import close_limiter, init_limiter, per_minute
from rune.logging_config import RequestIDMiddleware, setup_logging
from rune.routes import api_router
from rune.settings import parsed_cors_origins, settings
from rune.task_registry import BackgroundTaskRegistry
from rune.utils import current_cpu_executor, current_io_executor, run_sync

# Setup logging immediately before other modules log anything
setup_logging()
load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Startup: create ThreadPoolExecutor & AnalysisCache, run repo cleanup.
    Shutdown: gracefully shut down the shared thread-pool executor.
    """
    # Startup
    from rune.settings import validate_config

    validate_config()

    from rune.llm.providers import validate_providers

    validate_providers()

    await init_limiter()

    # M-21: sizes were hardcoded, so a 1-core container had its CPU pool
    # starved by a fixed 8-worker count sized for larger hosts. Configurable
    # via env, defaulting to the previous values / cpu_count().
    io_workers = int(os.getenv("IO_EXECUTOR_WORKERS", "32"))
    cpu_workers = int(os.getenv("CPU_EXECUTOR_WORKERS", str(min(8, (os.cpu_count() or 8)))))
    io_executor = ThreadPoolExecutor(max_workers=io_workers, thread_name_prefix="rune-io-")
    cpu_executor = ThreadPoolExecutor(max_workers=cpu_workers, thread_name_prefix="rune-cpu-")
    cache = AnalysisCache()
    task_registry = BackgroundTaskRegistry()

    app.state.io_executor = io_executor
    app.state.cpu_executor = cpu_executor
    app.state.cache = cache
    app.state.task_registry = task_registry

    cleanup_old_repos(max_age_hours=MAX_REPO_AGE_HOURS)
    yield
    # Shutdown — H-02: wait (bounded) for tracked BackgroundTasks (e.g.
    # save_analysis, index_repository) to finish before draining the
    # executors they depend on, so a repo is never left half-indexed.
    await task_registry.wait_for_drain(settings.background_task_drain_timeout_s)
    io_executor.shutdown(wait=True)
    cpu_executor.shutdown(wait=True)
    await close_limiter()
    # H-12 — close the shared Cloudflare embedding session so its connection
    # pool is released cleanly instead of leaking on shutdown.
    from rune.embedding import close_cloudflare_session

    await close_cloudflare_session()


app = FastAPI(
    title="Rune API",
    version="2.0.0",
    lifespan=lifespan,
)
app.add_middleware(RequestIDMiddleware)


@app.middleware("http")
async def set_current_executor_middleware(request: Request, call_next):
    io_executor = getattr(request.app.state, "io_executor", None)
    cpu_executor = getattr(request.app.state, "cpu_executor", None)

    tokens = []
    if io_executor:
        tokens.append((current_io_executor, current_io_executor.set(io_executor)))
    if cpu_executor:
        tokens.append((current_cpu_executor, current_cpu_executor.set(cpu_executor)))

    try:
        return await call_next(request)
    finally:
        for var, token in tokens:
            var.reset(token)


# CORS — configurable origins for production, defaults to localhost:3000 for dev
ALLOWED_ORIGINS = parsed_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

os.makedirs("output/reports", exist_ok=True)

# T4.3 — Prometheus /metrics endpoint. Lazily imported so missing packages
# never crash startup; the rest of the app stays fully functional without it.
try:
    from prometheus_fastapi_instrumentator import Instrumentator

    Instrumentator().instrument(app).expose(app)
except ImportError:
    import logging

    logging.getLogger(__name__).info("prometheus-fastapi-instrumentator not installed; /metrics endpoint disabled")


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    gemini_configured = bool(settings.gemini_api_key)
    return {
        "status": "ok",
        "service": "Rune API",
        "llm_configured": gemini_configured,
        "llm_provider": "gemini" if gemini_configured else None,
    }


def _ping_redis() -> bool | None:
    """None = not configured, so it's excluded from the overall status."""
    if not settings.redis_url:
        return None
    try:
        import redis

        return bool(redis.from_url(settings.redis_url).ping())
    except Exception:
        return False


def _ping_zilliz() -> bool | None:
    if not (settings.zilliz_uri and settings.zilliz_api_key):
        return None
    from rune.vectorstore import ZillizClient

    try:
        return ZillizClient().collection_exists()
    except Exception:
        return False


def _ping_supabase() -> bool | None:
    if not (settings.supabase_url and settings.supabase_service_key):
        return None
    try:
        from supabase import create_client

        sb = create_client(settings.supabase_url, settings.supabase_service_key)
        sb.table("analysis_cache").select("repo_id").limit(1).execute()
        return True
    except Exception:
        return False


# IMPL-16 — deep dependency check for uptime monitors. Rate-limited since
# each call opens fresh connections instead of reusing the app's pooled ones.
@app.get("/api/health/deep", dependencies=[Depends(per_minute(6))])
async def health_deep():
    """Pings Redis, Zilliz, and Supabase and reports per-dependency status.

    A dependency the deployment doesn't configure (unset env vars) is
    reported as ``"not_configured"`` rather than counted as down.
    """
    redis_ok, zilliz_ok, supabase_ok = await asyncio.gather(
        run_sync(_ping_redis),
        run_sync(_ping_zilliz),
        run_sync(_ping_supabase),
    )

    def _label(ok: bool | None) -> str:
        return "not_configured" if ok is None else ("up" if ok else "down")

    dependencies = {"redis": _label(redis_ok), "zilliz": _label(zilliz_ok), "supabase": _label(supabase_ok)}
    healthy = all(v != "down" for v in dependencies.values())
    return {
        "status": "ok" if healthy else "degraded",
        "service": "Rune API",
        "dependencies": dependencies,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_excludes=["cloned_repos/*", "output/*"],
    )
