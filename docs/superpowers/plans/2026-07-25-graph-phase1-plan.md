# Implementation Plan: Graph Phase 1 (Substrate)

**Spec:** `docs/superpowers/specs/2026-07-25-graph-and-tour-design.md`
**Scope:** Phase 1 only — the graph itself. No tour, no LLM prose endpoint, no question-driven tours.
**Outcome:** `/repo/[repoId]/graph` renders a two-level, ELK-laid-out semantic graph with flags, backed by a deterministic, tested backend endpoint.

Steps are ordered so each one is verifiable before the next begins. Backend is complete and tested before any frontend work starts, so the UI builds against a real endpoint rather than a mock.

---

## Step 0 — Prerequisites

**Why first:** Steps 5 and 9 add endpoints that take a `repo_id`. Without `assert_repo_owner` they inherit review IMPL-5 verbatim, and retrofitting authorization across three endpoints is more work than adding it once.

### 0.1 — `.dockerignore` + non-root container (IMPL-1, IMPL-2)

**Files:** new `backend/.dockerignore`, new `frontend/.dockerignore`, `backend/Dockerfile`

Contents are specified verbatim in `review_implementation.md` IMPL-1 and IMPL-2.

**Verify:**
```bash
docker build -t codekavi-backend backend/
docker run --rm codekavi-backend sh -c 'ls -la /app/.env || echo NO_ENV'   # → NO_ENV
docker run --rm codekavi-backend id -u                                     # → 10001
```

Then rotate every key that has been built into a pushed image.

### 0.2 — `assert_repo_owner` (IMPL-5)

**Files:** `backend/codekavi/cache.py`, `backend/codekavi/session.py`, `backend/codekavi/routes/*.py`

Persist `owner_user_id` alongside each analysis and add the helper from IMPL-5 Option A. Call it in `get_graph`, `restore_repo`, `chat_repo`, `explain_*`, and `cleanup`. Return 404 rather than 403 so the endpoint is not an existence oracle.

Legacy rows have `owner_user_id is None` and are treated as public-readable but not deletable.

**Verify:** manual two-account check — user B gets 404 on user A's `repo_id` for `DELETE /cleanup`. Automated coverage lands in step 1.3.

**Size:** ~1 day for all of step 0.

---

## Step 1 — Test infrastructure

**Why before the feature:** `backend/tests/` currently holds only `fixtures/` and stale `__pycache__`, and CI runs bare `pytest` which exits 5 on zero collected tests. Building the assembler first and testing it later is how the current situation arose.

### 1.1 — Fixtures

**Files:** new `backend/tests/conftest.py`, new `backend/tests/fixtures/analysis_small.json`, `analysis_cyclic.json`, `analysis_flat.json`

Three saved analysis results (the dict shape `_load_repo` returns, with `dep_data` and `file_profiles`):

- **`analysis_small`** — ~20 files across 4+ roles, nested folders, a clean DAG. The happy path.
- **`analysis_cyclic`** — contains a 2-cycle and a 3-cycle. Exercises `in_cycle` and the tier fallback.
- **`analysis_flat`** — all files at repo root, so folder grouping yields one bucket and the community fallback must trigger.

Generate them by running the real pipeline against three small public repos and saving the output, rather than hand-writing them — hand-written fixtures drift from the real shape.

### 1.2 — CI guard

**File:** `.github/workflows/ci.yml`

```yaml
- run: pytest --strict-markers -p no:cacheprovider
- run: test "$(pytest --co -q | grep -c '::')" -gt 0
```

Also delete `.gitlab-ci.yml` or make it authoritative — not both (review O-5).

### 1.3 — IDOR regression test

**File:** new `backend/tests/test_authz.py`

Parametrized over every `repo_id` endpoint: user B receives 404 for user A's repo. This is the guard that makes step 0.2 stay true, and new endpoints get added to the parametrize list in step 5.

**Verify:** `pytest` collects >0 tests and passes; CI turns green for the first time.

**Size:** ~half a day.

---

## Step 2 — Container derivation

**File:** new `backend/codekavi/graph_assembler.py` (pure — no I/O, no FastAPI, no cache imports)

