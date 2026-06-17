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
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from codekavi.cache import AnalysisCache
from codekavi.cloner import cleanup_old_repos
from codekavi.limiter import limiter
from codekavi.logging_config import RequestIDMiddleware, setup_logging
from codekavi.routes import api_router
from codekavi.settings import settings
from codekavi.utils import current_executor

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

    executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="codekavi-")
    cache = AnalysisCache()

    app.state.executor = executor
    app.state.cache = cache

    cleanup_old_repos(max_age_hours=2)
    yield
    # Shutdown — let in-flight requests complete, then terminate executor
    executor.shutdown(wait=True)


app = FastAPI(
    title="CodeKavi API",
    version="2.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
app.add_middleware(RequestIDMiddleware)


@app.middleware("http")
async def set_current_executor_middleware(request: Request, call_next):
    executor = getattr(request.app.state, "executor", None)
    if executor:
        token = current_executor.set(executor)
        try:
            return await call_next(request)
        finally:
            current_executor.reset(token)
    return await call_next(request)


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
