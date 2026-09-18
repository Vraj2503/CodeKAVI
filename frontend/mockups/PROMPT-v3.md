# Knowledge Graph — mockup brief (v3)

Design the **Knowledge Graph** view for CodeKavi, a tool that reads a Git repo and
explains it. The backend for this view is finished; nothing is drawn yet. I want
mockups to decide what to build.

Produce **four distinct directions, one self-contained HTML file each** (inline CSS
+ vanilla JS, no CDN, no build step, opens from `file://`). Hardcode realistic fake
data in the exact shape below — roughly 25 groups, ~60 symbols in the drill-down,
8 concept entities. Dark theme, viewport-filling, `1440×900`.

---

## What the view is

Every other graph in this product is file-to-file: `a.py imports b.py`. This one
works one level down — **functions and classes are nodes, calls and inheritance are
edges**. On this codebase that is 665 nodes and 806 edges, which is a hairball, so
the payload ships **two tiers** and the design has to make the relationship between
them obvious:

- **Overview** — one node per *file*, symbols collapsed into it, call counts
  aggregated onto the arrows between files (`groups` / `group_edges`). This is the
  default view. ~25 boxes.
- **Drill-down** — the individual symbols inside one group and the calls between
  them (`nodes` / `edges`). Reached by opening a group.

Ranking symbols and keeping the top 25 was tried and abandoned: it left 7 of 806
edges standing, because the arrows ran through the mid-tier functions the cut
removed. Collapsing is what makes it legible. Two thirds of all edges are
intra-file, so they live *inside* a group and are never drawn at the overview tier.

A third, optional layer sits on top: an **LLM concept overlay** naming what the repo
is *about* ("Repository", "Analysis Cache", "Quota") with each concept grounded in
real symbol ids. It arrives separately, may be absent, and may fail — design for all
three states.

---

## Data contract (exact field names — the payload is real)

`GET /visualize/knowledge/{repo_id}` → `{ "type": "knowledge", "data": { ... } }`
`GET /visualize/knowledge/{repo_id}?file=rune/cache.py` → same shape, narrowed to
one group's insides.
`POST /visualize/knowledge/{repo_id}` with `{"use_llm": true}` → same, plus
`concepts`. Billed, slow (a few seconds), cached after the first call.

```jsonc
{
  // ── Overview tier ──
  "groups": [{
    "id": "rune/cache.py",          // file path, also the node id
    "label": "cache.py",
    "file": "rune/cache.py",
    "role": "core_module",          // see roles below
    "importance": 87.4,             // arbitrary scale, compare within a repo only
    "symbol_count": 23,
    "top_symbols": ["AnalysisCache", "get_cache", "set"],  // fan-in order, max 3
    "effects": ["cache", "filesystem"],                    // rolled up from symbols
    "routes": ["POST /analyze"],                           // rolled up, often []
    "drawn": true                   // ← up to 120 groups ship; ~25 are drawn
  }],
  "group_edges": [
    { "source": "rune/routes/analyze.py", "target": "rune/cache.py", "weight": 12 }
  ],

  // ── Drill-down tier ──
  "nodes": [{
    "id": "rune/cache.py::AnalysisCache",   // "path::name"
    "label": "AnalysisCache",
    "type": "class",                        // function | class | method
    "file": "rune/cache.py",
    "line": 41,
    "loc": 180,                             // end_line - line
    "doc": "Redis-backed store for analysis results.",   // may be null
    "signature": "(redis_url: str, ttl: int = 3600)",    // may be null
    "is_async": false,
    "http": "POST /analyze",                // from a route decorator, usually null
    "external_calls": ["json.loads", "hgetall", "setex"], // max 8, unresolved names
    "effects": ["cache", "network"],
    "in_degree": 9,                         // measured on the WHOLE repo…
    "out_degree": 4,                        // …not on the visible subgraph
    "role": "core_module",
    "importance": 87.4
  }],
  "edges": [
    { "source": "rune/…::run", "target": "rune/…::helper", "label": "calls" }  // calls | inherits
  ],

  // ── Optional LLM overlay ──
  "concepts": {
    "entities": [{
      "id": "entity:analysis-cache",
      "name": "Analysis Cache",
      "summary": "Stores completed repo analyses so a second visit costs nothing.",
      "symbols": ["rune/cache.py::AnalysisCache", "rune/cache.py::get_cache"],
      "files": ["rune/cache.py", "rune/routes/analyze.py"]
    }],
    "relations": [
      { "source": "entity:analysis-cache", "target": "entity:repository", "label": "stores" }
    ],
    "metadata": {
      "is_llm_enriched": true,
      "chunks": 6,
      "dropped_ungrounded": 3,     // concepts the model invented, discarded
      "fallback_reason": null      // "llm_failed" | "no_symbols" | null
    }
  },

  "metadata": {
    "total_symbols": 665,
    "total_groups": 47,
    "drawn_groups": 25,
    "group_selection": "adaptive", // adaptive | fixed | llm  ← see below
    "resolved_calls": 806,
    "unresolved_calls": 291,
    "is_truncated": true,
    "truncated_count": 515,        // symbols measured but not drawn
    "unsupported_languages": ["Go", "Ruby"]   // code we could not parse at all
  },
  "diagnostics": {
    "node_count": 150, "edge_count": 806,
    "group_count": 25, "group_edge_count": 88,
    "resolution_rate": 0.735,      // resolved / attempted
    "unsupported_languages": ["Go", "Ruby"]
  }
}
```

