from concurrent.futures import ThreadPoolExecutor

from fastapi import Request

from codekavi.cache import AnalysisCache


def get_cache(request: Request) -> AnalysisCache:
    """Retrieve the AnalysisCache instance from application state."""
    return request.app.state.cache

def get_executor(request: Request) -> ThreadPoolExecutor:
    """Retrieve the ThreadPoolExecutor instance from application state."""
    return request.app.state.executor
