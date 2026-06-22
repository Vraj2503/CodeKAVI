from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, HTTPException, Request

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.quota import get_token_tracker


def get_cache(request: Request) -> AnalysisCache:
    """Retrieve the AnalysisCache instance from application state."""
    return request.app.state.cache


def get_executor(request: Request) -> ThreadPoolExecutor:
    """Retrieve the ThreadPoolExecutor instance from application state."""
    return request.app.state.executor


def enforce_quota(
    user_id: str = Depends(verify_supabase_token),
) -> str:
    """
    T4.1 — per-user daily token quota gate.

    Returns the authenticated ``user_id`` after passing the quota check.
    Raises HTTP 429 with ``error=quota_exceeded`` if the user is over their
    daily limit AND ``settings.enforce_token_quota`` is True. When enforcement
    is disabled (the default) this is a no-op — useful for staging and dev.

    Use as a FastAPI dependency::

        @router.post("/explain/{repo_id}")
        async def explain(user_id: str = Depends(enforce_quota)):
            ...

    Endpoints that consume this dependency should still gate explicitly when
    they have a mixed route table, but the dedicated gates inside
    ``/explain/{repo_id}``, ``/explain/file/{repo_id}``, and ``/chat/{repo_id}``
    remain so the error message stays uniform regardless of caller.
    """
    tracker = get_token_tracker()
    if not tracker.check_quota(user_id):
        from codekavi.settings import settings

        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": tracker.get_remaining(user_id),
                "enforced": settings.enforce_token_quota,
            },
        )
    return user_id
