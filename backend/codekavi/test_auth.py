"""JWT verification: the token's own header must never pick the verification
algorithm (algorithm-confusion), and expired/audience-mismatched tokens must
be rejected."""

import time

import jwt
import pytest
from fastapi import HTTPException

from codekavi import auth
from codekavi.settings import settings

SECRET = "test-secret-at-least-32-bytes-long-xx"


@pytest.fixture(autouse=True)
def _configure_secret(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_audience", "authenticated")


def _token(claims=None, alg="HS256", secret=SECRET):
    payload = {"sub": "user-1", "aud": "authenticated", "exp": int(time.time()) + 3600}
    payload.update(claims or {})
    return jwt.encode(payload, secret, algorithm=alg)


def test_valid_hs256_token_returns_user_id():
    assert auth._decode_supabase_token(_token()) == "user-1"


def test_disallowed_algorithm_is_rejected():
    # HS384 is a legitimate JWT alg but outside the server's pinned allowlist —
    # a forged header must not be allowed to pick it.
    token = _token(alg="HS384")
    with pytest.raises(jwt.InvalidAlgorithmError):
        auth._decode_supabase_token(token)


def test_expired_token_is_rejected():
    token = _token({"exp": int(time.time()) - 10})
    with pytest.raises(jwt.ExpiredSignatureError):
        auth._decode_supabase_token(token)


def test_audience_mismatch_is_rejected():
    token = _token({"aud": "some-other-audience"})
    with pytest.raises(jwt.InvalidAudienceError):
        auth._decode_supabase_token(token)


def test_missing_sub_claim_is_rejected():
    token = jwt.encode({"aud": "authenticated", "exp": int(time.time()) + 3600}, SECRET, algorithm="HS256")
    with pytest.raises(jwt.InvalidTokenError):
        auth._decode_supabase_token(token)


def test_verify_supabase_token_rejects_missing_header():
    with pytest.raises(HTTPException) as exc:
        auth.verify_supabase_token(None)
    assert exc.value.status_code == 401


def test_verify_supabase_token_rejects_malformed_header():
    with pytest.raises(HTTPException) as exc:
        auth.verify_supabase_token("NotBearer abc")
    assert exc.value.status_code == 401


def test_verify_supabase_token_accepts_valid_bearer():
    assert auth.verify_supabase_token(f"Bearer {_token()}") == "user-1"
