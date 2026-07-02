# CodeKAVI — Complete Performance & Architecture Fix Plan

> Master task list combining **11 systemic issues** (user-identified) + **25 audit-report issues** = **36 total items**, deduplicated and organized into 6 sprints by dependency order and impact.

---

## Source Mapping

| ID | Source | Original ID |
|----|--------|-------------|
| S1–S5 | User's 5 systemic issues | #1–#5 |
| S6–S11 | User's lower-impact table | #6–#11 |
| A1–A12 | Audit report Part A | A1–A12 |
| B1–B8 | Audit report Part B | B1–B8 |
| C1–C4 | Audit report Part C | C1–C4 |
| D1–D2 | Audit report Part D | D1–D2 |
| E1–E3 | Audit report Part E | E1–E3 |

### Deduplication Notes

The following items overlap and are merged:

| Merged Into | Absorbed Items | Reason |
|-------------|----------------|--------|
| S6 / A5 | Both describe the same 7-regex duplication between `classifier.py` and `analyzer.py` — merged as **Sprint 2, Task 4** |
| S9 / A8 | Both describe `_extract_snippets` re-reading files from disk — merged as **Sprint 2, Task 6** |
| S11 / A7 | Both describe `_build_graph_context` O(E) rebuild — merged as **Sprint 1, Task 7** |
| S8 / C2 | Both describe synchronous `save_analysis` — merged as **Sprint 1, Task 8** |

**Net unique tasks: 32**

---

## Sprint 1 — Critical Quick Wins (Day 1, ~2.5 hours)

> **Goal**: Eliminate the worst blocking bottlenecks. Expected gain: 60s → 8–12s for a 500-file repo.

---

### Task 1 · 🔴 Move `index_repository` to background task in `/analyze/stream` *(S1)*

| Field | Detail |
|-------|--------|
| **File** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) |
| **Line** | ~506 |
| **Time** | 5 min |
| **Gain** | 30s → 2s for medium repos |

**Problem**: The streaming endpoint runs `await _run_sync(index_repository, ...)` synchronously before yielding `complete`. For 200+ file repos that's 600–2000 chunks, each hitting the Gemini API in batches of 20, with exponential backoff (20s/40s/80s) on 429s.

**Fix**:
1. Remove the inline `await _run_sync(index_repository, ...)` call from the SSE generator.
2. Move it to a background task (the non-stream `/analyze` already does this correctly at line 214 with `background_tasks.add_task`).
3. Emit the `complete` SSE event immediately after graph+select finish.
4. Optionally: emit an `indexing_status: started` event so the frontend knows indexing is in progress, and let the frontend poll a `/analyze/{repo_id}/indexing-status` endpoint or subscribe via a separate SSE/Redis pub-sub channel.

**Verify**: Trigger `/analyze/stream` on a 200-file repo. The `complete` event should arrive in <5s. Indexing should continue in the background (check logs for `index_repository` completion).

---

### Task 2 · 🔴 Merge double traversal into single `os.walk` pass *(A1)*

| Field | Detail |
|-------|--------|
| **File** | [traverser.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/traverser.py) |
| **Lines** | 100, 103, 128, 220 |
| **Time** | 30 min |
| **Gain** | 40–60% traverser speedup, ~500 fewer `stat()` calls |

**Problem**: `traverse_repo()` calls `_build_tree()` (recursive `os.listdir` at line 100) AND `os.walk` (line 103) — two full directory tree traversals. Additionally, `_build_tree` calls `os.path.getsize()` on every file (line 220), and the flat loop calls `os.path.getsize()` again (line 128).

**Fix**:
1. Rewrite `traverse_repo()` to use a single `os.walk` pass that builds both the tree structure and the flat file list simultaneously.
2. Call `os.stat()` once per file and cache the result (size, mtime) for reuse by subsequent stages.
3. Return stat results alongside the file list so downstream consumers (fingerprint, analyzer) can skip redundant stat calls.

---

### Task 3 · 🔴 Pre-build known-files set to eliminate stat storms in resolvers *(A2)*

