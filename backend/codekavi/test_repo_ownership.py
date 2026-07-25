"""IDOR guard: assert_repo_owner must deny cross-user access to a cached
analysis but allow legacy rows (no recorded owner) through as public/read-only."""

import pytest
from fastapi import HTTPException

from codekavi.session import assert_repo_owner


def test_owner_can_access_own_repo():
    assert_repo_owner({"owner_user_id": "user-a"}, "user-a")  # no raise


def test_other_user_denied_with_404():
    with pytest.raises(HTTPException) as exc:
        assert_repo_owner({"owner_user_id": "user-a"}, "user-b")
    assert exc.value.status_code == 404


def test_legacy_row_without_owner_is_not_denied():
    assert_repo_owner({}, "user-b")  # no raise — no owner on record
