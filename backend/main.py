"""
main.py — FastAPI application entry point for CodeKavi.

All route handlers live in codekavi.routes.*
~This file only wires up the app, middleware, and health check.
"""

import os

from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

from codekavi.routes import api_router
from codekavi.cloner import cleanup_old_repos

load_dotenv()

app = FastAPI(title="CodeKavi API", version="2.0.0")

# CORS — configurable origins for production, defaults to localhost:3000 for dev
ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

os.makedirs("output/reports", exist_ok=True)


@app.on_event("startup")
async def startup_cleanup():
    """Clean stale cloned repos on startup to prevent disk bloat."""
    cleanup_old_repos(max_age_hours=2)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    gemini_configured = bool(os.environ.get("GEMINI_API_KEY", ""))
    return {
        "status": "ok",
        "service": "CodeKavi API",
        "llm_configured": gemini_configured,
        "llm_provider": "gemini" if gemini_configured else None,
    }
