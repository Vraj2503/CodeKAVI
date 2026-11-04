# Future Scope

Deferred work that has been thought through but deliberately not built. Each entry carries enough
design detail that picking it up later needs no archaeology through old sessions: what it adds, why
it was deferred, what already exists to build on, what it still needs, and how you'd know it worked.

Companion to [Plan.md](Plan.md) (the active plan) and [STATUS.md](STATUS.md) (current progress).

---

## 1. Call graph — caller → callee edges

**Status:** deferred from Phase 3, where it was option C. Phase 3 builds the symbol inventory and
symbol-level *import* edges (options A + B); this entry is the behavioural layer on top.

### What it would add

Today the graph can say *file A imports file B*, and after Phase 3 it can say *A imports
`clone_repo` from B*. It still cannot say *`analyze()` calls `clone_repo()`*. A call graph answers
the questions users actually ask a codebase:

- How does this function get invoked, and from where?
- What breaks if I change this signature?
- What is the real execution path from the entry point to the database write?

It would also let the tour narrate behaviour ("`analyze` calls `clone_repo`, then `traverse_repo`")
instead of structure, and let the dataflow diagram draw the path data actually takes.

### Why it was deferred

It needs a new extraction pass over every file plus cross-file resolution, which is a genuinely hard
problem with partial answers (see *Hard parts*). Phase 3's A+B reuse data that is already computed
and discarded, so they were near-free; this is not. It earns its own phase.

### What already exists to build on

| Piece | Where | Note |
|---|---|---|
| Symbol inventory with start lines | `rune/symbols.py`, `fingerprint.py` | Phase 3 T14/T16 — gives you the callee *definitions* to resolve against |
| Import specifiers joined to resolved target files | `analyzer.py` edges | Phase 3 T15 — **this is the prerequisite**: it solves the cross-file half of resolution |
| Per-file parse infrastructure | `fingerprint.py:171` (`compute_structure_signature`) | Python via `ast`, JS/TS via tree-sitter; already runs on every file, every analysis |
| Tree-sitter grammars | `fingerprint.py:31-32`, `complexity.py:44-49` | Python, JS, TS, TSX only |

**T15 is the load-bearing prerequisite.** Once an import specifier is tied to a resolved target file,
a call to that name has a known home. Without it, every cross-file call is a guess.

### What it still needs

- **Python extraction.** Walk each `ast.FunctionDef` / `ast.AsyncFunctionDef` body for `ast.Call`.
  Resolve the callee three ways: a symbol defined in the same file, a name that matches an import
  specifier (→ that import's resolved target file), or unknown. Record `(caller_symbol,
  callee_symbol, callee_file | None, line)`.
- **JS/TS extraction.** A tree-sitter query for `call_expression`, with each match attributed to its
  enclosing `function_declaration` / `method_definition` / arrow function, then the same three-way
  resolution. Note the existing structure query captures declarations only, so this is new.
- **Storage and payload.** Call edges are far more numerous than file edges, so they do **not**
  belong on the cached analysis result the way Phase 3's symbols do (see `Plan.md` Phase 3 payload
  note). Expect a dedicated endpoint or a separate cache entry, with per-file and per-symbol caps.
- **UI shape.** The graph is only partially known, so the interface must present "calls we found",
  never "all calls" — otherwise absence reads as proof there is no caller.

### Hard parts, honestly

- **Dynamic dispatch**: `obj.method()`, `self.handler()`, dict-of-callables, `getattr`.
- **Higher-order functions**: callbacks, decorators, dependency injection (FastAPI `Depends` is used
  heavily in this codebase and hides the call edge entirely).
- **Re-exports and barrels**: `export * from`, `__init__.py` re-exports, index files.
- **Same-name collisions**: two files defining `handle()`; resolution needs the import binding, not
  the bare name.

Plan for precision over recall: a missing edge is a gap, a fabricated edge is a lie that makes the
whole diagram untrustworthy.

### Acceptance criteria

Run against this repo itself:

- `routes/analyze.py::analyze` shows calls to `clone_repo`, `traverse_repo` and `save_analysis`.
- `indexer.py::index_repository` shows a call to `_flush_batch`, with correct line numbers.
- No edge points at a symbol that does not exist.
- A file in an unsupported language contributes no edges and no errors.
- Measured precision on a hand-checked sample of 50 edges ≥ 95%; recall is reported, not gated.

### Rough effort

Human ~1 week / CC ~3-4 hours, dominated by resolution and its tests rather than extraction.

### Where to start

1. `rune/fingerprint.py:209` (`_python_structure_signature`) — the existing Python AST walk to extend.
2. `rune/fingerprint.py:38-75` — the tree-sitter structure queries to extend for JS/TS.
3. `rune/analyzer.py:833-841` — how resolved edges are already constructed; call edges should mirror this shape.

---

## 2. Other deferred work (index)

Recorded in full in `Plan.md`; listed here so this file is the single place to look.

| Item | Why deferred | Recorded at |
|---|---|---|
| Orphan vector reclamation (T5) | Planned mechanism can't reclaim anything; leak is capped by the embedding ceiling until E2 removes it | `Plan.md:187-194, 417-420` |
| Separate worker process / job queue | Correct end state, wrong stage; the pipeline module is the seam | `Plan.md:373` |
| Second embedding vendor (Mistral) | ~1 req/sec ceiling, and cross-model score merge is unsound without RRF | `Plan.md:374` |
| Multi-partition retrieval merge | Cosine scores across models are not comparable | `Plan.md:375` |
| Per-user embedding quota | Pre-traction; the global budget is the binding constraint | `Plan.md:377` |
| Alerting and dashboards | Metrics are emitted; wiring alerts is premature with no on-call | `Plan.md:378` |
| Root cause of the large-repo 500 | Proven not to be indexing; needs the actual traceback | `Plan.md:379` |
| Python 3.13 / 3.12 pin mismatch | Pre-existing; becomes load-bearing when local embedding ships | `Plan.md:380` |
| Incremental analysis is dead code | Fingerprints are keyed by the per-clone `repo_id`, so SKIP and PARTIAL_UPDATE can never fire | `Plan.md:381` |
| Query-embed failures look like "no context" | `vectorstore.search()` returns `[]` when the query embedding fails | `Plan.md:382` |
