"""
rune.auth — Authentication helpers for Rune.
Verifies Supabase JWT tokens server-side using PyJWT.
"""

import jwt
from fastapi import Header, HTTPException, status

from rune.settings import settings

# Algorithms this server will accept for a Supabase-issued JWT, pinned
# server-side. Supabase projects sign with either a shared HMAC secret
# (legacy) or an asymmetric key served via JWKS (current default), so both
# families are allowed — but the token's own header must never be the sole
# source of truth for which algorithm gets used to verify it, since that
# lets an attacker pick a verification path (algorithm-confusion).
ALLOWED_ALGS = ["HS256", "RS256", "ES256"]

# H-04 — a fresh PyJWKClient (and its own HTTP fetch of the JWKS document)
# was being created on every RS256/ES256 request with no cache, letting an
# attacker flood the server with non-HS tokens to force-repeat unauthenticated
# JWKS fetches against Supabase. Build one client at module load and reuse it;
# PyJWKClient caches keys in-process and only refetches on a cache miss or
# after `lifespan` seconds.
_jwks_client: jwt.PyJWKClient | None = None
if settings.supabase_url:
    _jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    _jwks_client = jwt.PyJWKClient(_jwks_url, cache_keys=True, lifespan=3600)


def _decode_supabase_token(token: str) -> str:
    """
    Decode and verify a Supabase JWT, returning the user_id ('sub' claim).
    Raises jwt.* exceptions on a bad/expired token, or RuntimeError if the
    server isn't configured to verify it (missing SUPABASE_URL for a
    JWKS-backed alg). Callers translate these into their own error handling.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")

    # Reject anything outside the pinned allowlist — do not let the
    # token's own (attacker-controlled) header decide which algorithm
    # family gets used to verify it.
    if alg not in ALLOWED_ALGS:
        raise jwt.InvalidAlgorithmError(f"Algorithm '{alg}' is not allowed.")

    if alg.startswith("HS"):
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[alg],
            audience=settings.supabase_audience,
            options={"verify_aud": True},
        )
    else:
        if _jwks_client is None:
            raise RuntimeError("SUPABASE_URL is not configured on the server.")
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[alg],
            audience=settings.supabase_audience,
            options={"verify_aud": True},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise jwt.InvalidTokenError("Invalid token payload: missing 'sub' claim.")
    return str(user_id)


def verify_supabase_token(authorization: str | None = Header(None)) -> str:
    """
    Verify Supabase JWT token in request headers.
    Returns user_id (the 'sub' claim) on success.
    """
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET is not configured on the server.",
        )

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authorization header. Must start with 'Bearer '."
        )

    token = authorization.split("Bearer ")[1]
    try:
        return _decode_supabase_token(token)
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        ) from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        ) from e
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {e}",
        ) from e


def try_get_user_id(authorization: str | None) -> str | None:
    """
    Best-effort JWT verification for non-security-critical uses (e.g.
    rate-limit bucketing, M-06). Returns the verified user_id, or None if
    the header is absent/malformed or the token fails verification.

    This must never be used as an access-control check — a None return
    here just means "bucket by IP instead," not "reject the request."
    """
    if not authorization or not authorization.startswith("Bearer ") or not settings.supabase_jwt_secret:
        return None
    token = authorization.split("Bearer ")[1]
    try:
        return _decode_supabase_token(token)
    except Exception:
        return None