Port `deriveContainers` from UA's `packages/dashboard/src/utils/containers.ts`:

- Longest common prefix over the *directory* portion of paths, trimmed to a `/` boundary
- Group by first path segment after that prefix
- Fall back to community detection when bucket count < 2, or any bucket holds > 70% of files
- Suppress single-child containers (their child becomes ungrouped) unless the layer has < 3 files

**Community detection:** ~80 lines of label propagation in this module. No new dependency — `networkx`, `scipy`, `numpy` are all absent from `requirements.txt` and not worth adding for a fallback path.

**Determinism requirements, non-negotiable:**
- Sort at every iteration point. `DepGraph.adjacency` is `dict[str, set[str]]` and Python randomizes string hashing per process, so unsorted set iteration produces different output after every restart.
- Label propagation iterates nodes in sorted order and breaks ties by lowest node id.
- Fixed iteration count, not "until convergence" — convergence can oscillate.

**Tests** (`backend/tests/test_graph_assembler.py`):
- Folder strategy on `analysis_small`
- Community fallback triggers on `analysis_flat`
- Community fallback triggers when one bucket exceeds 70%
- Single-child suppression, and its exemption below 3 files
- Same input → identical community assignment, run 100×

**Size:** ~1 day.

---

## Step 3 — Flags and insights

**File:** `backend/codekavi/graph_assembler.py`

Thresholds as module constants:

```python
HUB_MIN_IN_DEGREE = 10
HUB_TOP_PERCENTILE = 0.05
GOD_FILE_MIN_LINES = 1000
GOD_FILE_TOP_PERCENTILE = 0.02
```

| Flag | Condition |
|---|---|
| `orphan` | `in_degree == 0` and not in `DepGraph.entry_points` |
| `in_cycle` | Appears in any cycle from `detect_cycles()` |
| `hub` | `in_degree >= HUB_MIN_IN_DEGREE`, or top 5% by `in_degree`, whichever is lower |
| `entry_point` | In `DepGraph.entry_points` |
| `god_file` | Over `GOD_FILE_MIN_LINES`, or top 2% by size, whichever is lower |

`insights` reuses existing outputs: `detect_cycles()` (`graph.py:922`), `_find_central_files()` (`analyzer.py:1187`), `DepGraph.entry_points`, plus the orphan list derived above.

**Tests:** each flag at its threshold boundary (at, one below, one above); `analysis_cyclic` produces the expected `in_cycle` set; a file with no flags yields an empty list; flag order within a file is stable.

**Size:** ~half a day.

---

## Step 4 — Assembly, edge aggregation, portals

**File:** `backend/codekavi/graph_assembler.py`

Single entry point:

```python
def assemble_graph(result: dict) -> dict:
    """Pure: analysis result in, graph payload out. No I/O."""
```

Work:
- Layers via `ROLE_TO_LAYER` (`graph.py:620`), ordered by `_topological_tiers` (`graph.py:900`)
- **Layer fix from the spec:** split `documentation` into its own layer; let `leaf` and `barrel` files sit in their importer's layer instead of the `other` bucket
- Containers per layer (step 2)
- Files with flags (step 3)
- Edges pre-aggregated at all three levels — `file`, `container`, `layer` — each carrying `count`
- Portals: for each layer, the set of other layers it connects to, with connection counts
- `fingerprint` from `fingerprint.py`. **No `generated_at`** — it would break byte-determinism and the ETag

**The determinism test, which is the important one:**

```python
@pytest.mark.parametrize("seed", ["0", "1", "42"])
def test_assembler_stable_across_hash_seeds(seed):
    # MUST run in a subprocess. PYTHONHASHSEED is fixed at interpreter start,
    # so asserting twice inside one process proves nothing.
```

Run `assemble_graph` over each fixture in a subprocess with the given `PYTHONHASHSEED`, dump canonical JSON, assert byte-identical across all seeds.

**Other tests:** container and layer edge `count` equals the sum of underlying file edges; no self-edges; no duplicate edges; every file belongs to exactly one layer; every `container_id` and `layer_id` referenced by a file exists.

**Size:** ~1.5 days.

---

