# CodeKAVI — Remediation Plan

Concrete, prioritized fixes for every finding in `review.md`. Ordered so you can work top-down;
each item has **effort**, the **exact change**, and a **verify** step. Sprint boundaries are
suggestions, not law.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low

> **Status audit (verified against the repo on 2026-07-24, after the colleague's merge `12ae31a`).**
> Markers: ✅ DONE · ⚠️ PARTIAL · ❌ NOT DONE.
> **Bottom line:** the recent work was almost entirely the *visualization rework* plus new per-user
> quota gating on the visualize/explain LLM endpoints (the `M-22` comments) — **none of the review's
> Sprint 0/1 items are fixed.** Two findings are *partially* addressed as a side effect.

---

## Sprint 0 — Stop the bleeding (do today, < 1 day)

### 🔴 IMPL-1 — Add `.dockerignore` and rotate leaked secrets — ❌ NOT DONE
> Verified: no `backend/.dockerignore` and no `frontend/.dockerignore` exist. `backend/.env` is still
> present on disk and would be copied by `COPY . .`.
**Files:** new `backend/.dockerignore`, new `frontend/.dockerignore`
**Why:** `COPY . .` currently bakes `backend/.env` (real keys), `cloned_repos/`, and caches into image layers.

`backend/.dockerignore`:
```gitignore
.env
.env.*
!.env.example
cloned_repos/
output/
.codekavi-fingerprints/
.mypy_cache/
.ruff_cache/
.pytest_cache/
__pycache__/
tests/
*.pyc
.git/
```
`frontend/.dockerignore`:
```gitignore
node_modules/
.next/
.env
.env.*
!.env.example
.git/
```
**Then:** rotate **every** key that has ever been built into a pushed image
(GROQ, GEMINI, CLOUDFLARE, ZILLIZ, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET).
**Verify:** `docker build -t codekavi-backend backend/ && docker run --rm codekavi-backend sh -c 'ls -la /app/.env || echo NO_ENV'` → must print `NO_ENV`.

### 🔴 IMPL-2 — Run the container as non-root — ❌ NOT DONE
> Verified: `backend/Dockerfile` runner stage still has no `useradd`/`USER` directive and still uses
> `COPY . .`. Process runs as uid 0.
**File:** `backend/Dockerfile` (runner stage)
```dockerfile
FROM python:3.12-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --chown=appuser:appuser . .
RUN mkdir -p /app/cloned_repos /app/output/reports && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```
**Verify:** `docker run --rm codekavi-backend id -u` → `10001`.

---

## Sprint 1 — Credibility & Correctness (2–4 days)

### 🔴 IMPL-3 — Restore the test suite and make CI honest — ❌ NOT DONE
> Verified: `backend/tests/` contains only `fixtures/` and `__pycache__/` (stale `.pyc` files for the
> old suite) — no `test_*.py` on disk. `.github/workflows/ci.yml` still runs bare `pytest` with no
> collected-count guard, so CI is red (exit 5) or ignored. Note: a lone `backend/codekavi/test_path_aliases.py`
> exists but sits outside `tests/` and isn't a substitute for the suite.
**Files:** `backend/tests/`, `.github/workflows/ci.yml`
1. Recover the deleted suite (git history / local machine): the `.pytest_cache/nodeids` lists the
   modules — `test_analyzer.py`, `test_api.py`, `test_cache.py`, `test_classifier.py`, plus quota/normalizer/tour.
2. If unrecoverable, write at minimum these high-value tests first:
   - `test_repo_source.py` — SSRF allow/deny matrix (ext::, file://, ports, creds, traversal).
   - `test_auth.py` — algorithm-confusion rejection, expired/aud-mismatch tokens.
   - `test_vectorstore_ranking.py` — asserts COSINE ordering is descending (guards IMPL-6).
   - `test_cache.py` — L1/L2/L3 read-through + graceful degradation.
   - `test_api.py` — auth required on every protected route; IDOR denial (guards IMPL-5).
3. Make CI fail if **no** tests are collected:
```yaml
      - name: Run Pytest Test Suite
        run: |
          cd backend
          pytest --strict-markers -p no:cacheprovider
          # Guard: fail if the suite ever silently empties again
          test "$(pytest --co -q 2>/dev/null | grep -c '::')" -gt 0
```
**Verify:** CI goes green *with* collected tests; deleting a test file and pushing turns it red.

### 🟠 IMPL-4 — Fix inverted RAG ranking — ✅ DONE
> `vectorstore.py:352` now sorts `all_hits.sort(key=lambda x: x["score"], reverse=True)`, comment
> corrected, and `codekavi/test_vectorstore_ranking.py` asserts descending order (fails on the old
> ascending sort, verified).
**File:** `vectorstore.py:349-363`
```python
# Milvus/Zilliz COSINE: hit.distance IS cosine similarity — HIGHER is more similar.
all_hits.sort(key=lambda x: x["score"], reverse=True)
```
Update the comment accordingly. Add the ranking unit test from IMPL-3.
**Verify:** `test_vectorstore_ranking` passes; manual chat query returns on-topic chunks as Context 1.

### 🟠 IMPL-5 — Close the IDOR — ✅ DONE
> `owner_user_id` is now stamped on every freshly-written result (`routes/analyze.py` both the
> sync and SSE pipelines, and `session.py`'s background re-analyze path) and checked via
> `assert_repo_owner` in `ensure_repo_loaded` (now takes `user_id`) plus explicitly in
> `DELETE /cleanup/{repo_id}`. Also closed a bypass in `chat.py`'s C4 fast-path, which read L1
> (`cache._memory`) directly keyed only by `repo_id` — shared across users — skipping the owner
> check entirely; it now calls `assert_repo_owner` before using the cached hit. All 7
> `ensure_repo_loaded` call sites (`analyze.py` x6, `chat.py`, `explain.py` x3, `visualize.py` x7
> via `_load_repo`) now thread `user_id` through. Legacy rows (no `owner_user_id` on record) stay
> public/read-only per Option A. Regression test: `codekavi/test_repo_ownership.py`.
**Files:** `cache.py`, `session.py`, `routes/*.py`
Pick one:
- **Option A (recommended, correct):** persist `owner_user_id` alongside each analysis
  (`analysis_cache` gets an `owner_user_id` column; store it in `result_data`). Add a helper:
```python
def assert_repo_owner(result: dict, user_id: str) -> None:
    owner = result.get("owner_user_id")
    # Legacy rows (owner is None) are treated as public/read-only; deny writes.
    if owner is not None and owner != user_id:
        raise HTTPException(status_code=404, detail="Repo not found.")  # 404 > 403: no existence oracle
```
  Call it in `get_graph`, `restore_repo`, `chat_repo`, `explain_*`, and **especially** `cleanup`.
- **Option B (accept public-artifact model):** document that analyses are public, then **remove
  destructive/enumerable reach**: drop user-facing `DELETE /cleanup/{repo_id}` (make it admin-only)
  and keep reads public. This is legitimate *if* stated explicitly.

**Verify:** `test_api.py::test_idor_denied` — user B gets 404 on user A's `repo_id` for cleanup.

### ✅ IMPL-6 — Thread `json_mode` through Groq async path — DONE
> `GroqProvider._generate_core` (providers.py:388) now accepts `json_mode` and sets
> `response_format` when true; `generate`/`generate_with_usage` (469, 492) forward it through.
> Matches the already-fixed `GeminiProvider` path.
**File:** `providers.py`
```python
async def _generate_core(self, system_prompt, user_prompt, temperature, max_tokens, json_mode=False):
    ...
    kwargs = dict(model=self.model_name, messages=messages,
                  temperature=temperature, max_tokens=max_tokens)
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await loop.run_in_executor(current_io_executor.get(None),
                                          lambda: self._client.chat.completions.create(**kwargs))
```
Forward `json_mode` from `generate()`/`generate_with_usage()`.
**Verify:** mindmap section parses JSON on first try in logs (no "JSONDecodeError" fallbacks).

---

## Sprint 2 — Resilience & Cost Safety (3–5 days)

### 🟠 IMPL-7 — Bound the in-memory caches — ✅ DONE
> `cache.py`'s `_memory` is now `TTLCache(maxsize=256, ttl=REDIS_TTL_SECONDS)`, `_sessions`/`_signatures`
> are `LRUCache`. `routes/chat.py`'s `_validated_repos` is `TTLCache(maxsize=2048, ttl=_VALIDATION_TTL)`,
> manual timestamp bookkeeping removed. `cachetools` added to `requirements.txt`. Regression test:
> `codekavi/test_cache.py::test_l1_memory_is_bounded`.
**Files:** `cache.py`, `routes/chat.py`
```python
from cachetools import TTLCache, LRUCache
# L1: cap entries and TTL them so they can't outgrow the process.
self._memory = TTLCache(maxsize=256, ttl=REDIS_TTL_SECONDS)
self._sessions = LRUCache(maxsize=1024)
self._signatures = LRUCache(maxsize=4096)
```
For `chat._validated_repos`, swap the bare dict for `TTLCache(maxsize=2048, ttl=_VALIDATION_TTL)`
and delete the manual timestamp bookkeeping.
**Note:** `TTLCache` isn't thread-safe for iteration; guard writes with the executor's single-thread
access pattern or a small lock. **Verify:** load-test 10k distinct repo_ids; RSS plateaus.

### 🟡 IMPL-8 — Rate limiting: fail-closed / degrade, not fail-open — ✅ DONE
> `limiter.py`'s `RateLimiter.__call__` now falls back to a per-process token bucket
> (`_local_buckets`, a bounded `TTLCache(maxsize=8192, ttl=60)`) when Redis is down, keyed by the
> same `user_or_ip_identifier` used for the Redis-backed path, raising 429 once the bucket fills.
> Bounded like the L1 cache from IMPL-7 so a flood of distinct IPs/users can't grow it unbounded.
> Regression test: `codekavi/test_limiter.py`.
**File:** `limiter.py`
When Redis is down, fall back to a per-process token bucket for expensive routes rather than "no
limit." Minimal version:
```python
from collections import defaultdict
import time
_local_buckets: dict[str, list[float]] = defaultdict(list)

class RateLimiter(_RateLimiter):
    async def __call__(self, request, response):
        if _enabled:
            return await super().__call__(request, response)
        # Degraded local limiter (per-process, best-effort)
        key = await user_or_ip_identifier(request)
        now = time.monotonic()
        window = [t for t in _local_buckets[key] if now - t < self.seconds]
        if len(window) >= self.times:
            from fastapi import HTTPException
            raise HTTPException(429, "Rate limit (degraded local limiter)")
        window.append(now); _local_buckets[key] = window
```
**Verify:** stop Redis; hammer `/analyze` → still 429s after N/min.

### 🟡 IMPL-9 — Trust X-Forwarded-For correctly — ✅ DONE
> `limiter.py` now has `_client_ip()`, which reads `chain[-trusted_proxy_hops]` instead of
> `chain[0]`, falling back to the first entry only if the chain is shorter than the configured
> trust depth. New `settings.trusted_proxy_hops` (env `TRUSTED_PROXY_HOPS`, default 1) controls
> the hop count. `user_or_ip_identifier` now delegates to it. Regression test:
> `codekavi/test_ip_trust.py`.
**File:** `limiter.py:44-46`
```python
TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "1"))
forwarded = request.headers.get("X-Forwarded-For")
if forwarded:
    chain = [ip.strip() for ip in forwarded.split(",")]
    ip = chain[-TRUSTED_PROXY_HOPS] if len(chain) >= TRUSTED_PROXY_HOPS else chain[0]
else:
    ip = request.client.host
```
**Verify:** spoofed `X-Forwarded-For` no longer resets the bucket.

### 🟡 IMPL-10 — Enforce token quota by default in prod — ✅ DONE
> `settings.py:78` now `enforce_token_quota: bool = Field(default=True, ...)`; set
> `ENFORCE_TOKEN_QUOTA=false` per-env to opt back out (e.g. while tuning cost model). Regression test:
> `codekavi/test_quota_enforcement.py` (default-True assertion + in-memory over/under-quota checks).
**File:** `settings.py:78` — flip `enforce_token_quota` default to `True` (or set it in the prod env).
Keep the soft-warning path for anonymous/free tiers if desired.
**Verify:** exceed `daily_user_token_quota` → 429 `quota_exceeded`.

### 🟡 IMPL-11 — Enforce repo caps *during* clone — ✅ DONE
> `cloner.py` now runs `git clone` via `Popen` inside `_clone_with_size_guard`, polling the
> clone directory's on-disk size every `CLONE_SIZE_POLL_INTERVAL_S` (0.5s) and killing the
> process the moment it exceeds `settings.repo_size_limit_bytes`, instead of waiting for the
> full clone to land before the post-walk check. The timeout kill (`CLONE_TIMEOUT_S`) moved
> into the same poll loop. The post-clone file-count/size walk stays as a final check.
> Regression test: `codekavi/test_cloner.py`.
**File:** `cloner.py`
Add a partial-clone guard before the full walk: `git clone --depth 1 --filter=blob:limit=1m` won't
bound total size, so instead run the size/count walk **incrementally with an early exit** (already
present) but also cap the clone with a disk-usage watchdog, or pre-check the repo via the provider
API (`GET /repos/{owner}/{repo}` returns `size`) and reject oversized repos *before* cloning.
**Verify:** point at a known-huge repo → rejected before full download (watch disk).

---

## Sprint 3 — Polish & Ops Hygiene (2–3 days)

### 🟡 IMPL-12 — Refuse (don't drop) on Zilliz schema drift — ✅ DONE
> Verified: the **dimension-mismatch** branch raises `VectorStoreError` and refuses to drop
> (`vectorstore.py:185-194`). The **missing-required-field** branch (`vectorstore.py:196-209`) now
> mirrors it — raises `VectorStoreError` naming the missing fields instead of calling
> `utility.drop_collection` and recreating. Regression test: `codekavi/test_vectorstore_schema_drift.py`
> (asserts `drop_collection` is never called).
**File:** `vectorstore.py:200-204` — replace `drop_collection` + recreate with a raised
`VectorStoreError` (mirror the dimension-mismatch branch). Provide a separate, deliberate
`migrate_collection()` admin script.

### ✅ IMPL-13 — De-duplicate the analyze pipeline — DONE
> `_run_pipeline` (analyze.py:82) returns a shared `PipelineResult`, consumed by both `analyze`
> and `analyze_stream`. `mermaid` is now unified as `{"file_level": str, "module_level": str}` on
> `PipelineResult`, and both routes assign their response field straight from
> `pipeline_result.mermaid` — no more shape drift. Contract test:
> `codekavi/test_analyze_pipeline_contract.py` asserts identical `graph`/`mermaid` for both routes.
**File:** `routes/analyze.py` — extract `async def _run_pipeline(clone_info, cache, ...) -> PipelineResult`
consumed by both `/analyze` and `/analyze/stream`; the routes differ only in emit strategy.
Also unify the `mermaid` response shape (B-3). **Verify:** both routes return identical `graph`/`mermaid`
structure for the same repo (add a contract test).

### ✅ IMPL-14 — Lockfile + vuln scan for deps — DONE
`backend/requirements.in` is the pinned source; `backend/requirements.txt` is the `uv pip compile`
lockfile (289 pinned transitive deps). LLM SDKs pinned (`google-genai==1.73.1`, `groq==0.25.0`,
`supabase==2.31.0`). `pip-audit` wired into `ci.yml` before lint. Initial audit surfaced real CVEs
in the pinned `fastapi`/`gitpython`/`python-dotenv`/`langchain-text-splitters`; bumped to
`fastapi==0.118.0`, `gitpython==3.1.57`, `python-dotenv==1.2.2`, `langchain-text-splitters==1.1.2`.
Re-audit is clean except 7 starlette findings only patched in starlette 1.x (would need fastapi>=0.135,
a much larger jump) — none are reachable here (grepped: no `StaticFiles`, `.form()`, `FileResponse`,
or Host-header trust in the codebase), so left as a documented residual with the upgrade path noted
in `requirements.in`.

### ✅ IMPL-15 — CORS: parse once — DONE
> `main.py:107` now `ALLOWED_ORIGINS = parsed_cors_origins()`, a shared helper in `settings.py`
> (trims and filters empties) instead of the bare unstripped `.split(",")`.
**File:** `main.py:106` — reuse the trimmed list already computed in `config.validate_config`
(export it), or `[o.strip() for o in settings.cors_origins.split(",") if o.strip()]`.

### ✅ IMPL-16 — Deep health check — DONE
`GET /api/health/deep` in `main.py`, rate-limited (`per_minute(6)`), pings Redis, Zilliz
(`collection_exists`), and Supabase; returns per-dependency status.

### ✅ IMPL-17 — Byte-safe chunk truncation — DONE
> `indexer.py:204-206` now encodes to UTF-8 first and truncates on the byte boundary
> (`encoded_chunk = chunk.encode("utf-8"); if len(encoded_chunk) > 65000: chunk =
> encoded_chunk[:65000].decode("utf-8", "ignore")`).
**File:** `indexer.py:204`
```python
enc = chunk.encode("utf-8")
if len(enc) > 65500:
    chunk = enc[:65500].decode("utf-8", "ignore")
```

### ✅ IMPL-18 — Docstring/lock cleanups — DONE (all four)
- ✅ `vectorstore.search` docstring now just "Embeds the query using Cloudflare, searches Zilliz..." (vectorstore.py:273) — stale Gemini line dropped.
- ✅ `CircuitBreaker.snapshot()` (providers.py:94) takes `self._lock` before reading `self._failures`; "lock-free" label removed.
- ✅ `ensure_repo_loaded`'s `HTTPException(status_code=202, ...)` (session.py:158) kept as-is (zero behavior change per spec) but now has a comment explaining it's a control-flow short-circuit, not an error.
- ✅ `.gitlab-ci.yml` removed; only `.github/workflows/ci.yml` remains.

### ✅ IMPL-19 — Output guardrail for LLM — DONE
`UNTRUSTED_CODE_DISCLAIMER` added in `llm/prompts.py` and wired into every system prompt that
feeds cloned repo content to the LLM: `SYSTEM_CODE_ANALYST`, `SYSTEM_ARCHITECTURE_ANALYST`
(`llm/prompts.py`), `ExplanationOrchestrator._SYSTEM_PROMPT` (`orchestrator.py`), and the inline
chat system prompt right before the retrieved-context block (`routes/chat.py`). Regression:
`test_prompt_guardrail.py`. Post-filtering of injection artifacts left as optional polish, not
implemented.

---

## Suggested Definition of Done

- [ ] `docker run ... ls /app/.env` prints `NO_ENV`; keys rotated.
- [ ] Container runs as uid 10001.
- [ ] `pytest` collects > 0 tests; CI red when the suite empties.
- [ ] RAG ranking test asserts descending COSINE; chat returns relevant Context 1.
- [ ] IDOR test: cross-user `cleanup`/read denied.
- [ ] RSS flat under 10k-repo load test (bounded caches).
- [ ] Rate limits still enforced with Redis down.
- [ ] `pip-audit` clean; LLM SDKs pinned.

---

## Effort Rollup

| Sprint | Theme | Items | Rough effort |
|--------|-------|-------|--------------|
| 0 | Stop the bleeding | IMPL 1–2 | < 1 day |
| 1 | Credibility & correctness | IMPL 3–6 | 2–4 days |
| 2 | Resilience & cost | IMPL 7–11 | 3–5 days |
| 3 | Polish & ops | IMPL 12–19 | 2–3 days |

Do Sprint 0 and IMPL-3/4/5 before showing this to anyone senior — they neutralize all four
"embarrassing weaknesses" in `review.md §4`.