| Field | Detail |
|-------|--------|
| **File** | [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py) |
| **Lines** | 126–159 (`_resolve_python_module`), 258–290 (`_resolve_js_path`) |
| **Time** | 45 min |
| **Gain** | 2–5× analyzer speedup, eliminates ~25,000 syscalls on 500-file repos |

**Problem**: Each Python import tries `__init__.py` + `module.py` = 2+ `os.path.isfile` calls. Each JS/TS import tries exact match + 9 extensions + 9 index files = up to 19 `os.path.isfile` calls per import. For 500 files × 5 imports/file = 25,000+ filesystem syscalls.

**Fix**:
1. At the start of `analyze_dependencies`, build a `set` of all known normalized file paths from the `traverse_repo` output:
   ```python
   known_paths = {os.path.normpath(f["path"]) for f in file_list}
   ```
2. Modify `_resolve_python_module` and `_resolve_js_path` to check `candidate in known_paths` instead of `os.path.isfile(candidate)`.
3. Pass `known_paths` as a parameter to these functions.

---

### Task 4 · 🔴 Skip `compute_structure_signature` when `content_hash` unchanged *(S4)*

| Field | Detail |
|-------|--------|
| **File** | [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py) |
| **Line** | ~315 |
| **Time** | 10 min |
| **Gain** | Halves fingerprint cost on cache-hit paths |

**Problem**: `compare_and_classify_repo` runs `compute_structure_signature` (tree-sitter parse for JS/TS, AST parse for Python, full file read) for EVERY file on EVERY call — even when the file hasn't changed. Line 315 always runs the parser regardless of whether `content_hash` matches the previous fingerprint.

