# Design pass: Phase 3 — question-driven tours & diff tours

**Date:** 2026-07-26
**Status:** Design pass for `Order of implementation.txt` Stage F, item F5
**Parent spec:** `2026-07-25-graph-and-tour-design.md` §3 (phase list) and §8
("Phase 3 plugs in here")

---

## 1. What phase 3 actually is

The parent spec fixes phase 3's scope in two sentences: question-driven tours
(RAG → graph route) and diff tours off `fingerprint.py`. It deliberately did
not size either, because phase 1/2 had to exist first. They now do
(`graph_assembler.py`, `tour_generator.py`, `routes/graph.py` — Stage C/E,
already shipped). This pass grounds both in the code that exists today and
splits them into E-series-sized items.

Both features are **new step sources for the same stepper** (`TourPanel.tsx`,
E6) over the **same payload shape** `assemble_tour` already returns:
`{mode, steps: [{order, node_ids, layer_id, title, facts, questions}]}`. The
parent spec's design decision — "the tour component does not care where steps
came from" — means no frontend stepper/camera-trap work is needed beyond
wiring a new fetch. That was the point of building E6/E7 against that shape.

## 2. Question-driven tours

### What already does 80% of this

- `zilliz_client.search(query, repo_id, limit, layer_filter)` (`routes/chat.py:149`)
  returns chunks with `file_path` already resolved — no new retrieval code.
- `graph["files"][i]["id"] == profile["path"]` (`graph_assembler.py:366`) — a
  chunk's `file_path` **is** the graph node id. No id-mapping layer needed.
- `_kahn_order` / tier lookup (`tour_generator.py:36`, `:159`) already produce
  a dependency-respecting order; it just needs to run over a restricted node
  set instead of every file.
- `assemble_tour`'s title/facts/questions builder (`tour_generator.py:265`)
  works on any `steps` list shaped `{order, node_ids, layer_id}` — reuse
  verbatim, don't fork it.

### What's new

**G1 — Resolve question to nodes.** Pure function in `tour_generator.py`:

```python
def resolve_question_nodes(graph: dict, search_results: list[dict]) -> list[str]:
    """search_results = zilliz_client.search() output. Dedupes by file_path,
    preserves retrieval rank, drops hits whose file_path isn't a graph node
    (chunk from a file the assembler skipped, e.g. binary/oversized)."""
```
Retrieval rank is the tie-break signal recall-mode already has no use for —
carry it through rather than discarding it.

**G2 — Order the resolved set.** `generate_question_tour(graph, node_ids)`:
tier-order via the existing `_kahn_order` restricted to `node_ids`, ties
broken by retrieval rank (the file the closest-matching chunk came from
leads). Same output shape as `generate_learn_tour`, so `assemble_tour`
doesn't need a third branch — pass it a pre-built `steps` skeleton instead of
having it dispatch on mode name.

**G3 — Endpoint.** `GET /graph/semantic/{repo_id}/tour/question?q=...`.
This is the *only* phase-3 endpoint that costs money — every call embeds the
query. It must reuse `chat.py`'s two gates verbatim:
`get_token_tracker().check_quota(user_id)` (chat.py:90) and a `per_minute`
tighter than the free `30`/min on the structural endpoints (`graph.py:32,60`)
— match chat's existing limit rather than invent a new number. `assert_repo_owner`
comes for free through `_load_repo` (`routes/visualize.py`, already used by
both existing graph routes).

No G4: per-step prose would call the `/node/{node_id}` prose endpoint the
parent spec designs in §6 — it doesn't exist yet (checked: only
`/graph/semantic/{repo_id}` and `/graph/semantic/{repo_id}/tour` are routed).
Building it is phase-2 scope, not phase-3's — question tours ship against the
zero-LLM facts/questions layer exactly like learn/recall do today, and pick up
prose for free whenever that endpoint lands.

**Estimate:** G1 0.5d, G2 0.5d, G3 0.5d ≈ **1.5 days**.

## 3. Diff tours

### The reframe that makes this small

