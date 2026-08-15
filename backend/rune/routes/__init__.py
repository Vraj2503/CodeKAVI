"""
rune.routes — API route package.

Combines all route modules into a single APIRouter with prefix="/api".
"""

from fastapi import APIRouter

from rune.routes.analyze import router as analyze_router
from rune.routes.chat import router as chat_router
from rune.routes.explain import router as explain_router
from rune.routes.export import router as export_router
from rune.routes.graph import router as graph_router
from rune.routes.visualize import router as visualize_router

api_router = APIRouter(prefix="/api")
api_router.include_router(analyze_router)
api_router.include_router(chat_router)
api_router.include_router(explain_router)
api_router.include_router(export_router)
api_router.include_router(graph_router)
api_router.include_router(visualize_router)