**Fix**:
1. At line 315, check `if prev_fingerprint.content_hash == current_content_hash: skip compute_structure_signature and reuse the previous `imports_hash`, `exports_hash`, `structure_hash`.
2. Only run `compute_structure_signature` for files where `content_hash` differs or no previous fingerprint exists.
3. Optionally: add a fast pre-check — compute a `tree_hash = MD5(sorted(path, content_hash) pairs)` and compare to the stored tree hash. If identical, skip the entire fingerprint comparison.

---

### Task 5 · 🟠 Add SSE heartbeat keepalive *(C1)*

| Field | Detail |
|-------|--------|
| **Files** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py), [explain.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/explain.py) |
| **Time** | 10 min |
| **Gain** | Prevents proxy timeouts on stages >30s |

**Problem**: Neither `/analyze/stream` nor `/explain/{repo_id}/stream` emit periodic heartbeats. Reverse proxies (Nginx, Cloudflare, Vercel) will timeout connections that produce no output for >30s.

**Fix**: Emit a `:keepalive\n\n` SSE comment every 15 seconds during long-running stages. Use `asyncio.create_task` with a loop that yields keepalives until the stage completes.

---

### Task 6 · 🟠 Wrap `cleanup_repo` in try/except *(E1)*

| Field | Detail |
|-------|--------|
| **File** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) |
| **Lines** | 376, 390, 444, 474, 504, 530, 564 |
| **Time** | 5 min |
| **Gain** | Prevents silent stream deaths |

**Problem**: `cleanup_repo()` is called on early disconnects inside the SSE generator. If it throws (permission error, file locked on Windows), the generator crashes silently — the client gets no error event.

**Fix**: Wrap every `cleanup_repo()` call in `try/except Exception` with a `logger.warning()`. Ensure the stream emits an `error` event before exiting if cleanup fails.

---

### Task 7 · 🟠 Remove redundant `_build_graph_context` *(S11 / A7)*

| Field | Detail |
|-------|--------|
| **File** | [orchestrator.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/orchestrator.py) |
| **Lines** | 683–711 |
| **Time** | 10 min |
| **Gain** | Removes O(E) work per explain call |

**Problem**: `_build_graph_context` iterates all edges to reconstruct a `complete_imports` dict — functionally identical to the `adjacency` dict already in `self.analysis`. Prompts that consume `complete_imports` already fall back to `adjacency`.

**Fix**: Remove `_build_graph_context()` entirely. Replace all references to `complete_imports` with `self.analysis["adjacency"]` in `_prompt_architecture`, `_prompt_dependencies`, and `_prompt_dataflow`.

---

### Task 8 · 🟠 Make L2/L3 cache writes async *(S8 / C2)*

| Field | Detail |
|-------|--------|
| **Files** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) (lines 210, 494, 559), [cache.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/cache.py) |
| **Time** | 15 min |
| **Gain** | 100–500ms off stream completion |

**Problem**: `save_analysis()` writes to L1 (memory, instant), L2 (Redis, network), and L3 (Supabase, network) synchronously before emitting the `complete` event. Supabase upsert alone can take 100–500ms.

**Fix**:
1. Write L1 synchronously (needed for immediate `/explain` calls).
2. Fire L2 (Redis) and L3 (Supabase) writes as `asyncio.create_task()` or `background_tasks.add_task()`.
3. Log any errors from the async writes rather than blocking the response.

---

## Sprint 2 — Medium Wins (Day 2, ~3.5 hours)

> **Goal**: Eliminate remaining duplicate work and redundant I/O. Expected gain: push cache-hit paths below 5s.

---

### Task 1 · 🔴 Add `use_tour=true` default on `/explain/{repo_id}/stream` *(S5)*

| Field | Detail |
|-------|--------|
| **Files** | [explain.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/explain.py), [tour_generator.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/tour_generator.py) |
| **Time** | 10 min |
| **Gain** | Instant return vs. 8 LLM calls (~50s) |

**Problem**: `explain_repo_stream` always spawns `ExplanationOrchestrator.run()` which fires 8 LLM calls in 3 serial batches (3+3+2) with 3s pauses between batches. The deterministic `tour_generator` is only used in the except branch (line 278). On the happy path, users wait ~50s.

**Fix**:
1. Add `use_tour: bool = True` parameter to `ExplainRequest` schema.
2. When `use_tour=True`, skip the orchestrator entirely and yield `generate_deterministic_tour()` directly — instant return with zero LLM cost.
3. Make this the default for first-page-load. Add a "Load AI Analysis" button in the frontend that triggers the endpoint with `use_tour=false`.
4. Alternative: emit deterministic tour sections immediately via `event: section`, then upgrade with LLM-generated content when it arrives.

---

### Task 2 · 🔴 Pass source text between pipeline stages, eliminate duplicate disk reads *(S3)*

| Field | Detail |
|-------|--------|
| **Files** | [traverser.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/traverser.py), [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py), [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py), [classifier.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/classifier.py), [indexer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/indexer.py), [orchestrator.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/orchestrator.py) |
| **Time** | 30 min |
| **Gain** | Removes 4+ disk reads per file (~40% of wall time on spinning disks) |

**Problem**: Each source file is opened from disk 5–8 times across different stages:
1. `traverse_repo` — size/metadata
2. `compute_file_hash` — head 8KB + tail 2KB
3. `compute_structure_signature` — full read
4. `analyze_dependencies` — full read (caches 4KB only)
5. `classify_files._content_signals` — reads 4KB if not cached
6. `index_repository` — full read again
7. `orchestrator._load_selected_file_contents` — reads selected files again
8. `orchestrator._extract_snippets` — re-reads snippet files

**Fix** (in order):
1. **`traverse_repo`**: For files under 100KB, read the full content during traversal and include it in the returned file dict as `"content"`.
2. **Create a shared `FileContentCache`**: A simple `dict[str, str]` (or LRU with 50MB cap) passed between stages. Populate it during traverse, reuse everywhere.
3. **`fingerprint.py`**: Accept optional `content: str` parameter in `compute_file_hash` and `compute_structure_signature`. Skip disk read if content is provided.
4. **`analyzer.py`**: Accept optional `content_cache: dict` parameter in `analyze_dependencies`. Use it instead of opening files. Also pass content from `_extract_imports_with_source` into fingerprint.
5. **`classifier.py`**: Accept and use the shared `content_cache` instead of the limited `BoundedContentCache` fallback.
6. **`orchestrator.py`**: Pass `self.file_contents` into `_extract_snippets` and look up there first before disk reads.

---

### Task 3 · 🔴 Remove synchronous re-analysis from `ensure_repo_loaded` *(A3)*

| Field | Detail |
|-------|--------|
| **File** | [session.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/session.py) |
| **Lines** | 63–72, 86–139 |
| **Time** | 30 min |
| **Gain** | Prevents 30–60s hangs on `/explain` and `/chat` |

**Problem**: When the L1→L2→L3 cache chain misses, `ensure_repo_loaded` runs the full pipeline (traverse + analyze + classify + build_module_graph) synchronously on the request thread. Worse, the re-clone fallback (lines 63–72) calls `clone_repo()` synchronously (network I/O).

**Fix**:
1. If all caches miss, return a `202 Accepted` with `{"status": "re-analyzing"}` instead of blocking.
2. Queue re-analysis as a background task.
3. Cache `clone_path` in Redis alongside the result so it survives restarts.
4. If `clone_path` is missing but analysis results exist, let the caller handle it gracefully (most explain sections don't need clone_path).

---

### Task 4 · 🟠 Pass content signals from analyzer to classifier *(S6 / A5)*

| Field | Detail |
|-------|--------|
| **Files** | [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py) (lines 742–761), [classifier.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/classifier.py) (lines 211–298) |
| **Time** | 30 min |
| **Gain** | Halves classification time |

**Problem**: Classifier's `_content_signals` runs 7 regex patterns per file looking for entry points (`if __name__`, `def main(`, `app.listen(`, etc.) — the exact same patterns already executed by `_detect_entry_points` in the analyzer (lines 742–761). This is pure duplication.

**Fix**:
1. Have `analyze_dependencies` return a `file_signals: dict[str, dict]` alongside `entry_points`, containing the per-file content signals already computed.
2. Pass `file_signals` into `classify_files`.
3. In `_content_signals`, check `file_signals` first and skip regex scanning for files that already have signals.

---

### Task 5 · 🟠 Serialize cache result once instead of 3 times *(A6)*

| Field | Detail |
|-------|--------|
| **File** | [cache.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/cache.py) |
| **Lines** | 154–165 |
| **Time** | 20 min |
| **Gain** | 30% cache-save speedup (avoids 6–15MB redundant serialization) |

**Problem**: `cache.set()` calls `_make_serializable()` (deep-copy with set→list), then `_redis_set` → `json.dumps()`, then `_supabase_set` which serializes again internally. For 500-file repos, the result is 2–5MB = 3× serialization of 2–5MB.

**Fix**:
```python
def set(self, repo_id, result):
    serializable = _make_serializable(result)
    self._memory[repo_id] = serializable
    json_str = json.dumps(serializable)  # serialize ONCE
    self._redis_set_raw(repo_id, json_str)     # pass pre-serialized string
    self._supabase_set_raw(repo_id, json_str)  # pass pre-serialized string
```
Add `_redis_set_raw` and `_supabase_set_raw` methods that accept a pre-serialized JSON string.

---

### Task 6 · 🟠 Pass `file_contents` into `_extract_snippets` *(S9 / A8)*

| Field | Detail |
|-------|--------|
| **File** | [orchestrator.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/orchestrator.py) |
| **Lines** | 459–500, 75 |
| **Time** | 15 min |
| **Gain** | Removes up to 40 disk reads per explain call |

**Problem**: `_extract_snippets()` regex-matches file paths in LLM responses and opens them from disk. The same files were already loaded by `_load_selected_file_contents()` at line 75.

**Fix**: Pass `self.file_contents` dict into `_extract_snippets`. Look up content in the dict first; only read from disk for files not in the dict.

---

### Task 7 · 🟠 Split thread pools for I/O vs CPU *(D1)*

| Field | Detail |
|-------|--------|
| **File** | [main.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/main.py) (line 47) |
| **Time** | 30 min |
| **Gain** | Prevents thread starvation under concurrent load |

**Problem**: A single `ThreadPoolExecutor(max_workers=16)` is shared across all blocking operations: cloning (git), traversing (filesystem), analyzing (parsing), classifying (regex), indexing (Gemini API), cache (Redis/Supabase), and vectorstore search (Zilliz). 3 concurrent indexing requests with 80s backoff = 3 threads blocked for 80s = only 13 threads left.

**Fix**:
1. Create separate pools:
   - `cpu_pool = ThreadPoolExecutor(max_workers=8)` — for parse, analyze, classify
   - `io_pool = ThreadPoolExecutor(max_workers=16)` — for clone, index, cache, vectorstore
   - `indexing_pool = ThreadPoolExecutor(max_workers=4)` — dedicated for Gemini API calls
2. Route each `_run_sync` call to the appropriate pool.

---

## Sprint 3 — Reliability & Edge Cases (Day 3, ~1.5 hours)

> **Goal**: Fix error handling, edge cases, and prevent cascade failures.

---

### Task 1 · 🟠 Fix fingerprint error handling *(E2)*

| Field | Detail |
|-------|--------|
| **File** | [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py) |
| **Time** | 15 min |

**Problem**: If `compute_structure_signature` fails for a file, it returns empty hashes. This causes the file to be classified as `STRUCTURAL` (since `prev.imports_hash != ""` fails), forcing a full re-analysis. A single parse failure → full re-analysis.

**Fix**: Distinguish "parse failed" from "no structure". If both old and new fingerprints have empty hashes (unsupported language or same parse failure), treat it as `NONE`/`COSMETIC` rather than `STRUCTURAL`. Add a `parse_error: bool` field to fingerprint results.

---

### Task 2 · 🟡 Add timeout to LLM calls in orchestrator *(E3)*

| Field | Detail |
|-------|--------|
| **File** | [orchestrator.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/orchestrator.py) |
| **Line** | ~131 |
| **Time** | 10 min |

**Problem**: `asyncio.wait` at line 131 has no timeout. A hanging LLM provider blocks the entire batch indefinitely.

**Fix**: Add `timeout=60` to the `asyncio.wait` call. Handle `asyncio.TimeoutError` by returning fallback/deterministic content for timed-out sections.

---

### Task 3 · 🟡 Convert `time.sleep` to `asyncio.sleep` in indexer *(A11)*

| Field | Detail |
|-------|--------|
| **File** | [indexer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/indexer.py) |
| **Lines** | 57, 92 |
| **Time** | 20 min |

**Problem**: `time.sleep(backoff)` in `_embed_with_retry` blocks a thread from the shared pool for 20–80s on 429. Multiple concurrent indexing requests cause thread starvation.

**Fix**: If indexing runs as a background task (after Sprint 1 Task 1), convert `_embed_with_retry` to async and use `asyncio.sleep()`. Or add a `threading.Event`-based cancellation so the caller can abort if the SSE client disconnects.

---

### Task 4 · 🟡 Fix `BoundedContentCache` re-encoding on eviction *(A4)*

| Field | Detail |
|-------|--------|
| **File** | [utils.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/utils.py) |
| **Lines** | 47–60, 76–79 |
| **Time** | 15 min |

**Problem**: Every `__setitem__` encodes value to UTF-8 to measure bytes, then eviction re-encodes each evicted value, and `pop()` also re-encodes.

**Fix**: Store `(value, byte_size)` tuples in the cache so byte size is computed once and never recalculated.

---

### Task 5 · 🟠 Add Supabase connection pooling *(D2)*

| Field | Detail |
|-------|--------|
| **File** | [cache.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/cache.py) |
| **Time** | 15 min |

**Problem**: The Supabase client creates a new HTTP connection per request. Under concurrent load, no TCP connection reuse.

**Fix**: Configure `httpx` connection pooling on the Supabase client, or use a shared `httpx.AsyncClient` with connection limits.

---

## Sprint 4 — Code Hygiene & Minor Optimizations (Day 4, ~1.5 hours)

> **Goal**: Remove duplication, clean up redundancies.

---

### Task 1 · 🔴 Eliminate double tree-sitter parse for JS/TS files *(S2)*

| Field | Detail |
|-------|--------|
| **Files** | [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py) (`_extract_js_ts_imports_with_source`), [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py) (`_js_ts_structure_signature`) |
| **Time** | 30 min |

**Problem**: Each JS/TS file is parsed with `Parser().parse()` once in the analyzer and again in fingerprint with a separate `Parser()` instance. For 500 JS/TS files = 1000 parses.

**Fix** (pick one):
1. **Cheapest**: Reuse the imports list from analyzer as the `imports_hash` source in fingerprint, instead of re-parsing. Pass `imports_data` from analyzer into fingerprint.
2. **Better**: Cache the AST tree at module level keyed by `(file_path, content_hash)`. Both analyzer and fingerprint query the same cache.
3. **Best**: Run fingerprinting after the analyzer (it doesn't gate analysis) and pass the already-parsed tree.

> [!NOTE]
> If Sprint 1 Task 4 (skip unchanged files) is implemented first, this becomes less critical since most files won't be re-parsed on cache-hit paths. But it still matters for first-analysis.

---

### Task 2 · 🟡 Consolidate `_detect_language` into single function *(A9)*

| Field | Detail |
|-------|--------|
| **Files** | [traverser.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/traverser.py) (line 18), [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py) (line 484), [indexer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/indexer.py) (line 103) |
| **Time** | 15 min |

**Problem**: Three independent `_detect_language` functions with slight variations.

**Fix**: Create a single canonical `detect_language()` in [config.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/config.py) and import it everywhere. Merge the `FILENAME_LANGUAGE_MAP` check (from traverser/analyzer versions) with the extension-only check (indexer version) into one function.

---

### Task 3 · 🟡 Remove redundant file filtering in `_build_tree` *(A10)*

| Field | Detail |
|-------|--------|
| **File** | [traverser.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/traverser.py) |
| **Lines** | 220, 239 |
| **Time** | 10 min |

**Problem**: In `_build_tree`, files pass through `_should_ignore_file()` (line 220), then remaining files are checked by `_skip_reason()` (line 239) — which performs the same checks. Each file is filtered twice.

**Fix**: Consolidate into a single filter function. If `_build_tree` is merged with the flat-list walk (Sprint 1 Task 2), this is automatically resolved.

---

### Task 4 · 🟡 Parallelize graph export calls *(A12)*

| Field | Detail |
|-------|--------|
| **File** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) |
| **Lines** | 510–514 |
| **Time** | 15 min |

**Problem**: `export_graph_json`, `export_mermaid`, `build_module_graph`, and `detect_cycles` are called sequentially. Only `export_mermaid` depends on `export_graph_json`; the other two are independent.

**Fix**: Run `detect_cycles` and `build_module_graph` in parallel with `export_graph_json + export_mermaid` using `asyncio.gather` or concurrent futures.

---

### Task 5 · 🟡 Pre-compute degree lists lazily in classifier *(S7)*

| Field | Detail |
|-------|--------|
| **File** | [classifier.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/classifier.py) |
| **Line** | 339 |
| **Time** | 10 min |

**Problem**: `all_in_degrees` / `all_out_degrees` lists are pre-built for ALL files before classification starts, even though only a fraction may be needed.

**Fix**: Compute degree lists lazily or on-demand per file during classification. Or compute once but only for files that pass earlier filters.

---

### Task 6 · 🟡 Add ETag/If-None-Match to `/restore/{repo_id}` *(C3)*

| Field | Detail |
|-------|--------|
| **File** | [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) |
| **Time** | 20 min |

**Problem**: The restore endpoint returns the full 2–5MB JSON every time. Navigate away and back = full re-fetch.

**Fix**: Add ETag header (hash of `repo_id` + cache timestamp). Support `If-None-Match` header → return 304 Not Modified.

---

### Task 7 · 🟡 Skip `ensure_repo_loaded` on subsequent chat messages *(C4)*

| Field | Detail |
|-------|--------|
| **File** | [chat.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/chat.py) |
| **Lines** | 111–117 |
| **Time** | 10 min |

**Problem**: `ensure_repo_loaded()` runs on every chat message. 10 messages = 10 cache lookups (L2/L3 can add 50ms each).

**Fix**: After first successful validation in a chat session, skip `ensure_repo_loaded` for subsequent messages with the same `repo_id`. Use an in-memory set of recently-validated repo_ids with a short TTL (e.g., 5 minutes).

---

### Task 8 · 🟡 Cache serializer work in AnalyzeCache *(S10)*

| Field | Detail |
|-------|--------|
| **File** | [cache.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/cache.py) |
| **Time** | 10 min |

**Problem**: `cache.write` duplicates serializer work that `cache.set` already performs.

**Fix**: Ensure `cache.write` delegates to `cache.set` (or shares the same serialization path) instead of re-serializing independently.

---

## Sprint 5 — Architecture Refactoring (~8 hours)

> **Goal**: Establish typed contracts, enable incremental analysis, and enrich fingerprints.

---

### Task 1 · 🔴 Define typed dataclasses for pipeline stages *(B1)*

| Field | Detail |
|-------|--------|
| **Files** | [schemas.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/schemas.py) (or new `models.py`), all pipeline files |
| **Time** | 2 hr |

**Problem**: CodeKAVI passes raw dicts through every stage — `dep_data`, `file_profiles`, `repo_data`, `graph_json` — with no type contracts. Runtime `KeyError` bugs are possible, stages are tightly coupled to output shapes.

**Fix**: Define Pydantic models (or `@dataclass`):
```python
class RepoData:       # output of traverse_repo
class FileEntry:      # individual file in RepoData
class DepGraph:       # output of analyze_dependencies
class FileProfile:    # output of classify_files
class AnalysisResult: # combined result stored in cache
```
Update each pipeline stage to return typed objects. Add validation at stage boundaries.

---

### Task 2 · 🔴 Implement partial/incremental analysis *(B2)*

| Field | Detail |
|-------|--------|
| **Files** | [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py), [analyze.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/routes/analyze.py) |
| **Time** | 4 hr |

**Problem**: CodeKAVI's fingerprint system computes `has_structural` as a single boolean — it's either full-analyze or skip. No partial update path. UA has a 4-tier decision matrix (SKIP → PARTIAL_UPDATE → ARCHITECTURE_UPDATE → FULL_UPDATE).

**Fix**:
1. Implement a `ChangeClassification` enum: `SKIP`, `PARTIAL_UPDATE`, `ARCHITECTURE_UPDATE`, `FULL_UPDATE`.
2. Decision logic:
   - **SKIP**: No structural changes detected.
   - **PARTIAL_UPDATE**: <10 files changed structurally → re-analyze only those files and merge into cached result.
   - **ARCHITECTURE_UPDATE**: >10 structural files or new directories → re-analyze + re-run architecture.
   - **FULL_UPDATE**: >30 structural files or >50% changed → full rebuild.
3. For `PARTIAL_UPDATE`:
   - Run `analyze_dependencies` only for changed files.
   - Merge new edges into existing `adjacency` dict (remove old edges for changed files, add new ones).
   - Re-run `classify_files` only for changed files and their 1-hop neighbors.
4. Store `git commit hash` in fingerprints so `git diff --name-only` can be used for faster change detection.

---

### Task 3 · 🟠 Enrich fingerprint storage with structural detail *(B3)*

| Field | Detail |
|-------|--------|
| **File** | [fingerprint.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/fingerprint.py) |
| **Time** | 2 hr |

**Problem**: `FileFingerprint` stores only 3 hashes. Can't tell WHAT changed structurally, can't do partial re-analysis by function, COSMETIC detection is coarser than needed.

**Fix**: Extend `FileFingerprint` to store:
```python
@dataclass
class FileFingerprint:
    content_hash: str
    imports_hash: str
    exports_hash: str
    structure_hash: str
    # NEW:
    functions: list[FunctionFingerprint]   # name, params, return_type, exported, line_count
    classes: list[ClassFingerprint]        # name, methods, properties, exported, line_count
    imports: list[ImportFingerprint]       # source, specifiers
    exports: list[str]
```
This enables better change reporting to the frontend and partial re-analysis.

---

## Sprint 6 — New Features (Backlog, ~10 hours)

> **Goal**: Feature parity with Understand-Anything. Lower priority — implement after performance is solid.

---

### Task 1 · 🟠 Build `/diff/{repo_id}` endpoint *(B4)*

| Field | Detail |
|-------|--------|
| **Time** | 3 hr |

Build an endpoint that accepts a list of changed file paths and returns:
- Which graph nodes are directly affected
- Which nodes are 1-hop downstream (ripple effect)
- A risk score (cross-layer impact, complex component changes, blast radius)

This is almost free since the dependency graph already exists. Zero LLM cost.

---

### Task 2 · 🟠 Add function-level graph nodes *(B5)*

| Field | Detail |
|-------|--------|
| **Files** | [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py), [graph.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/graph.py) |
| **Time** | 4 hr |

The analyzer already parses ASTs and extracts function/class data — but throws it away after resolving imports. Keep the function declarations and build `contains` edges (file→function) and `calls` edges (function→function across files).

---

### Task 3 · 🟠 Local embedding cache for chat *(B6)*

| Field | Detail |
|-------|--------|
| **Files** | [vectorstore.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/vectorstore.py), [cache.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/cache.py) |
| **Time** | 2 hr |

For repos with <2000 chunks, cache embeddings in Redis alongside the analysis. On `/chat`, do local numpy cosine similarity search before falling back to Zilliz. Eliminates 100–300ms network latency per query.

---

### Task 4 · 🟡 Keyword search over analysis results *(B7)*

| Field | Detail |
|-------|--------|
| **Time** | 1 hr |

Add a simple keyword search over `file_profiles` and `dep_data`. Enables "find all core_modules" or "show entry points" without an LLM call.

---

### Task 5 · 🟡 Language plugin architecture *(B8)*

| Field | Detail |
|-------|--------|
| **File** | [analyzer.py](file:///c:/Users/ASUS/Desktop/CodeKAVI/backend/codekavi/analyzer.py) |
| **Time** | 2 hr |

Refactor the monolithic `_EXTRACTORS` dict into a plugin system where each language is a registered module with its own tree-sitter grammar, queries, and analysis logic. Each language becomes a module with a `register()` function.

---

## Verification Plan

### After Each Sprint

1. **Run the existing test suite** (if any) to ensure no regressions.
2. **Test with a medium repo** (~200–500 files) and measure end-to-end latency using the existing stage-level timers (`Stage analyzing completed in Xms`).
3. **Compare before/after** for each sprint:

| Metric | Baseline | After Sprint 1 | After Sprint 2 | Target |
|--------|----------|----------------|----------------|--------|
| `/analyze/stream` (500-file, cold) | ~60s | ~12s | ~8s | <10s |
| `/analyze/stream` (cache hit) | ~30s | ~5s | ~2s | <3s |
| `/explain` (first load) | ~50s | ~50s | ~2s (tour) | <3s |
| `/explain` (AI analysis) | ~50s | ~50s | ~50s | ~30s* |
| `/chat` per message | ~500ms | ~450ms | ~300ms | <300ms |

*\*AI analysis time depends on LLM provider latency, which is external.*

### Manual Testing Checklist
- [ ] Verify SSE stream emits `complete` before indexing finishes (Sprint 1, Task 1)
- [ ] Verify heartbeat events appear in long-running streams (Sprint 1, Task 5)
- [ ] Verify `cleanup_repo` failures don't kill the stream (Sprint 1, Task 6)
- [ ] Verify deterministic tour loads instantly via `use_tour=true` (Sprint 2, Task 1)
- [ ] Verify re-analysis of unchanged repo returns in <2s (Sprint 1, Task 4)
- [ ] Verify partial update works when <10 files change (Sprint 5, Task 2)
- [ ] Profile with stage-level timers to confirm each fix's impact

---

> [!TIP]
> **Sprint 1 alone** (Tasks 1–8, ~2.5 hours) should bring a 500-file repo from ~60s to ~8–12s. **Sprint 1 + Sprint 2 Tasks 1–2** pushes it below 5s for cache-hit paths and gives instant `/explain` via the deterministic tour.
