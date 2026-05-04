"""
main.py — FastAPI application entry point for CodeKavi.

All route handlers live in codekavi.routes.*
This file only wires up the app, middleware, and health check.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from codekavi.routes import api_router

load_dotenv()

app = FastAPI(title="CodeKavi API", version="2.0.0")

# CORS — allow all origins during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

os.makedirs("output/reports", exist_ok=True)


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