The parent spec says "off `fingerprint.py`" without saying which diff. Reading
`fingerprint.py` + its two call sites in `routes/analyze.py` (:406, :662)
settles it: `repo_id` is a stable UUID assigned once per clone
(`cloner.py:102`), and `compare_and_classify_repo` already runs **on every
re-analysis of that same `repo_id`**, diffing current file state against
`load_fingerprints(repo_id)` — the fingerprints saved by the *previous*
analysis of this exact repo. So a diff tour is not "diff two arbitrary
commits picked by the user" (which would need a UI for commit selection and
two independent graphs). It's **"what changed since I last analyzed this
repo"** — same `repo_id`, and the classification is already computed on the
pipeline's hot path. The only gap is that today it's used to decide
skip/partial/full re-analysis and then discarded (`routes/analyze.py:408-410`)
instead of being surfaced to the user.

### What's new

**H1 — Persist the change map.** Both `compare_and_classify_repo` call sites
in `routes/analyze.py` (:409, :665) already produce `fingerprints: dict[str,
FileFingerprint]` with `.change_type` per path. Before `cache.set(repo_id,
result)`, attach
`result["last_change_map"] = {path: fp.change_type for path, fp in fingerprints.items()}`.
No new storage — it rides the existing 3-tier `AnalysisCache` write. On a
repo's first-ever analysis this key is simply absent, which is the correct
signal for H3's 404 below (everything is technically "STRUCTURAL" on a first
pass — that's not a diff, it's the whole repo).

**H2 — Diff tour steps.** New pure function in `tour_generator.py`:

```python
def generate_diff_tour(graph: dict, change_map: dict[str, str]) -> list[dict]:
    """STRUCTURAL and COSMETIC files from change_map, restricted to ids
    present in graph (drops deleted files — see below). STRUCTURAL first,
    COSMETIC after; importance desc within each group (reuses
    _recall_sort_key's shape). One step per file; facts state the change
    kind plainly instead of the usual role/fan-in line."""
```
Deleted files (`path in change_map`, absent from current `graph["files"]`)
have no node to highlight in the canvas, so they don't fit the existing step
shape (`node_ids` pointing at a real, positioned node). Rather than invent a
speculative UI for that (a step with nothing to `fitView` onto), H2 drops them
from the stepped set and H4 surfaces the count as a one-line banner —
"3 files deleted since your last visit" — above the stepper, not as steps.
Widen this only if real usage shows people need to interrogate *what* was
deleted, not just that something was.

**H3 — Endpoint.** `GET /graph/semantic/{repo_id}/tour/diff`. Reads
`last_change_map` off the cached result already loaded by `_load_repo`; if
absent, 404 with a message distinguishing "no prior analysis to diff against"
from "nothing changed" (an empty-but-present map is a valid, boring diff — a
missing key is a different repo state entirely and must not render as "no
changes"). Zero LLM calls, same free `per_minute` tier as the two existing
structural endpoints.

**H4 — Frontend wiring.** `TourPanel` gets a third entry point next to
learn/recall: "What changed" (calls H3) and a question box (calls G3, from
§2). Both hit the same panel component E6 already built — no stepper or
camera-trap changes, since the payload shape is unchanged. The
deleted-files banner from H2 renders above the stepper when `deleted_count >
0`.

**H5 — Verification.** Determinism test for `generate_diff_tour` over fixture
change-maps (structural/cosmetic/mixed/empty), subprocess hash-seed pattern
matching the existing `test_graph_assembler.py` determinism tests (parent spec
§12). Endpoint tests: 404 on no-prior-analysis, IDOR denial (same pattern as
the deleted `test_graph_routes.py` — F3's test-restoration work is a
prerequisite here, not new to invent). Backend test files for this area were
wiped in the current reorg (see git status); restoring the graph-routes test
file is shared groundwork with F3, do it once.

**Estimate:** H1 0.25d, H2 1d (incl. deleted-file handling), H3 0.5d, H4 1d,
H5 0.5d ≈ **3.25 days**.

## 4. Total and ordering

| | Estimate | Depends on |
|---|---|---|
| G1–G3 (question tours) | 1.5 days | Stage C/E (shipped) |
| H1–H5 (diff tours) | 3.25 days | Stage C/E (shipped); H5 shares test-restoration with F3 |
| **F5 total** | **~5 days** | |

G and H don't depend on each other and can run in parallel. Both are
backend-first and independently valuable the same way E1–E3 were: G1–G3 and
H1–H3 ship value with zero frontend work (hit the endpoints directly / via
existing `curl`), H4 is the only item that touches React.

No new dependencies, no new database tables, no new cache tier — everything
above is a new pure function plus a thin route, composed from modules that
already exist. That's the read this pass was for: phase 3 looked unsized
because nobody had checked how much of it phase 1/2 already built.
