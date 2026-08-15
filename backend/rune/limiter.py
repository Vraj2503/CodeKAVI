"""
rune.limiter — ASGI-native rate limiting (fastapi-limiter, Redis-backed).

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
import time

from cachetools import TTLCache
from fastapi import HTTPException, Request, Response
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter as _RateLimiter

from rune.auth import try_get_user_id
from rune.settings import settings

logger = logging.getLogger(__name__)

_enabled = False

# ponytail: per-process token bucket, not shared across workers/replicas —
# degraded fallback only while Redis is down. Bounded (like the L1 cache in
# cache.py) so a flood of distinct IPs/users can't grow this unbounded.
_local_buckets: TTLCache = TTLCache(maxsize=8192, ttl=60)


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

    ip = _client_ip(request)
    return f"ip:{ip}:{request.scope['path']}"


def _client_ip(request: Request) -> str:
    """M-09: trust only the hop appended by our own reverse proxy chain.

    X-Forwarded-For is `client, proxy1, proxy2, ...` — each proxy appends the
    peer it saw. Everything left of the last `trusted_proxy_hops` entries came
    from the client and is spoofable; take the IP `trusted_proxy_hops` from
    the end instead of the client-controlled first entry.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        chain = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
        hops = settings.trusted_proxy_hops
        if chain and 0 < hops <= len(chain):
            return chain[-hops]
        if chain:
            return chain[0]
    return request.client.host if request.client else "unknown"


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
    """fastapi-limiter's RateLimiter. Falls back to a degraded local
    token bucket when Redis is unreachable, instead of allowing unlimited traffic."""

    async def __call__(self, request: Request, response: Response):
        if _enabled:
            return await super().__call__(request, response)

        key = await user_or_ip_identifier(request)
        window_seconds = self.milliseconds / 1000
        now = time.monotonic()
        window = [t for t in _local_buckets.get(key, []) if now - t < window_seconds]
        if len(window) >= self.times:
            raise HTTPException(status_code=429, detail="Rate limit exceeded (degraded local limiter)")
        window.append(now)
        _local_buckets[key] = window


def per_minute(times: int) -> RateLimiter:
    """Dependency factory: `Depends(per_minute(5))` limits a route to N req/min per client."""
    return RateLimiter(times=times, seconds=60, identifier=user_or_ip_identifier)
