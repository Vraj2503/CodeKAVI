# Sprint 6 — Implementation Plan for Outstanding Issues

> Scope: resolve every finding from `Issues.md`, `Sprint2.md`, and `sprint_4_5_comparison.md`
> that is **still open, only partially addressed, or done incorrectly** on the `sprints` branch.
>
> Method: every finding below was **re-verified against the current code on `sprints`** (not
> trusted from the audit's point-in-time status). The audit was written against `neural-network`;
> a large amount has since been fixed. This plan lists **only what is genuinely left**.

---

## 0. Verification Summary — what is already resolved (do NOT re-do)

Re-reading the code on `sprints` confirms the following are **fully fixed** and need no work:

| Area | Findings resolved | Evidence in code |
|------|-------------------|------------------|
| Reliability criticals | C-01, C-02, C-03, C-04, C-05 | `analyze.py:33` (real `cleanup_repo`), no `graph_data` refs in `orchestrator.py`, `indexer.py:214` (error on 0 chunks), `cloner.py:82` (subprocess `timeout=` on all OSes), `vectorstore.py:108-126` (`_vector_field_dim`, no blind drop, distributed lock) |
| Auth | C-06, H-04 | `auth.py:17,44,52-53` (pinned `ALLOWED_ALGS`, `verify_aud=True`, module-level cached `PyJWKClient`) |
| Background/shutdown | H-02, H-05 | `task_registry.py` + `main.py:63` drain; `session.py:22,143` re-analysis lock |
| Quota (chat) | H-03 | `chat.py:259-262` records real tokens |
| Cache pre-warm (routes) | H-01, H-06, M-09 | `analyze.py:238,251,623` use `content_cache[k]=v`; `_origin_repo_id` persisted `analyze.py:379,788`; `content_cache.clear()` in `finally` |
| Tree-sitter | H-07, H-08, H-10, H-11 | `analyzer.py:341-354` containment check, `:289-318` dict+list capture handling, `:58-77` thread-local parser/query pool |
| Perf/session | H-09, H-12, H-13, H-14 | `cloner.py:24` 24h TTL; shared `aiohttp` session `embedding.py:34-56`; `_RETRY_DELAYS` sized to loop `providers.py:37-38`; traverser byte-budget `traverser.py:154` |
| Rate limiting | H-15, M-06 | custom Redis `RateLimiter` dependency keyed by user-or-IP (`limiter.py:40,84`), off slowapi decorators |
| Secret in tree | H-16 | `client_secret*.json` no longer present in the working tree |
| Quota accounting | M-05, M-07, M-13, M-20 | per-provider USD sum `quota.py:184-199`; `validate_providers` gated `providers.py:809`; async retries; breaker checked before socket `providers.py:306` |
| Persistence | M-12 | `cache.py:276-278` raw httpx write, no re-parse |
| Analyzer correctness | M-03 | `_strip_go_comments` `analyzer.py:383` |
| Sprint 4.1 / 4.7 | mostly done | `raw_imports` reuse avoids double parse (`fingerprint.py:525,548` → `analyzer.py:267`); `chat.py:29,120` validated-repo TTL skip |

**Bottom line:** all 6 CRITICAL and all 16 HIGH findings are resolved. The outstanding work is a
focused set of MEDIUM/LOW items plus two security/correctness gaps that slipped through. It is
roughly **1–2 days of engineering**, not weeks.

---

## 1. Priority tiers

| Tier | Findings | Theme | Effort |
|------|----------|-------|--------|
| 🔴 P0 | M-11, M-24, M-25, L-15↑ | Security / silent-corruption still live | ~3 h |
| 🟠 P1 | M-22 + L-13, M-23, M-14, M-16 | Billing bypass, RAG integrity, path defense-in-depth | ~4 h |
| 🟡 P2 | M-10, M-21, M-18, M-02, L-14, L-11, L-12, L-05, L-06 | Robustness / correctness cleanups | ~4 h |
| ⚪ P3 | L-04, L-08, L-01, L-02, L-03, L-07, L-09, L-10, Sprint-5.3 dup fields, utils dup line | Cosmetic / hygiene | ~2 h |

Group the fixes into the PRs in §6 to avoid merge conflicts (several share a file).

---

## 2. 🔴 P0 — Security & silent corruption (do first)

### P0.1 — M-11: Raw exception text leaked to unauthenticated callers
**State:** OPEN. Confirmed at `analyze.py:95,161,869,908`, `chat.py:276`, `explain.py:98,223,238,276`,
`visualize.py:444`. Each returns `detail=f"...: {e}"` / `detail=str(e)`, leaking stack context,
library versions, and absolute file paths.

**Fix:** return a generic client message; log the full exception server-side with the request id.
Introduce one helper and use it everywhere.

```python
# codekavi/routes/_errors.py  (new)
import logging
from fastapi import HTTPException
logger = logging.getLogger(__name__)

def internal_error(exc: Exception, *, context: str, status: int = 500) -> HTTPException:
    logger.error("%s: %s", context, exc, exc_info=True)   # full detail stays server-side
    return HTTPException(status_code=status, detail="Internal server error.")
```

Then replace each site, e.g. in `analyze.py`:
```python
except Exception as e:
    raise internal_error(e, context="clone failed") from e
```
Keep *validation* errors (400 with `str(e)` from a `ValueError` we raised ourselves) as-is — those
are safe, deliberate messages. Only scrub the `500`/unexpected paths.

**Test:** trigger a forced failure on each route with an invalid/oversized repo; assert the JSON
`detail` is exactly `"Internal server error."` and the traceback appears only in server logs.

---

### P0.2 — M-24: `.env` files ingested into analysis & vector index
**State:** OPEN. `config.py:201-202` still map `.env` / `.env.example` in `FILENAME_LANGUAGE_MAP`.
The traverser's dotfile skip (`traverser.py:42`) explicitly exempts anything in that map, so a
committed `.env` is read into `FileEntry.content` → flows into prompts and embeddings. (`.env` at
`config.py:21` is in `IGNORED_DIRS` only, which prunes a *directory* named `.env`, not the file.)

**Fix:**
1. Remove `".env"` and `".env.example"` from `FILENAME_LANGUAGE_MAP`.
2. Add an explicit secret-file denylist checked **before content is read**, in
   `traverser._get_skip_reason()`:
```python
SECRET_FILENAMES = {".env", ".env.local", ".env.production", ".env.development",
                    ".env.example", "id_rsa", "id_dsa", ".pem", ".pfx"}
SECRET_SUFFIXES = (".pem", ".key", ".pfx", ".p12")
...
if basename in SECRET_FILENAMES or basename.startswith(".env") or basename.endswith(SECRET_SUFFIXES):
    return "secret_file"
```
   Put this check ahead of the `FILENAME_LANGUAGE_MAP` exemption.

**Test:** analyze a repo containing `.env` with a fake secret; assert the value never appears in
any `FileEntry.content`, the `selected_files` set, or an indexed chunk.

---

### P0.3 — M-25: Re-analysis pre-warm stores raw strings → reads return one character
**State:** OPEN in `session.py:92-94` (the route handlers were fixed, this background path was
missed):
```python
content_cache = BoundedContentCache(settings.max_content_cache_bytes)
for k, v in content_cache_dict.items():
    content_cache.cache[k] = v                       # ← raw str, bypasses __setitem__
    content_cache.current_bytes += len(v.encode("utf-8"))
```
`BoundedContentCache.__getitem__` returns `self.cache[key][0]` (expects a `(value, bytes)` tuple),
so every pre-warmed key resolves to the **first character** of the file. Any repo restored via the
`/chat` or `/graph` re-analysis path (`ensure_repo_loaded` → `_bg_reanalyze`) is silently analyzed
on 1-char file contents.

**Fix:** use the public setter (identical to the route fix):
```python
content_cache = BoundedContentCache(settings.max_content_cache_bytes)
for k, v in content_cache_dict.items():
    content_cache[k] = v          # __setitem__ stores the tuple + updates current_bytes + evicts
```

**Test:** delete a repo's L1/L2 cache but leave the clone on disk; hit `/chat/{repo_id}`; after
re-analysis assert `file_profiles` roles match a fresh `/analyze` (not the degraded single-char
result). Add a unit test: pre-warm a key via the loop, read it back, assert full content.

---

### P0.4 — L-15 (elevated to P0): Cloudflare embedding creds not validated → silent empty RAG
**State:** OPEN and now **material**. Embeddings switched to Cloudflare as the primary provider
(`indexer.py:49` `CloudflareEmbedding()`), but `settings.validate_config()` (`settings.py:103-112`)
never requires `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`. If they're unset, indexing logs a
`warning` and returns `False` (`indexer.py:50-52`) — the repo is marked "analyzed" while its vector
index is empty, so every chat/RAG query returns nothing. This is the exact "silent success" class
the audit flagged.

**Fix:**
1. Add both Cloudflare vars to the `required` list in `validate_config()` (they gate the core RAG
   feature, so treat them like the other required credentials).
2. Defense-in-depth: in `analyze.py`, the background index is gated on
   `settings.gemini_api_key and settings.zilliz_uri` (`analyze.py:394`, `:798`). Change the gate to
   the credentials that indexing actually uses (`cloudflare_account_id and cloudflare_api_token and
   zilliz_uri`) so we don't schedule an index task that is guaranteed to no-op.

**Test:** start with `CLOUDFLARE_*` unset → assert startup fails fast with a clear message; set them
→ assert `/analyze` schedules indexing and a subsequent `/chat` returns non-empty sources.

---

## 3. 🟠 P1 — Billing bypass & RAG integrity

### P1.1 — M-22 + L-13: Visualization endpoints bypass per-user quota + fake token count
**State:** OPEN. `visualize_mindmap` (`visualize.py:291`, `use_llm=true` branch) and
`explain_visualization` (`visualize.py:385`) authenticate the user but never call
`tracker.check_quota(user_id)`, call `provider.generate(...)` without a `user_id` (so usage records
as `user_id=None`), and `explain_visualization` returns a fabricated
`"tokens_used": len(response.split()) * 2` (`visualize.py:440`). Per-user quota is fully bypassable
through these two routes. Fix together (they are coupled — see `Sprint2.md` note).

**Fix:**
1. At the top of each LLM branch:
```python
from codekavi.quota import get_token_tracker
tracker = get_token_tracker()
if not tracker.check_quota(user_id):
    raise HTTPException(429, detail={"error": "quota_exceeded", ...})   # mirror chat.py:88
```
2. Thread `user_id=user_id` into `provider.generate(...)` so `_record_usage` attributes correctly
   (confirm `generate()` accepts/records `user_id`; `providers.py` `_record_usage` already supports
   it — `chat.py` uses the `complete()` path, so wire the same for `generate()`).
3. Record real usage after the call and return the provider's actual token count instead of the
   word-count heuristic:
```python
tokens = getattr(response, "usage", {}).get("total_tokens", 0)   # from provider response
tracker.record(user_id, provider=provider.name, tokens=tokens)
return {"explanation": text, "tokens_used": tokens, "model": provider.name}
```
   (If `provider.generate()` currently returns a bare string, extend it to return usage alongside
   the text, or fetch usage from the provider's last-response accounting.)

**Test:** drive one user over quota via `/visualize/mindmap?use_llm=true`; assert the next call is
`429` and the recorded usage is attributed to that user (not `None`); assert `tokens_used` equals
the provider's reported count.

---

### P1.2 — M-23: Embedding count never validated against chunk count → misaligned RAG
**State:** OPEN. `indexer.py:82-109`: `flush_batch()` embeds `current_batch_texts`, then builds
`insert_data` by positionally zipping `embeddings` with the metadata columns — with **no length
check**. If Cloudflare returns fewer/misordered vectors, chunks are stored against the wrong
embeddings and RAG cites the wrong source lines, silently.

**Fix:** assert alignment before insert; fail the batch loudly on mismatch.
```python
embeddings = await cf_client.embed_texts(current_batch_texts)
if len(embeddings) != batch_len:
    from codekavi.exceptions import IndexingError   # add if missing
    raise IndexingError(f"embedding count {len(embeddings)} != texts {batch_len} for {repo_id}")
```
Catch `IndexingError` in the surrounding `except` so it counts as *lost* (it already logs
`Lost {batch_len} chunks`), ensuring the end-of-run summary reports the loss instead of inserting
garbage.

**Test:** stub `cf_client.embed_texts` to return one fewer vector; assert the batch raises and is
counted as lost, and no misaligned row is inserted.

---

### P1.3 — M-14: Insert count incremented before the mutation is verified
**State:** PARTIAL. `indexer.py:110` does `total_chunks_inserted += batch_len` right after
`collection.insert(...)` returns without exception, but never checks the returned
`MutationResult`. A partial insert (fewer `primary_keys` than rows) still counts as fully inserted,
so the "N/N inserted" summary can lie.

**Fix:**
```python
mr = await asyncio.to_thread(collection.insert, insert_data)
verified = len(getattr(mr, "primary_keys", []) or [])   # rows Zilliz actually acked
inserted = verified or batch_len                        # fall back if SDK omits keys
total_chunks_inserted += inserted
if verified and verified != batch_len:
    logger.warning(f"Partial insert for {repo_id}: {verified}/{batch_len} rows persisted")
```
(Adjust to the pymilvus `MutationResult` shape actually returned by Zilliz; the intent is
"increment by the verified count, warn on shortfall.")

**Test:** stub `collection.insert` to return a `MutationResult` with fewer primary keys; assert the
summary reports the shortfall.

---

### P1.4 — M-16: Snippet path opened without repo-root containment
**State:** OPEN. `orchestrator.py:520` (`_extract_snippets`) and `:717` do
`abs_path = os.path.join(self.repo_path, match)` then open the file, with no check that the resolved
path stays under `self.repo_path`. Reachable only if the LLM emits a malicious backticked path, and
`_extract_snippets` already filters against the curated `selected_set` — so this is defense-in-depth,
but cheap to close and mirrors the `analyzer.py` containment already added for H-07.

**Fix:** add a shared guard and apply it before both `open()` calls:
```python
def _within_repo(self, candidate: str) -> bool:
    real_root = os.path.realpath(self.repo_path)
    try:
        return os.path.commonpath([os.path.realpath(candidate), real_root]) == real_root
    except ValueError:
        return False
...
abs_path = os.path.join(self.repo_path, match)
if not self._within_repo(abs_path):
    continue
```

**Test:** feed a synthetic LLM response containing `` `../../../../etc/passwd` `` and assert no read
occurs outside the clone.

---

## 4. 🟡 P2 — Robustness & correctness cleanups

### P2.1 — M-10: CORS wildcard + credentials
**State:** OPEN. `main.py:101-109`: `allow_origins=settings.cors_origins.split(",")` with
`allow_credentials=True`. If an operator sets `CORS_ORIGINS="*"`, the app advertises wildcard origin
to non-credentialed traffic (all read endpoints world-readable to any origin).
**Fix:** assert at config time that `"*"` is never combined with credentials; if wildcard is desired,
set `allow_credentials=False`. Add to `validate_config()`:
```python
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
if "*" in origins:
    raise ValueError("CORS_ORIGINS='*' is not allowed with credentialed CORS; list explicit origins.")
```

### P2.2 — M-21: Thread-pool sizes hardcoded
**State:** OPEN. `main.py:48-49` hardcodes `max_workers=32` / `8`. On a 1-core container the CPU pool
starves.
**Fix:** read from env with the current values as defaults:
```python
io_workers  = int(os.getenv("IO_EXECUTOR_WORKERS", "32"))
cpu_workers = int(os.getenv("CPU_EXECUTOR_WORKERS", str(min(8, (os.cpu_count() or 8)))))
```

### P2.3 — M-18: Vue/Svelte only first `<script>` block parsed
**State:** PARTIAL. `analyzer.py:218` uses `re.search` → matches only the first `<script>`; Vue 3
SFCs commonly ship both `<script>` and `<script setup>`, so imports in the second block are missed.
**Fix:** iterate all script blocks with `re.finditer(r"<script\b([^>]*)>(.*?)</script>", ...)`,
concatenate their bodies (choosing TS if any block declares `lang="ts"`), and parse once.

### P2.4 — M-02: Keras `call()` layer order falls back to sequential
**State:** OPEN (ML correctness). `nn_extractor` derives layer order from `forward()` only; Keras
models using `call()` fall back to declaration order, so ResNet-style graphs render as plain stacks.
**Fix:** detect and parse a `call(self, ...)` method the same way `forward()` is handled; when neither
is present, label the ordering "declaration-order (unverified)" rather than asserting a sequential
architecture. (Lower confidence — gate behind a test with a small Keras functional model.)

### P2.5 — L-14: Export stubs lack auth dependency
**State:** OPEN. `export.py:15,24` — `export_html` / `export_markdown` have no
`Depends(verify_supabase_token)`. Harmless while they're 501 stubs, but adds an auth hole the moment
a body lands.
**Fix:** add `user_id: str = Depends(verify_supabase_token)` and the rate-limit dependency to both
now.

### P2.6 — L-11: DOT escape order inverted
**State:** OPEN. `graph.py:285`: `s.replace('"', '\\"').replace("\\", "\\\\")` escapes the quote
first, so a literal `"` becomes `\\"` (escaped backslash + live quote) → malformed/injectable DOT.
**Fix:** `return s.replace("\\", "\\\\").replace('"', '\\"')`.

### P2.7 — L-12: Oversized top-ranked file silently dropped from context
**State:** OPEN. `file_selector.py:100-106` `continue`s past any file over the remaining budget with
no truncation fallback, so the single most-important file can be excluded while smaller files fill
the budget.
**Fix:** when the top-ranked file overflows and nothing is selected yet (or it's the highest
scorer), include a budget-sized head slice instead of skipping:
```python
if tokens_used + item["estimated_tokens"] > self.MAX_TOTAL_TOKENS:
    if not selected:                      # never leave the best file out entirely
        item = {**item, "truncated": True, "estimated_tokens": self.MAX_TOTAL_TOKENS}
        selected.append(item); break
    continue
```
(Downstream readers must honor a `truncated` flag by head-slicing the content to the budget.)

### P2.8 — L-05: `sections_completed` counted for failed sections
**State:** OPEN. `orchestrator.py:157` increments `self.sections_completed += 1` **before**
`task.result()` at `:161`; a section that raises still counts, so progress reports "8/8" when some
failed.
**Fix:** move the increment inside the `try` after `task.result()` succeeds, and track failures
separately:
```python
for task in done:
    name = task_to_name[task]
    try:
        result = task.result()
        self.sections_completed += 1
        done_count += 1
        yield {"type": "section", ...}
    except Exception as e:
        self.sections_failed = getattr(self, "sections_failed", 0) + 1
        yield {"type": "warning", ...}
```
(Apply the same to the timeout branch at `:136` — a timed-out section is a failure, not a
completion.)

### P2.9 — L-06: `cleanup_repo` swallows deletion failures
**State:** OPEN. `cloner.py:169` `shutil.rmtree(clone_path, ignore_errors=True)` → silent disk leak.
**Fix:** call with `ignore_errors=False`, catch, and `logger.warning` on failure so leaks are
observable (callers like `analyze.py:962` already handle a raised error gracefully).

---

## 5. ⚪ P3 — Cosmetic / hygiene (batch into one PR)

| ID | File:Line | Fix |
|----|-----------|-----|
| Sprint-5.3 dup fields | `fingerprint.py:117-122` | Delete the duplicated `content_hash`/`imports_hash`/`exports_hash`/`structure_hash`/`change_type`/`parse_error` re-declarations (kept only for the first block, lines 108-113). Cosmetic — Python tolerates it, but it's confusing. |
| utils dup line | `utils.py:44-45` | Remove the duplicated `self.max_bytes = max_bytes`. |
| L-04 | `chat.py:178` | Numbered-line `"{n} \| {line}"` prefix — leave as-is or switch to a space-padded gutter; cosmetic only. Confirm the frontend renderer isn't confused, else drop the pipe. |
| L-08 | `cache.py:308-313` | Distinguish Supabase *error* from *miss*: on an exception, log at `warning` with a distinct marker (already does) — optionally raise a `CacheLookupError` so callers can tell them apart. Low value; document the decision. |
| L-01 | `explain.py:241` | Add the `result.get("repo_name", ...)` fallback used at `:110` so the direct-use site doesn't rely on `rsplit` alone. |
| L-02 | `logging_config.py` | `RequestIDMiddleware` on `BaseHTTPMiddleware` can drop `request_id_ctx` across SSE chunks — migrate to pure ASGI middleware if SSE request-id continuity matters; otherwise document as accepted. |
| L-03 | `metrics.py:_ensure` | Wrap check-and-create in a `threading.Lock`; surface construction errors instead of swallowing. |
| L-07 | `orchestrator.py:696` | Remove the `_detect_layer` wrapper or document the indirection. |
| L-09 | `analyze.py:90` | Add a one-line comment documenting why `clone_repo` runs on the io executor. |
| L-10 | `requirements.txt` | Pin `pymilvus`, `langchain-text-splitters` to tested versions with an upgrade-date comment. |
| M-04 (verify) | `fingerprint.py` (JSON write) | Confirm the fingerprint file is written with `tempfile` + `os.replace` (atomic). If still a plain `open(...,"w")`, switch to write-temp-then-rename to survive concurrent processes. |
| M-01 (verify) | `fingerprint.py` `_python_structure_signature` | Confirm `ImportFrom` names are excluded from the *exports* signature so import-only edits don't churn the structure hash. If included, drop them. |

> M-01 and M-04 were not fully re-verified in this pass — check them before deciding whether they
> need a change; both are cheap if they do.

---

## 6. Suggested PR grouping (avoids conflicts on shared files)

1. **PR-A `security-hardening`** — P0.1 (M-11, new `_errors.py` + all routes), P0.2 (M-24), P2.1
   (M-10), P2.5 (L-14). *Touches every route file + config/traverser.*
2. **PR-B `rag-integrity`** — P0.4 (L-15), P1.2 (M-23), P1.3 (M-14). *All in `indexer.py` /
   `settings.py`.*
3. **PR-C `quota-visualize`** — P1.1 (M-22 + L-13). *`visualize.py` + `providers.generate` usage
   plumbing.*
4. **PR-D `cache-and-session`** — P0.3 (M-25), P3 utils dup line. *`session.py` / `utils.py`.*
5. **PR-E `analyzer-orchestrator`** — P1.4 (M-16), P2.3 (M-18), P2.8 (L-05), P2.4 (M-02).
6. **PR-F `hygiene`** — P2.2 (M-21), P2.6 (L-11), P2.7 (L-12), P2.9 (L-06), and the P3 table
   (fingerprint dup fields, requirements pins, metrics lock, etc.).

Land PR-A and PR-B first (security + silent-corruption), then the rest in any order.

---

## 7. Cross-cutting verification

After each PR, run the existing pipeline smoke test (the `pipeline-check` skill) against a small
public repo and confirm every stage reports success **and** that the vector index is non-empty
(guards against the L-15/M-23/M-14 "0/0" family). Add focused unit tests for:

- `BoundedContentCache` round-trip via the pre-warm loop (M-25).
- Secret-file skip in the traverser (M-24).
- Embedding-count mismatch raises (M-23).
- Quota decrement on `/visualize/*` (M-22).
- Scrubbed 500 detail on a forced route failure (M-11).

## 8. Operational note (not code)

H-16 (Google OAuth client secret) is no longer in the working tree. If that secret was ever live on
a developer machine or in a build image, **rotate it** in Google Cloud and load it from an injected
env/secret manager going forward — removal from disk does not undo prior exposure.