## Step 5 — The endpoint

**Files:** new `backend/codekavi/routes/graph.py`, `backend/codekavi/routes/__init__.py`

```python
@router.get("/graph/{repo_id}", dependencies=[Depends(per_minute(30))])
async def get_repo_graph(
    request: Request,
    repo_id: str,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
```

Follows the `routes/visualize.py` pattern exactly: `_load_repo` → `assert_repo_owner` → `run_sync(assemble_graph, result)` → ETag response. Register in `routes/__init__.py` alongside the existing five routers.

**Hard requirements:**
- **Zero provider calls.** Review N-1 exists because `GET /visualize/dataflow` bills and writes to a cross-user cache. This endpoint does neither.
- **No cache writes.** Pure assembly over in-memory data. ETag only; add caching later if profiling shows it matters (review P-1 already flags unbounded cache growth).
- ETag/`if-none-match` mirroring the `/restore` route.
- 202 passes through unchanged from `ensure_repo_loaded`; the client handles it in step 7.

**Tests** (`backend/tests/test_graph_routes.py`):
- 200 returns a payload matching the spec's shape
- Two calls return byte-identical bodies
- ETag round-trip returns 304
- **Zero provider calls** — assert on a mocked provider
- 202 returns the re-analyzing shape, not a graph
- Unknown `repo_id` → 404
- Add `/graph/{repo_id}` to the step 1.3 IDOR parametrize list

**Size:** ~half a day.

**Backend is now complete and testable end to end. Verify against 3–4 real repos of varying size before starting the frontend.**

---

## Step 6 — Frontend scaffolding

**Files:** `frontend/package.json`, `frontend/lib/api.ts`, new `frontend/hooks/useRepoGraph.ts`

- `npm install @xyflow/react` (~120KB gzipped; existing D3 visualizations untouched)
- `npm install -D vitest @vitejs/plugin-react` and add a `test` script
- `lib/api.ts`: `fetchRepoGraph(repoId)` mirroring `fetchVisualization` — auth headers, `AbortController`
- `hooks/useRepoGraph.ts`: fetch + state

**The 202 branch is the point of this step.** Review N-2 exists because `res.ok` is `true` for 202, so a re-analyzing repo rendered as "No Data Available". The hook must branch on `res.status === 202` and poll with backoff.

**Tests** (`frontend/hooks/__tests__/useRepoGraph.test.ts`): 200 → data; 202 → polling state, never an error state; 404 → error; 500 → error.

**Size:** ~half a day.

---

## Step 7 — ELK layout in a worker

**Files:** new `frontend/lib/graph/elkLayout.ts`, new `frontend/lib/graph/elkLayout.worker.ts`

`elkjs@^0.9.3` is already installed. Options per the spec:

```ts
{ algorithm: "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "60" }
```

Two passes: Stage 1 lays out containers as opaque atoms sized `sqrt(childCount)`, capped at 800×600. Stage 2 lays out an expanded container's children.

**Deferring** UA's size memoization (`containerSizeMemory` / `stage1Tick`). Add only if expanding a container visibly displaces neighbours on a real 300-file repo.

Worker failure falls back to a deterministic grid plus a warning banner — the page stays usable.

**Tests:** ELK input construction from a fixture payload; grid fallback produces non-overlapping positions.

**Size:** ~1 day.

---

## Step 8 — Components

**Files:** `frontend/components/graph/*`

Build bottom-up so each is viewable in isolation:

1. `FileNode.tsx` — role colour, `importance` sizing, flag markers
2. `ContainerNode.tsx` — collapsed atom / expanded frame, child count, strategy badge
3. `LayerNode.tsx` — overview card: name, file count, edge counts, flag badges
4. `PortalNode.tsx` — "→ Services (12)", navigates on click
5. `GraphBreadcrumb.tsx`
6. `FlagFilter.tsx` — the landing strip: *"3 files nothing imports · 1 circular dependency · `orchestrator.py` imported by 23"*, each filtering the canvas
7. `NodePanel.tsx` — deterministic facts only in phase 1; the prose section and "Ask about this file →" handoff land in phase 2
8. `GraphCanvas.tsx` — React Flow wiring, drill-in, expand/collapse

