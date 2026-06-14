"""
codekavi.auth — Authentication helpers for CodeKavi.
Verifies Supabase JWT tokens server-side using PyJWT.
"""

import jwt
from fastapi import Header, HTTPException, status

from codekavi.settings import settings


def verify_supabase_token(authorization: str = Header(...)) -> str:
    """
    Verify Supabase JWT token in request headers.
    Returns user_id (the 'sub' claim) on success.
    """
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET is not configured on the server.",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authorization header. Must start with 'Bearer '."
        )

    token = authorization.split("Bearer ")[1]
    try:
        # Supabase JWTs are typically HS256 signed using the JWT secret
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
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
