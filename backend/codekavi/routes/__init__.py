"""
codekavi.routes — API route package.

Combines all route modules into a single APIRouter with prefix="/api".
"""

from fastapi import APIRouter

from codekavi.routes.analyze import router as analyze_router
from codekavi.routes.chat import router as chat_router
from codekavi.routes.explain import router as explain_router
from codekavi.routes.export import router as export_router
from codekavi.routes.visualize import router as visualize_router

api_router = APIRouter(prefix="/api")
api_router.include_router(analyze_router)
api_router.include_router(chat_router)
api_router.include_router(explain_router)
api_router.include_router(export_router)
api_router.include_router(visualize_router)
