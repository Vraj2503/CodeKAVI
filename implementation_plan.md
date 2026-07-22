# Fix: stale cache serves zero-edge dependency graphs after analyzer changes

## Context

sanku-backend's dependency graph shows "No Connections Resolved" (zero edges),
even though a **fresh** analysis of that repo now resolves 23 edges (confirmed
via `dep_debug.py` and a direct re-analysis in prior diagnostic sessions).

Diagnosis is complete: edge extraction, resolution, and `known_files` matching
all work correctly today. The zero-edges symptom is **not** an analyzer bug
anymore — it is a **cache-invalidation gap**:

- Cached analysis results (`graph_json`) are keyed only by `repo_id` /
  commit-signature. Fingerprints (`fingerprint.py`) detect **file content**
  changes, but nothing detects **analyzer/pipeline code** changes.
- So when the analyzer or `fingerprint.py` is fixed, any repo already cached
  keeps serving its old, pre-fix `graph_json` forever. sanku-backend was cached
  with an old zero-edge result and never recomputed.

Two short-circuit paths both serve that stale result, and **both read through
one function** — `AnalysisCache.get()`:

1. **T4.4 signature dedup** (`routes/analyze.py:107`, `:561`): `lookup_by_signature`
   → `self.get(repo_id)`. Fires for *any* fresh request whose commit was seen
   before — the dominant real-world path.
2. **`ChangeClassification.SKIP`** (`routes/analyze.py:177`, `:601`):
   `ensure_repo_loaded` (`session.py:55`) → `cache.get(repo_id)`.

Intended outcome: when analyzer/pipeline logic changes, cached results become
stale and are transparently recomputed; existing zero-edge entries (including
sanku-backend) flush on next access.

## Approach

Add an **analysis-version stamp** to cached results and treat a version
mismatch as a cache miss. One chokepoint — `AnalysisCache.get()` /
`AnalysisCache.set()` in `backend/codekavi/cache.py` — covers both
short-circuit paths, because everything reads through `get()`.

A miss returns `None`, which routes back into the normal full-analysis path
(dedup miss → clone/traverse/analyze; or SKIP's `try/except` falls through to
full analysis), producing a fresh, correctly-edged graph that `set()` then
re-caches under the current version.

### Changes — `backend/codekavi/cache.py`

1. Module constant near the other cache constants (line ~26):
   ```python
   # Bump whenever analyzer/fingerprint/graph-export logic changes in a way
   # that alters cached output. A mismatch makes cached results a cache miss,
   # forcing transparent re-analysis. Current bump: require()/dynamic-import()
   # fingerprint fix + edge-resolution work on visualization_fix.
   ANALYSIS_VERSION = "2"
   ```
   (`"1"` = implicit pre-stamp era; start at `"2"` so every existing entry —
   all lacking the key — is stale and flushes.)

2. In `set()` (line 172), stamp the version after `_make_serializable`, before
   writing any tier:
   ```python
   serializable["_analysis_version"] = ANALYSIS_VERSION
   ```

3. In `get()` (line 146), gate each tier hit on the version. Replace each
   `if result:` with a version check so a stale entry is neither returned nor
   promoted to a lower tier:
   ```python
   if result and result.get("_analysis_version") == ANALYSIS_VERSION:
       return result   # (L1)  / promote + return (L2, L3)
   ```
   Fall through to the next tier (and ultimately `return None`) on mismatch.
   Add a small private helper `_is_current(result)` to avoid repeating the
   comparison three times.

That is the entire fix. No route, session, or fingerprint changes needed —
`ensure_repo_loaded` and `lookup_by_signature` already treat `get() → None` as
"recompute".

### Deliberate simplifications (ponytail)

- **Stale entries are not actively evicted**, only ignored. They get
  overwritten by `set()` on re-analysis (same `repo_id`) or orphaned in L3
  when signature dedup re-points to a new `repo_id`. Orphans age out of Redis
  via `REDIS_TTL_SECONDS`; L3/Supabase orphans persist but are unreferenced.
  Add active eviction only if L3 row growth ever matters —
  `# ponytail: ignore-not-evict; add DELETE on mismatch if L3 rows grow`.
- A single global `ANALYSIS_VERSION` invalidates *all* repos on any bump, not
  just the affected language/path. Correct and trivial; per-component
  versioning is unjustified complexity for a value bumped by hand a few times.

## Verification

1. **Unit-level (self-contained, no network):** in `backend/`, confirm the
   stamp/gate round-trips and that a legacy (unstamped) dict is rejected:
   ```
   venv/bin/python -c "
   from codekavi.cache import AnalysisCache, ANALYSIS_VERSION
   c = AnalysisCache()
   c.set('r1', {'graph_json': {'edges': [1,2,3]}, 'repo_name': 'x', 'owner': ''})
   assert c.get('r1')['graph_json']['edges'] == [1,2,3]        # fresh hit
   c._memory['r2'] = {'graph_json': {'edges': []}}             # legacy, unstamped
   assert c.get('r2') is None                                  # treated as miss
   print('cache version gate OK')
   "
   ```
2. **Fresh-analysis edge sanity (already green):**
   `venv/bin/python dep_debug.py --repo "../test repos/sanku-backend"` →
   `stats` shows resolved edges > 0 (was 23). Confirms the recompute target is
   correct.
3. **End-to-end (browser, per prior session flow):** re-run analysis of
   sanku-backend through the UI (`/repo/[repoId]/visualize`). Because the old
   zero-edge entry is now a version miss, the pipeline recomputes and the
   Dependency Graph renders connections instead of "No Connections Resolved."
   Optionally confirm the served `graph_json.edges` is non-empty via
   `GET /api/graph/{repo_id}?format=json`.

## Out of scope

- tsconfig `@/` path-alias resolution (known, separate gap).
- Go/Rust resolvers hardcoded to `None` (separate follow-up).
- HTML/vanilla-JS extractor (none exists).
