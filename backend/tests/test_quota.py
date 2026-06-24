"""
test_quota.py — T4.1 TokenTracker unit tests.
"""

from __future__ import annotations

import pytest

from codekavi.quota import TokenTracker, get_token_tracker


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Reset the process-singleton between tests so quotas start at zero."""
    if get_token_tracker() is not None:
        get_token_tracker().reset()
    yield


def _fresh_tracker() -> TokenTracker:
    tracker = TokenTracker()
    tracker.reset()
    return tracker


class TestCost:
    def test_cost_estimate_uses_provider_pricing(self):
        tracker = _fresh_tracker()
        # 1000 groq tokens at the default $0.0008/1k = $0.0008
        assert tracker.estimate_cost_usd("groq", 1000) == pytest.approx(0.0008, rel=1e-9)
        # 2000 groq tokens
        assert tracker.estimate_cost_usd("groq", 2000) == pytest.approx(0.0016, rel=1e-9)

    def test_cost_unknown_provider_returns_zero(self):
        tracker = _fresh_tracker()
        assert tracker.estimate_cost_usd("unknown-provider", 12345) == 0.0

    def test_cost_zero_tokens_returns_zero(self):
        tracker = _fresh_tracker()
        assert tracker.estimate_cost_usd("groq", 0) == 0.0


class TestRecord:
    def test_record_increments_user_bucket(self):
        tracker = _fresh_tracker()
        tracker.record(user_id="alice", provider="groq", tokens=500)
        tracker.record(user_id="alice", provider="groq", tokens=200)
        assert tracker.get_used("alice") == 700

    def test_record_negative_tokens_ignored(self):
        tracker = _fresh_tracker()
        tracker.record(user_id="bob", provider="groq", tokens=-100)
        assert tracker.get_used("bob") == 0

    def test_record_zero_tokens_ignored(self):
        tracker = _fresh_tracker()
        tracker.record(user_id="bob", provider="groq", tokens=0)
        assert tracker.get_used("bob") == 0

    def test_record_none_user_only_updates_global(self):
        tracker = _fresh_tracker()
        tracker.record(user_id=None, provider="groq", tokens=999)
        assert tracker.get_used(None) == 0
        assert tracker.get_global_used() == 999

    def test_global_bucket_separate_from_per_user(self):
        tracker = _fresh_tracker()
        tracker.record(user_id="alice", provider="groq", tokens=100)
        tracker.record(user_id="bob", provider="groq", tokens=50)
        tracker.record(user_id=None, provider="groq", tokens=200)
        assert tracker.get_used("alice") == 100
        assert tracker.get_used("bob") == 50
        assert tracker.get_global_used() == 350  # all three records contribute


class TestQuotaCheck:
    def test_check_quota_disabled_by_default(self, monkeypatch):
        from codekavi import settings as settings_module

        monkeypatch.setattr(settings_module.settings, "enforce_token_quota", False)
        monkeypatch.setattr(settings_module.settings, "daily_user_token_quota", 100)
        tracker = _fresh_tracker()
        tracker.record(user_id="alice", provider="groq", tokens=10_000)
        assert tracker.check_quota("alice") is True

    def test_check_quota_enforced_raises_on_overage(self, monkeypatch):
        from codekavi import settings as settings_module

        monkeypatch.setattr(settings_module.settings, "enforce_token_quota", True)
        monkeypatch.setattr(settings_module.settings, "daily_user_token_quota", 1000)
        tracker = _fresh_tracker()
        tracker.record(user_id="alice", provider="groq", tokens=999)
        assert tracker.check_quota("alice") is True
        tracker.record(user_id="alice", provider="groq", tokens=2)
        assert tracker.check_quota("alice") is False

    def test_get_remaining_decreases_with_usage(self, monkeypatch):
        from codekavi import settings as settings_module

        monkeypatch.setattr(settings_module.settings, "daily_user_token_quota", 1000)
        tracker = _fresh_tracker()
        assert tracker.get_remaining("alice") == 1000
        tracker.record(user_id="alice", provider="groq", tokens=300)
        assert tracker.get_remaining("alice") == 700

    def test_get_remaining_cannot_go_below_zero(self, monkeypatch):
        from codekavi import settings as settings_module

        monkeypatch.setattr(settings_module.settings, "daily_user_token_quota", 100)
        tracker = _fresh_tracker()
        tracker.record(user_id="alice", provider="groq", tokens=500)
        assert tracker.get_remaining("alice") == 0


class TestSingleton:
    def test_get_token_tracker_returns_singleton(self):
        a = get_token_tracker()
        b = get_token_tracker()
        assert a is b
