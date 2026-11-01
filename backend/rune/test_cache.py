"""The L3 (Supabase) tier: writes that survive a slow uplink, and the commit
lookup that survives a restart.

The body is the whole analysis, often several MB. With a flat 10s timeout the
upload failed on a slow connection ("The write operation timed out"), so the
analysis and its index_status lived only in process memory.
"""

from typing import Any, ClassVar

import httpx

from rune.cache import AnalysisCache
from rune.settings import settings


class RecordingClient:
    instances: ClassVar[list["RecordingClient"]] = []

    def __init__(self, *, timeout: httpx.Timeout) -> None:
        self.timeout = timeout
        self.posted: list[str] = []
        RecordingClient.instances.append(self)

    def __enter__(self) -> "RecordingClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        pass

    def post(self, url: str, headers: dict[str, str], content: str) -> httpx.Response:
        self.posted.append(content)
        return httpx.Response(201, request=httpx.Request("POST", url))


def test_the_supabase_upload_allows_time_for_a_large_body_on_a_slow_link(monkeypatch):
    RecordingClient.instances = []
    monkeypatch.setattr(httpx, "Client", RecordingClient)
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    cache = AnalysisCache()
    monkeypatch.setattr(cache, "_get_supabase", lambda: object())

    cache._supabase_set_raw("abc123", '{"big": "analysis"}', "demo", "acme")

    (client,) = RecordingClient.instances
    assert client.posted, "nothing was uploaded"
    assert client.timeout.connect == 10.0  # an unreachable host still fails fast
    assert client.timeout.write is not None and client.timeout.write >= 60


class SignatureLookup:
    """A PostgREST query that records its filters and answers with ``rows``."""

    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.filters: dict[str, str] = {}
        self.ordered: tuple[str, bool] | None = None
        self.queries = 0

    def table(self, name: str) -> "SignatureLookup":
        self.queries += 1
        return self

    def select(self, columns: str) -> "SignatureLookup":
        return self

    def eq(self, column: str, value: str) -> "SignatureLookup":
        self.filters[column] = value
        return self

    def order(self, column: str, desc: bool = False) -> "SignatureLookup":
        self.ordered = (column, desc)
        return self

    def limit(self, n: int) -> "SignatureLookup":
        return self

    def execute(self) -> Any:
        return type("Response", (), {"data": self.rows})()


def test_a_commit_analyzed_before_a_restart_is_still_found(monkeypatch):
    # Without Redis the signature index lived only in memory, so after every
    # restart an unchanged commit was analyzed and embedded all over again.
    cache = AnalysisCache()
    cache._redis_available = False
    cache._supabase_available = False
    cache.set("aaaaaaaaaaaa", {"repo_name": "demo", "owner": "octo"})
    lookup = SignatureLookup([{"repo_id": "aaaaaaaaaaaa"}])
    monkeypatch.setattr(cache, "_get_supabase", lambda: lookup)

    found = cache.resolve_signature("octo/demo@abc123")

    assert found is not None and found[0] == "aaaaaaaaaaaa"
    # The cheap columns narrow it to this repo before the JSON is unpacked.
    assert lookup.filters == {"owner": "octo", "repo_name": "demo", "result_json->>repo_signature": "octo/demo@abc123"}
    assert lookup.ordered == ("updated_at", True)  # the newest analysis of that commit

    lookup.rows = []
    found_again = cache.resolve_signature("octo/demo@abc123")
    assert found_again is not None and found_again[0] == "aaaaaaaaaaaa"  # from memory now
    assert lookup.queries == 1


def test_a_signature_that_names_no_commit_is_never_looked_up(monkeypatch):
    cache = AnalysisCache()
    cache._redis_available = False
    lookup = SignatureLookup([{"repo_id": "aaaaaaaaaaaa"}])
    monkeypatch.setattr(cache, "_get_supabase", lambda: lookup)

    assert cache.resolve_signature("not-a-signature") is None
    assert lookup.queries == 0
