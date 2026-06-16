"""
codekavi.auth — Authentication helpers for CodeKavi.
Verifies Supabase JWT tokens server-side using PyJWT.
"""

import jwt
from fastapi import Header, HTTPException, status

from codekavi.settings import settings


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
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        # Accept the token's algorithm dynamically if not 'none'
        if alg.lower() == "none":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Algorithm 'none' is not allowed.",
            )

        if alg.startswith("HS"):
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=[alg],
                options={"verify_aud": False},
            )
        else:
            base_url = settings.supabase_url.rstrip("/")
            jwks_url = f"{base_url}/auth/v1/.well-known/jwks.json"
            jwk_client = jwt.PyJWKClient(jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                options={"verify_aud": False},
            )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: missing 'sub' claim.",
            )
        return str(user_id)
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {e}",
        ) from e
