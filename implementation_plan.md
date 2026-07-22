# Fix Architecture Diagram — Step-by-Step Changes

## Root Causes (Quick Reference)

| # | Bug | Location |
|---|---|---|
| 1 | All nodes hardcoded to `type: "module"` → single swim-lane | [visualize.py L203](file:///Applications/Projects/CodeKavi/backend/codekavi/routes/visualize.py#L203) |
| 2 | Flat/single-dir repos → 1 node, 0 edges | [graph.py L587](file:///Applications/Projects/CodeKavi/backend/codekavi/graph.py#L587), [orchestrator.py L679](file:///Applications/Projects/CodeKavi/backend/codekavi/orchestrator.py#L679) |
| 3 | `@/` and `~/` path aliases → 0 resolved edges | [analyzer.py L367](file:///Applications/Projects/CodeKavi/backend/codekavi/analyzer.py#L367) |
| 4 | Fallback paths also hardcode `type: "module"` | [visualize.py L236](file:///Applications/Projects/CodeKavi/backend/codekavi/routes/visualize.py#L236), [orchestrator.py L688](file:///Applications/Projects/CodeKavi/backend/codekavi/orchestrator.py#L688) |

### Role → Layer Mapping (used in multiple changes)

| Classifier Role | → Architecture Layer |
|---|---|
| `entry_point`, `router` | `routes` |
| `orchestrator`, `core_module`, `ml_pipeline`, `ml_training` | `services` |
| `ml_model`, `type_definition` | `models` |
| `data` | `database` |
| `shared_utility`, `internal_helper` | `utils` |
| `config` | `config` |
| `test` | `tests` |
| `barrel`, `leaf`, `build`, `documentation` | `other` |

---

## Change 1 — Extend `detect_layer()` patterns

**File:** [config.py](file:///Applications/Projects/CodeKavi/backend/codekavi/config.py#L246-L265)

**What to do:**
Update the `checks` list inside `detect_layer()` to recognize more modern directory/file patterns, and align return values with the frontend's `layerColors` keys.

**Current code (L252-264):**
```python
checks = [
    (["route", "controller", "api", "endpoint"], "api"),
    (["model", "schema", "entity"], "model"),
    (["service", "logic", "handler", "pipeline", "rag"], "service"),
    (["db", "database", "repo", "migration"], "database"),
    (["util", "helper", "lib", "common"], "utility"),
    (["config", "setting", "constant"], "config"),
    (["component", "page", "layout", "ui", "css", "style", "theme"], "frontend"),
    (["test", "spec"], "test"),
]
```

**Change to:**
```python
checks = [
    (["route", "controller", "api", "endpoint", "view", "screen", "page"], "routes"),
    (["model", "schema", "entity", "type", "interface", "dto"], "models"),
    (["service", "logic", "handler", "pipeline", "rag", "middleware", "orchestrat"], "services"),
    (["db", "database", "repo", "migration", "prisma", "drizzle", "sequelize"], "database"),
    (["util", "helper", "lib", "common", "shared", "tool", "script", "cli"], "utils"),
    (["config", "setting", "constant", "env"], "config"),
    (["component", "layout", "ui", "css", "style", "theme", "hook", "composable",
      "store", "redux", "zustand", "state", "asset", "static", "public"], "frontend"),
    (["test", "spec", "__test__", "__spec__"], "tests"),
]
```

> [!IMPORTANT]
> Return values changed: `"api"` → `"routes"`, `"model"` → `"models"`, `"service"` → `"services"`, `"utility"` → `"utils"`, `"test"` → `"tests"`. These must match the frontend's `layerColors` keys in `ArchitectureGraph.tsx`. Check if any other backend code references the old return values (e.g., `"api"`, `"utility"`) and update those callers too.

**Expected outcome:** `detect_layer()` now returns layer names that directly match the frontend swim-lane keys.

---

## Change 2 — Add `ROLE_TO_LAYER` mapping & `build_semantic_module_graph()` to graph.py

**File:** [graph.py](file:///Applications/Projects/CodeKavi/backend/codekavi/graph.py)

**What to do:**
Add a new constant and a new function that groups files by their classifier role into architectural layers (instead of by directory).

**Add at module level** (after the existing `_ROLE_TIER_TYPE` dict around L611):

```python
# Maps classifier roles to architecture swim-lane layer names.
ROLE_TO_LAYER: dict[str, str] = {
    "entry_point": "routes",
    "router": "routes",
    "orchestrator": "services",
    "core_module": "services",
    "ml_pipeline": "services",
    "ml_training": "services",
    "ml_model": "models",
    "type_definition": "models",
    "data": "database",
    "shared_utility": "utils",
    "internal_helper": "utils",
    "config": "config",
    "test": "tests",
    "barrel": "other",
    "leaf": "other",
    "build": "other",
    "documentation": "other",
}
```

**Add new function** `build_semantic_module_graph()`:

- Groups all `file_profiles` by their architecture layer (via `ROLE_TO_LAYER[profile["role"]]`, defaulting to `"other"`)
- For each layer group, creates a node:
  - `id`: layer name (e.g., `"routes"`)
  - `label`: layer name + directory context + file count (e.g., `"routes — api/ — 5 files"` if all files share a common parent dir, otherwise `"routes — 5 files"`)
  - `type`: the layer name itself (e.g., `"routes"`) — **NOT** `"module"`
- Computes cross-layer edges from `dep_data["adjacency"]`: if file A (in layer X) imports file B (in layer Y) and X ≠ Y, add/increment an edge from X → Y
- Returns the same shape as `build_module_graph()`:
  ```python
  {
      "modules": [...],
      "connections": [...],
      "internal_edges": {...},
      "graph_json": {"nodes": [...], "edges": [...]},
      "mermaid": "...",
  }
  ```

> [!NOTE]
> Keep `build_module_graph()` unchanged — it's still used by the dependency graph view.

**Expected outcome:** A reusable function that produces correctly-typed architecture nodes grouped by semantic role.

---

## Change 3 — Fix `visualize_architecture()` endpoint in visualize.py ✅ DONE

**File:** [visualize.py](file:///Applications/Projects/CodeKavi/backend/codekavi/routes/visualize.py#L178-L241)

**What to do:**
Rewrite the `visualize_architecture()` endpoint to use `build_semantic_module_graph()` instead of hardcoding `type: "module"`.

**Replace the primary path (lines 190-207):**

```python
result, _ = await _load_repo(repo_id, cache)

from codekavi.graph import build_semantic_module_graph

dep_data = result.get("dep_data", {})
file_profiles = result.get("file_profiles", [])

semantic_graph = build_semantic_module_graph(dep_data, file_profiles)
graph_json = semantic_graph["graph_json"]
viz_nodes = graph_json["nodes"]    # already has correct layer types
viz_edges = graph_json["edges"]
```

**Fix the adjacency fallback (lines 209-224):** This path already uses `_detect_layer(src)` — it's fine, just verify it uses the updated return values from Change 1.

**Fix the final fallback (lines 226-236):** Replace `"type": "module"` with `_detect_layer(mod)`:
```python
viz_nodes = [
    {"id": mod, "label": mod, "type": _detect_layer(mod)}
    for mod in sorted(module_counts)
][:40]
```

**Add diagnostics to the response:**
```python
diagnostics = _build_diagnostics(dep_data, file_profiles, edge_count=len(viz_edges), node_count=len(viz_nodes))

return {
    "type": "architecture_graph",
    "data": {"nodes": viz_nodes, "edges": viz_edges, "diagnostics": diagnostics},
}
```

**Expected outcome:** The `/api/visualize/architecture/{repo_id}` endpoint returns nodes with correct layer types, producing multi-lane architecture diagrams.

---

## Change 4 — Fix `_auto_viz_architecture()` in orchestrator.py ✅ DONE

**File:** [orchestrator.py](file:///Applications/Projects/CodeKavi/backend/codekavi/orchestrator.py#L673-L717)

**What to do:**
Replace the 44-line inline directory grouping method with a call to the shared `build_semantic_module_graph()`.

**Replace the entire `_auto_viz_architecture()` method (lines 673-717):**

```python
def _auto_viz_architecture(self) -> dict:
    """Build module-level architecture graph from file classifications."""
    from codekavi.graph import build_semantic_module_graph

    semantic = build_semantic_module_graph(
        dep_data=self.analysis,
        file_profiles=self.classification or [],
    )
    return semantic["graph_json"]
```

**Expected outcome:** The report view's embedded architecture diagram uses the same semantic grouping as the visualize tab. Both paths are consistent.

---

## Change 5 — Add path alias resolution to analyzer.py ✅ DONE

**File:** [analyzer.py](file:///Applications/Projects/CodeKavi/backend/codekavi/analyzer.py)

**What to do:**
Resolve `@/` and `~/` import paths using `tsconfig.json` / `jsconfig.json` so that modern JS/TS projects produce edges.

**Step 5a — Add `_load_path_aliases()` function:**

```python
_alias_cache: dict[str, dict[str, str]] = {}

def _load_path_aliases(repo_root: str) -> dict[str, str]:
    """Parse tsconfig.json/jsconfig.json to resolve path alias prefixes."""
    if repo_root in _alias_cache:
        return _alias_cache[repo_root]

    aliases: dict[str, str] = {}
    for config_name in ("tsconfig.json", "jsconfig.json"):
        config_path = os.path.join(repo_root, config_name)
        if not os.path.isfile(config_path):
            continue
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                raw = f.read()
            # Strip JS-style comments (tsconfig allows them)
            import re
            raw = re.sub(r"//.*?$", "", raw, flags=re.MULTILINE)
            raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
            config = json.loads(raw)
            compiler_opts = config.get("compilerOptions", {})
            base_url = compiler_opts.get("baseUrl", ".")
            paths = compiler_opts.get("paths", {})
            for alias_pattern, targets in paths.items():
                if not targets:
                    continue
                # e.g. "@/*" -> ["src/*"]
                alias_prefix = alias_pattern.rstrip("*")     # "@/"
                target_prefix = targets[0].rstrip("*")       # "src/"
                resolved = os.path.normpath(os.path.join(repo_root, base_url, target_prefix))
                aliases[alias_prefix] = resolved
            break  # use the first config found
        except Exception as e:
            logger.debug(f"Failed to parse {config_name}: {e}")

    _alias_cache[repo_root] = aliases
    return aliases
```

**Step 5b — Modify `_resolve_js_path()`** — add `path_aliases` parameter:

At [line 367-368](file:///Applications/Projects/CodeKavi/backend/codekavi/analyzer.py#L367-L368), before returning `None`, check aliases:

```python
def _resolve_js_path(
    import_path: str, file_dir: str, repo_root: str,
    known_files: set[str] | None = None,
    path_aliases: dict[str, str] | None = None,  # NEW
) -> str | None:
    # Check path aliases BEFORE rejecting non-relative imports
    if path_aliases and not import_path.startswith(".") and not import_path.startswith("/"):
        for alias_prefix, resolved_dir in path_aliases.items():
            if import_path.startswith(alias_prefix):
                rewritten = os.path.join(resolved_dir, import_path[len(alias_prefix):])
                # Recursively resolve as a relative path from repo root
                return _resolve_js_path(
                    "./" + os.path.relpath(rewritten, file_dir),
                    file_dir, repo_root, known_files, None  # no aliases in recursion
                )

    # Skip node_modules / bare specifiers
    if not import_path.startswith(".") and not import_path.startswith("/"):
        return None  # external package
    # ... rest unchanged
```

**Step 5c — Thread aliases through `analyze_dependencies()`:**

In the JS/TS extraction code path, load aliases once and pass them:
```python
path_aliases = _load_path_aliases(repo_root)
# ... then in every _resolve_js_path() call:
resolved = _resolve_js_path(import_path, file_dir, repo_root, known_files, path_aliases)
```

**Expected outcome:** Imports like `@/components/Button` resolve to `src/components/Button.tsx`, producing edges that connect the architecture graph.

---

## Change 6 — Add `frontend` layer to ArchitectureGraph.tsx ✅ DONE

**File:** [ArchitectureGraph.tsx](file:///Applications/Projects/CodeKavi/frontend/components/report/viz/ArchitectureGraph.tsx)

**What to do:**

1. Add `"frontend"` to the `layerColors` map (around line 35):
   ```ts
   frontend: { bg: "#2d1a3a", border: "#f472b6", text: "#f9a8d4" },
   ```

2. Add `"frontend"` to the `layerOrder` array (line 52):
   ```ts
   const layerOrder = ["routes", "services", "models", "database", "utils", "config", "tests", "frontend", "module", "other"];
   ```

**Expected outcome:** Frontend-related nodes (components, hooks, styles, stores) get their own pink/magenta swim-lane instead of falling into "other".

---

## Change 7 — Improve empty-state messaging in VizContainer.tsx ✅ DONE

**File:** [VizContainer.tsx](file:///Applications/Projects/CodeKavi/frontend/components/report/viz/VizContainer.tsx)

**What to do:**

1. Update the `hasEdgelessNodes` message for `architecture_graph` to be more specific:
   ```tsx
   <EmptyViz message="Modules detected but no connections resolved. This project may use path aliases (@/, ~/) or only import external packages. Try the Dependency Graph for file-level detail." />
   ```

2. If `data.diagnostics` exists, pass it to `DiagnosticsBanner` so the user sees resolution rate info.

**Expected outcome:** Users get actionable guidance when the architecture graph can't show connections, instead of a generic message.

---

## Summary — Execution Order

| Change | File | Fixes | Can be tested independently? |
|---|---|---|---|
| **1** | `config.py` | Layer name alignment | ✅ Yes — run existing tests |
| **2** | `graph.py` | New semantic grouping function | ✅ Yes — unit test the new function |
| **3** | `visualize.py` | Visualize tab architecture endpoint | ✅ Yes — test via API call |
| **4** | `orchestrator.py` | Report view architecture diagram | ✅ Yes — test via report generation |
| **5** | `analyzer.py` | Path alias resolution | ✅ Yes — test with a `@/`-heavy repo |
| **6** | `ArchitectureGraph.tsx` | Frontend swim-lane for "frontend" | ✅ Yes — visual check |
| **7** | `VizContainer.tsx` | Better empty-state messages | ✅ Yes — visual check |

> [!TIP]
> **Recommended order:** 1 → 2 → 3 → 4 → 6 → 7 → 5. Changes 1–4 fix the core bug (single "module" block). Change 5 (path alias resolution) is independent and can be done last.
