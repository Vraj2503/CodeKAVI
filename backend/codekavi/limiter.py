"""
codekavi.limiter — ASGI-native rate limiting (fastapi-limiter, Redis-backed).

H-15: slowapi's `@limiter.limit(...)` decorator wraps the route function
before Starlette's dependency-injection/ASGI machinery sees it, which is not
officially supported for `async def` handlers — under concurrent async
requests it can silently under-enforce limits (see slowapi issue tracker).
fastapi-limiter instead enforces limits as a normal FastAPI dependency,
backed by an atomic Redis Lua script (INCR + PTTL), so the check is correct
regardless of how many requests are in flight concurrently.

Redis is optional in this deployment (mirrors the L2-cache fallback in
cache.py): if it can't be reached at startup, rate limiting is disabled
rather than crashing the app.
"""

import logging

from fastapi import Request, Response
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter as _RateLimiter

from codekavi.auth import try_get_user_id
from codekavi.settings import settings

logger = logging.getLogger(__name__)

_enabled = False


async def user_or_ip_identifier(request: Request) -> str:
    """
    M-06: the default fastapi-limiter identifier buckets purely by IP
    (X-Forwarded-For or client.host), so a corporate NAT/shared egress IP
    collapses many distinct users into one bucket — one tenant's traffic
    can burn another's limit. Bucket by authenticated user_id when the
    request carries a verified token, and fall back to IP only for routes
    that don't require (or don't have) one.
    """
    user_id = try_get_user_id(request.headers.get("Authorization"))
    if user_id:
        return f"user:{user_id}:{request.scope['path']}"

    forwarded = request.headers.get("X-Forwarded-For")
    ip = forwarded.split(",")[0] if forwarded else request.client.host
    return f"ip:{ip}:{request.scope['path']}"


async def init_limiter() -> None:
    """Connect to Redis and initialize FastAPILimiter. Call once on app startup."""
    global _enabled
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
        await client.ping()
        await FastAPILimiter.init(client, prefix="codekavi-ratelimit")
        _enabled = True
        logger.info("Rate limiter connected to Redis")
    except Exception as e:
        _enabled = False
        logger.warning(f"Redis unavailable — rate limiting disabled: {e}")


async def close_limiter() -> None:
    """Release the Redis connection. Call once on app shutdown."""
    global _enabled
    if _enabled:
        await FastAPILimiter.close()
        _enabled = False


class RateLimiter(_RateLimiter):
    """fastapi-limiter's RateLimiter, but a no-op when Redis never connected."""

    async def __call__(self, request: Request, response: Response):
        if not _enabled:
            return
        return await super().__call__(request, response)


def per_minute(times: int) -> RateLimiter:
    """Dependency factory: `Depends(per_minute(5))` limits a route to N req/min per client."""
    return RateLimiter(times=times, seconds=60, identifier=user_or_ip_identifier)
