"""
main.py — FastAPI application entry point for CodeKavi.

All route handlers live in codekavi.routes.*
This file only wires up the app, middleware, health check, and lifespan.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from codekavi.cache import AnalysisCache
from codekavi.cloner import MAX_REPO_AGE_HOURS, cleanup_old_repos
from codekavi.limiter import close_limiter, init_limiter
from codekavi.logging_config import RequestIDMiddleware, setup_logging
from codekavi.routes import api_router
from codekavi.settings import settings
from codekavi.task_registry import BackgroundTaskRegistry
from codekavi.utils import current_io_executor, current_cpu_executor

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
    from codekavi.settings import validate_config

    validate_config()

    from codekavi.llm.providers import validate_providers

    validate_providers()

    await init_limiter()

    io_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="codekavi-io-")
    cpu_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="codekavi-cpu-")
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
    from codekavi.embedding import close_cloudflare_session

    await close_cloudflare_session()


app = FastAPI(
    title="CodeKavi API",
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
ALLOWED_ORIGINS = settings.cors_origins.split(",")

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
        "service": "CodeKavi API",
        "llm_configured": gemini_configured,
        "llm_provider": "gemini" if gemini_configured else None,
    }
