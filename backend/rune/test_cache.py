"""The L3 (Supabase) write must survive a slow uplink.

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
