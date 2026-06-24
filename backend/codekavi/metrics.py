"""
metrics.py — T4.3 Prometheus metrics & APM basics.

Defines Counters and Histograms for:
  - LLM call duration (per provider, per task)
  - Total tokens used (per provider, per direction)
  - Total LLM cost (per provider)
  - Analysis pipeline stage duration

The metrics are lazily-imported: ``prometheus_client`` is only required at
runtime when someone reads /metrics or scrapes them. Tests that don't
import this module never pay the dependency cost.

If prometheus_client is missing at import time, all ``inc()`` / ``observe()``
calls become no-ops — code paths stay functional.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

_prometheus_available: bool | None = None


def _import_prometheus() -> bool:
    """Lazily import prometheus_client; return True if available."""
    global _prometheus_available
    if _prometheus_available is not None:
        return _prometheus_available
    try:
        from prometheus_client import Counter, Histogram  # noqa: F401

        _prometheus_available = True
    except ImportError:
        _prometheus_available = False
        logger.debug("prometheus_client not installed — metrics module is a no-op")
    return _prometheus_available


# ─────────────────────────────────────────────────────────────────────
# Counters & Histograms — declared at module load but each requires the
# underlying lib. We declare inside functions so a missing dependency
# never crashes app startup.
# ─────────────────────────────────────────────────────────────────────

_metrics: dict[str, Any] = {}


def _ensure(name: str, factory) -> Any:
    """Return a cached metric by name, creating it via ``factory`` on first use."""
    if name in _metrics:
        return _metrics[name]
    metric = factory()
    _metrics[name] = metric
    return metric


def _build_llm_duration() -> Any:
    from prometheus_client import Histogram

    return Histogram(
        "llm_request_duration_seconds",
        "LLM call duration in seconds.",
        labelnames=("provider", "task", "outcome"),
        buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    )


def _build_llm_tokens_total() -> Any:
    from prometheus_client import Counter

    return Counter(
        "llm_tokens_total",
        "Total LLM tokens used.",
        labelnames=("provider", "direction"),
    )


def _build_llm_cost_usd() -> Any:
    from prometheus_client import Counter

    return Counter(
        "llm_cost_usd_total",
        "Total LLM cost in USD.",
        labelnames=("provider",),
    )


def _build_analysis_stage_duration() -> Any:
    from prometheus_client import Histogram

    return Histogram(
        "analysis_stage_duration_seconds",
        "Duration of each analysis pipeline stage.",
        labelnames=("stage", "outcome"),
        buckets=(0.05, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
    )


def _build_breaker_transitions() -> Any:
    from prometheus_client import Counter

    return Counter(
        "circuit_breaker_transitions_total",
        "Circuit breaker state transitions.",
        labelnames=("provider", "state"),
    )


def _build_quota_events() -> Any:
    from prometheus_client import Counter

    return Counter(
        "quota_events_total",
        "Quota gate outcomes.",
        labelnames=("outcome",),
    )


# ─────────────────────────────────────────────────────────────────────
# Public helpers — safe to call when prometheus_client is missing.
# ─────────────────────────────────────────────────────────────────────


@contextmanager
def llm_call_timer(provider: str, task: str = "chat"):
    """
    Context manager: time an LLM call and observe duration histogram.

    Yields: ``stats`` dict populated with seconds_elapsed / outcome / tokens / cost.
    Callers may set ``stats["tokens"]`` and ``stats["cost_usd"]`` inside the
    block; ``__exit__`` observes them on the counters.
    """
    stats: dict[str, Any] = {"outcome": "ok", "tokens": 0, "cost_usd": 0.0}
    if not _import_prometheus():
        yield stats
        return
    started = time.perf_counter()
    try:
        yield stats
    except BaseException:
        stats["outcome"] = "error"
        raise
    finally:
        elapsed = time.perf_counter() - started
        try:
            _ensure("llm_request_duration", _build_llm_duration).labels(
                provider=provider, task=task, outcome=stats["outcome"]
            ).observe(elapsed)
        except Exception as e:
            logger.debug(f"metric observe failed: {e}")
        if stats.get("tokens"):
            try:
                _ensure("llm_tokens_total", _build_llm_tokens_total).labels(
                    provider=provider, direction="total"
                ).inc(int(stats["tokens"]))
            except Exception as e:
                logger.debug(f"metric inc failed: {e}")
        if stats.get("cost_usd"):
            try:
                _ensure("llm_cost_usd_total", _build_llm_cost_usd).labels(
                    provider=provider
                ).inc(float(stats["cost_usd"]))
            except Exception as e:
                logger.debug(f"metric inc failed: {e}")


@contextmanager
def analysis_stage_timer(stage: str):
    """Time an analysis pipeline stage."""
    if not _import_prometheus():
        yield
        return
    started = time.perf_counter()
    outcome = "ok"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        elapsed = time.perf_counter() - started
        try:
            _ensure("analysis_stage_duration", _build_analysis_stage_duration).labels(
                stage=stage, outcome=outcome
            ).observe(elapsed)
        except Exception as e:
            logger.debug(f"stage metric observe failed: {e}")


def record_breaker_transition(provider: str, state: str) -> None:
    """Counter helper: each open/half_open/close transition increments."""
    if not _import_prometheus():
        return
    try:
        _ensure("circuit_breaker_transitions", _build_breaker_transitions).labels(
            provider=provider, state=state
        ).inc()
    except Exception as e:
        logger.debug(f"breaker metric inc failed: {e}")


def record_quota_event(outcome: str) -> None:
    """outcome in {allowed, blocked_user, blocked_global}."""
    if not _import_prometheus():
        return
    try:
        _ensure("quota_events", _build_quota_events).labels(outcome=outcome).inc()
    except Exception as e:
        logger.debug(f"quota metric inc failed: {e}")


def record_llm_usage(provider: str, tokens: int, cost_usd: float) -> None:
    """
    Direct counter increment — used when we already know the count (e.g. when
    reporting tokens AFTER a successful LLM call without re-timing it).
    """
    if not _import_prometheus():
        return
    if tokens:
        try:
            _ensure("llm_tokens_total", _build_llm_tokens_total).labels(
                provider=provider, direction="total"
            ).inc(int(tokens))
        except Exception as e:
            logger.debug(f"tokens metric inc failed: {e}")
    if cost_usd:
        try:
            _ensure("llm_cost_usd_total", _build_llm_cost_usd).labels(
                provider=provider
            ).inc(float(cost_usd))
        except Exception as e:
            logger.debug(f"cost metric inc failed: {e}")


def is_available() -> bool:
    """Return True when prometheus_client is importable."""
    return _import_prometheus()