**Enumerations, all of which want visual encoding:**

- `role`: `core_module`, `shared_utility`, `internal_helper`, `leaf`, `test`,
  `orchestrator`, `entry_point`, `router`, `config`
- `effects`: `filesystem`, `network`, `db`, `cache`, `llm`, `subprocess`,
  `concurrency`
- `type`: `function`, `class`, `method` · `edge.label`: `calls`, `inherits`

---

## The design problems I actually want solved

1. **Two tiers, one mental model.** Opening a group must not feel like a different
   page. Show me the transition — zoom, split pane, inline expansion, side panel;
   pick one per direction and commit.
2. **`drawn` is a selection, not a filter.** ~25 of up to 120 groups are drawn by
   default; the count is derived from the importance falloff, so it differs per
   repo. The other 95 are *in the payload*. How does a reader learn they exist and
   pull one in? And `group_selection: "llm"` means the concept pass re-picked the
   selection — the view should say so.
3. **Honest truncation.** `is_truncated: true`, `truncated_count: 515`,
   `resolution_rate: 0.735`, `unsupported_languages: ["Go", "Ruby"]`. A graph that
   silently shows a third of a repo while looking complete is the failure this data
   exists to prevent. It must be legible without becoming an apology banner that
   dominates the screen. Note `in_degree`/`out_degree` are repo-wide, so a node can
   read "9 callers" with 2 arrows touching it — that gap needs explaining in situ.
4. **Density that survives real numbers.** 25 boxes / ~88 weighted arrows at the
   overview; ~60 nodes / ~200 arrows in a drill-down. Show the direction working at
   full density, not with six pretty nodes.
5. **The evidence is the point.** `doc`, `signature`, `http`, `effects`,
   `external_calls` are the difference between a shape and an explanation. Design
   the symbol inspector as carefully as the canvas — `POST /analyze`, `async`,
   `effects: llm, cache` and `calls: json.loads, setex` tell a reader what a function
   *does* faster than any arrow does.
6. **Three concept states.** Not requested (button to run it, billed), present
   (overlay), failed (`fallback_reason`, graph still fully usable). The overlay is
   grounded — clicking "Analysis Cache" should light its symbols and files.

---

## Design tokens (use these; HSL triples for `hsl(var(--x))`)

```css
--background: 30 9% 6%;      --foreground: 40 18% 94%;
--card: 30 8% 9%;            --muted: 30 6% 14%;
--muted-foreground: 36 8% 62%; --border: 32 7% 19%;
--signal: 34 96% 56%;        --destructive: 2 72% 58%;  --success: 148 52% 52%;
--viz-cat-1: 212 100% 67%;   --viz-cat-2: 129 49% 49%;  --viz-cat-3: 266 100% 77%;
--viz-cat-4: 26 85% 59%;     --viz-cat-5: 328 89% 72%;  --viz-cat-6: 209 100% 74%;
--viz-cat-7: 126 50% 45%;    --viz-cat-8: 267 80% 70%;
--viz-edge: 32 7% 19%;       --radius: 0.5rem;
```

Warm near-black, amber as the single accent. `system-ui`. The app is Next 16 +
Tailwind 3 + d3 + elkjs + framer-motion, so any layout d3-force or ELK can do is
buildable — assume that budget, no more.

---

## Constraints

- Dark only. No logos, no fake repo branding, no lorem ipsum — use plausible
  Python module and function names.
- Interactive enough to judge: hover, select, open a group, toggle the overlay.
  Static screenshots of four layouts are not enough.
- Don't invent backend fields. If a direction needs data that isn't in the contract
  above, say so in a comment at the top of the file instead of faking it.
- Four **genuinely different** answers to problem 1 and 2 — not one layout in four
  color schemes.