State is `useReducer` + context (`activeLayer`, `expandedContainers`, `selectedNode`, `activeFlags`), following the existing `RepoProvider` pattern. Not Zustand.

Design tokens: Geist Mono, greyscale surfaces, `--viz-highlight` for the active node.

**Size:** ~3 days.

---

## Step 9 — Page and wiring ✅ done

**Files:** new `frontend/app/repo/[repoId]/graph/page.tsx`, `frontend/components/Sidebar.tsx`

Under the existing `app/repo/[repoId]/layout.tsx`, so `RepoProvider`, `TopNav`, and `Sidebar` come free. Add a "Graph" tab to `Sidebar.tsx`.

**Read `node_modules/next/dist/docs/` before creating the route** — `frontend/AGENTS.md` flags this as a modified Next.js 16 build.

Required states, all of which must be visibly correct:

| State | Behaviour |
|---|---|
| 202 re-analyzing | "Re-analyzing…" + poll. **Not** "No Data Available" |
| `repoData === null` on hard refresh | Fetch by `repoId` rather than hanging on "Loading…" |
| Zero resolved edges | Files grouped by role + explanation of what could not be resolved |
| ELK worker failure | Grid fallback + warning banner |
| >1500 files | Overview only; require drill-in before rendering file nodes |

The hard-refresh case is worth testing deliberately — review notes `RepoProvider` hydrates only from `sessionStorage`, so a direct URL with no session sits on "Loading repository data…" forever.

**Size:** ~1 day.

---

## Step 10 — Verification

**Backend:** `ruff`, `mypy`, `pytest` all clean. CI green with >0 collected tests. ✅ done — 66 passed, ruff/mypy clean, collection-count guard passes.

**Frontend:** `npm run lint`, `npm test`, `next build` all clean. ✅ done — 51 tests passed, 0 lint errors (removed one unused `RepoGraphLayer` import in `elkLayout.ts`; 7 remaining warnings are pre-existing and unrelated to this feature), build succeeds with `/repo/[repoId]/graph` in the route list.

**Manual, against 4 repos** — not run this pass (needs a live server and hand-picked repos): — one small (<50 files), one medium (~300), one flat-structured (forces the community fallback), one with a known cycle:

1. Analyze, land on `/repo/{id}/graph`
2. Flag strip surfaces real findings; each filters the canvas
3. Drill into a layer, expand a container, select a file; panel shows correct degree counts and flags
4. Portals navigate between layers
5. Reload the URL directly with no session — page recovers rather than hanging
6. Kill the backend mid-load — error state, not a blank canvas

**Determinism, the acceptance gate:**
```bash
curl .../api/graph/{id} > a.json
# restart the backend process
curl .../api/graph/{id} > b.json
diff a.json b.json    # must be empty
```
The restart is the point — it's what exercises the `PYTHONHASHSEED` path that an in-process test cannot.

---

## Sequencing and size

| Step | Work | Rough size |
|---|---|---|
| 0 | Prerequisites (IMPL-1/2/5) | 1 day |
| 1 | Test infrastructure | 0.5 day |
| 2 | Container derivation | 1 day |
| 3 | Flags and insights | 0.5 day |
| 4 | Assembly, edges, portals | 1.5 days |
| 5 | Endpoint | 0.5 day |
| 6 | Frontend scaffolding | 0.5 day |
| 7 | ELK worker | 1 day |
| 8 | Components | 3 days |
| 9 | Page and wiring | 1 day |
| 10 | Verification | 1 day |

**~11.5 days.** Steps 0–5 (backend, ~5 days) are independently valuable — they deliver a tested, deterministic graph endpoint that any client can consume.

## Explicitly out of scope for phase 1

Node prose endpoint · tour endpoint and stepper · learn/recall registers · interview questions · question-driven tours · diff tours · symbol-level nodes · ELK size memoization · retiring `ArchitectureGraph.tsx` and `DependencyGraph.tsx` · structural digest injection into the chat prompt.

The last one is worth an early follow-up — it is roughly 30 lines and makes chat noticeably better at the questions this user base asks.
