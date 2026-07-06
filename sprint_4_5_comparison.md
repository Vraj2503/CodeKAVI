# Sprint 4 & 5 — Planned vs. Actual Comparison

> Compares what was specified in the implementation plan against what was actually implemented in the codebase, including bug fixes from this session.

---

## Sprint 4 — Code Hygiene & Minor Optimizations

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Eliminate double tree-sitter parse for JS/TS files | ⚠️ **Partial** | `compute_file_hash` now accepts optional `content` param (fingerprint.py:121). But the AST is still parsed independently in both `analyzer.py` and `fingerprint.py`. No shared AST cache was introduced. |
| 4.2 | Consolidate `_detect_language` into single function | ✅ **Done** | Single canonical `detect_language()` lives in `config.py:274`, imported by traverser, analyzer, and indexer. |
| 4.3 | Remove redundant file filtering in `_build_tree` | ✅ **Done** | `_build_tree` was merged into a single `os.walk` pass during Sprint 1 Task 2, eliminating the double-filter naturally. |
| 4.4 | Parallelize graph export calls | ✅ **Done** | `asyncio.gather` now runs `export_graph_json`, `export_mermaid`, `build_module_graph`, and `detect_cycles` concurrently (analyze.py:316, 693). |
| 4.5 | Pre-compute degree lists lazily in classifier | ⚠️ **Partial** | Degree lists are computed but using `file_signals` pre-pass from Sprint 2 Task 4 partially reduces wasted work. The specific lazy-degree optimization from the plan was not independently implemented. |
| 4.6 | Add ETag/If-None-Match to `/restore/{repo_id}` | ✅ **Done** | Full ETag implementation at analyze.py:883–893 with `If-None-Match` support and `Cache-Control: private, max-age=300`. |
| 4.7 | Skip `ensure_repo_loaded` on subsequent chat messages | ❌ **Not done** | `chat.py` still calls `ensure_repo_loaded` on every message. No in-memory TTL set for recently-validated `repo_id`s. |
| 4.8 | Cache serializer work in AnalysisCache | ✅ **Done** | `cache.set()` serializes once (`json.dumps` at line 180) and passes the pre-serialized string to `_redis_set_raw` and `_supabase_set_raw`. |

### Sprint 4 Summary
- ✅ Completed: **5/8** tasks (4.2, 4.3, 4.4, 4.6, 4.8)
- ⚠️ Partial: **2/8** tasks (4.1, 4.5)
- ❌ Not done: **1/8** tasks (4.7)

---

## Sprint 5 — Architecture Refactoring

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Define typed dataclasses for pipeline stages | ✅ **Done** | `pipeline_models.py` exists with full Pydantic models: `FileEntry`, `RepoData`, `DepGraph`, `FileProfile`, and `AnalysisResult`. All pipeline stages return typed objects. |
| 5.2 | Implement partial/incremental analysis | ✅ **Done** | `ChangeClassification` enum (SKIP, PARTIAL_UPDATE, ARCHITECTURE_UPDATE, FULL_UPDATE) is implemented in `fingerprint.py:71`. It is used throughout `analyze.py` at lines 171, 195, 240, 543, 558, 608. |
| 5.3 | Enrich fingerprint storage with structural detail | ✅ **Done** | `FileFingerprint` dataclass now includes `functions: list[FunctionFingerprint]`, `classes: list[ClassFingerprint]`, `imports: list[ImportFingerprint]`, `parse_error: bool`. Dedicated dataclasses `FunctionFingerprint`, `ClassFingerprint`, `ImportFingerprint` exist at fingerprint.py:79–97. |

> [!NOTE]
> Sprint 5 is the most complete sprint. All 3 tasks were implemented, though Task 5.3 has a minor **duplicate field declaration bug** in `FileFingerprint` (fields `content_hash`, `imports_hash`, etc. are declared twice at lines 103–107 and again at 112–117). This is a cosmetic dataclass issue that Python tolerates but should be cleaned up.

### Sprint 5 Summary
- ✅ Completed: **3/3** tasks (5.1, 5.2, 5.3)
- ⚠️ Bug: Duplicate field declarations in `FileFingerprint` dataclass

---

## Bugs Fixed During This Session (Not in Sprint Plan)

These were **runtime bugs discovered while testing** after the sprint work was merged. They were fixed during our debugging session:

| Bug | File | Fix Applied |
|-----|------|-------------|
| `repo_id` missing from SSE `complete` event | `analyze.py` | Added `repo_id` to `complete` event payload |
| Zilliz chunks not inserted (embedding broken) | `indexer.py` | Fixed async indexer to properly await embeddings |
| `NameError: name 'graph_data' is not defined` in `_prompt_architecture` | `orchestrator.py:300` | Replaced `graph_data.get(...)` → `self.analysis.get(...)` |
| `NameError: name 'graph_data' is not defined` in `_prompt_dependencies` | `orchestrator.py:393, 399` | Replaced `graph_data.get(...)` → `self.analysis.get(...)` |
| `NameError: name 'graph_data' is not defined` in `_prompt_dataflow` | `orchestrator.py:96` | Removed `graph_data` arg from call and signature |
| `useEffect is not defined` in `ReportView.tsx` | `frontend/components/report/ReportView.tsx` | Added `useEffect` to React import |
| User questions invisible / text truncated in chat | `frontend/components/ChatPanel.tsx` | Added `min-w-0`, `max-w-full overflow-x-hidden` constraints to flex containers |
| `fallback` SSE event from tour not rendered | `frontend/hooks/useSSE.ts` | Added `case "fallback"` handler that converts tour stops into section events |
| Fallback sections not shown in `ReportView` | `frontend/components/report/ReportView.tsx` | Added dynamic section renderer for sections outside `sectionOrder` |

---

## Overall Sprints 1–5 Coverage

| Sprint | Goal | Completion |
|--------|------|------------|
| Sprint 1 | Critical Quick Wins | ~90% ✅ |
| Sprint 2 | Medium Wins | ~75% ✅ |
| Sprint 3 | Reliability & Edge Cases | ~85% ✅ |
| Sprint 4 | Code Hygiene | ~70% ⚠️ |
| Sprint 5 | Architecture Refactoring | ~95% ✅ |

---

## Remaining Work (Recommended Next Steps)

| Priority | Task | Effort |
|----------|------|--------|
| 🔴 High | Fix duplicate field declarations in `FileFingerprint` (fingerprint.py:103–117) | 5 min |
| 🟠 Medium | Sprint 4.7: Skip `ensure_repo_loaded` on subsequent chat messages (chat.py) | 10 min |
| 🟠 Medium | Sprint 4.1: Implement shared AST cache for JS/TS to avoid double tree-sitter parse | 30 min |
| 🟡 Low | Sprint 4.5: Lazy degree list computation in classifier | 10 min |
| 🟡 Low | Sprint 6: `/diff/{repo_id}` endpoint, function-level graph nodes, local embedding cache | 10+ hrs |
