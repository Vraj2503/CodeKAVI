# Architecture Diagram V2 — Implementation Specification

## Status and objective

Implement a new architecture diagram that replaces the existing file/import-based architecture graph.

The outcome must let a reader understand a repository's major runtime flow, responsibilities, data stores, and specific third-party services in under one minute. It must not use source filenames as visible node labels.

This is a replacement of the existing architecture visualization, not a cosmetic change to it.

## Non-negotiable product requirements

1. **Use responsibility-level node labels.**

   Visible labels describe the job performed, for example `Repository Analysis Pipeline`, `RAG Chat Service`, or `API & Access Control`.

   Do **not** render filenames, directories, class names, or module paths as architecture node labels. File paths remain available only in an inspector as evidence.

2. **Name concrete technologies explicitly.**

   When the repository evidences a service, product, or model, name it visibly. Examples:

   - `Supabase — Auth & Postgres`
   - `Redis — Cache, Rate Limits & Locks`
   - `Zilliz Cloud — Milvus`
   - `Cloudflare Workers AI — BGE Large`
   - `Groq — Llama 3.3`
   - `Google Gemini`

   Do not invent a vendor or model name. If a provider is detected but its model is not statically declared, use a truthful label such as `OpenAI — model not declared`.

3. **Label every visible cross-group connection with a short verb phrase.**

   Good examples: `Validates JWT`, `Stores vectors`, `Searches code context`, `Embeds query`, `Streams response`.

   Never use import counts or source filenames as architecture-edge labels.

4. **Use a left-to-right, orthogonal layout.**

   All overview diagrams use 90-degree, obstacle-aware edges. A clean diagram is more important than allowing arbitrary free positioning.

5. **Show only source-backed runtime facts.**

   An import is not automatically a runtime interaction. Do not claim that two components communicate unless routes, SDK calls, effects, configuration, symbols, or other evidence support it.

6. **Do not surface secrets.**

   Source evidence may include safe configuration-variable names such as `GROQ_API_KEY`; it must never include values, access tokens, connection strings, or source code that could contain secrets.

## Current implementation to replace

The current standalone architecture endpoint is file-level:

- `backend/rune/routes/visualize.py` — `GET /visualize/architecture/{repo_id}`
- `frontend/components/report/viz/ArchitectureGraph.tsx`

It emits one node per file and uses import edges. This creates filename labels, non-runtime links, and congested cross-lane connections.

The report-generation path currently creates a different semantic architecture shape:

- `backend/rune/orchestrator.py` — `_auto_viz_architecture`
- `backend/rune/graph.py` — `build_semantic_module_graph`

Both paths must be replaced with one source of truth: an `architecture.v2` manifest builder.

## Architecture diagram design

### Default regions

Render only regions for which the repository has evidenced nodes. Preserve this order:

```text
Actors & Clients → Entry & Delivery → Application Capabilities
                                           ↓
                                  State & Infrastructure
                                           →
                                  External Services
```

Recommended group IDs:

- `actors`
- `client`
- `entry`
- `application`
- `async`
- `state`
- `external`

### Overview density budget

The overview has strict limits:

- maximum **18 visible nodes**;
- maximum **26 visible, labelled edges**;
- maximum **6 visible external services**;
- maximum **one line per edge label**, ideally one to four words.

When the source graph exceeds these limits, preserve the most important runtime path and collapse remaining components into a visible summary node, for example `+ 7 supporting components`.

Never silently drop a capability. Record collapsed components in the response and show them in the inspector.

### Node categories

Use these categories consistently:

- `actor`
- `client`
- `gateway`
- `service`
- `worker`
- `datastore`
- `queue`
- `external`
- `compute`
- `collapsed`

Node cards should show:

1. role-based label;
2. concise responsibility summary;
3. named technology badges when relevant;
4. confidence/inferred state only when it is not fully verified.

### Edge categories

Use one of:

- `http`
- `sse`
- `websocket`
- `rpc`
- `sdk`
- `database`
- `cache`
- `queue`
- `event`
- `filesystem`
- `internal`
- `auth`

Response arrows should generally not be drawn as a second reverse edge. Include the response in a single forward label where needed, for example `Requests analysis / receives SSE`. This avoids cycles and visual clutter.

## Layout and congestion requirements

### Required layout algorithm

Use ELK layered layout with a left-to-right direction and orthogonal routing.

Required implementation behavior:

- use a layered directed acyclic backbone for initial placement;
- configure `RIGHT` direction;
- configure orthogonal edge routing;
- use fixed-side or fixed-order ports;
- reserve larger gaps between groups than between nodes in the same group;
- place external services on the right boundary and state stores below or adjacent to their primary consumers;
- route edges through dedicated channels between groups;
- use the bend points returned by ELK, not React Flow's default Bézier or default straight edge.

### Custom edge renderer

Implement an `ArchitectureEdge` component that draws the ELK route sections as SVG polyline paths.

The edge data must include the routed point sequence. The renderer must:

- draw only orthogonal segments;
- render arrowheads at the final segment;
- place a label on the first available long horizontal segment;
- avoid label-to-node and label-to-label overlap;
- never run through an unrelated node;
- dim non-selected edges on hover/focus;
- show inferred edges only when the user opts in.

### Label-placement pass

After ELK placement, run a label-placement pass.

1. Measure each label.
2. Evaluate candidate horizontal segments on its routed edge.
3. Reserve a bounding box for the first collision-free candidate.
4. If no collision-free position exists, try a lower-priority route channel.
5. If placement still fails, collapse that secondary edge into the node inspector and include it in the `collapsed` response metadata.

Never paint a label over a node or another label.

### Node positioning and interaction

The default graph is locked to preserve a clean layout. Users can pan, zoom, fit view, inspect, focus a path, and expand collapsed components.

If user positioning is supported, expose it as an explicit **Rearrange** mode:

- snap nodes to the grid;
- prevent node-to-node overlap;
- rerun orthogonal routing after movement;
- provide `Reset layout`;
- never make manual dragging the default behavior.

## Backend implementation

### New modules and responsibilities

Create a new architecture-manifest pipeline. Suggested modules:

- `backend/rune/architecture.py` — evidence collection, node clustering, edge construction, filtering, and manifest assembly;
- `backend/rune/architecture_models.py` or additions to `backend/rune/pipeline_models.py` — strict Pydantic models for request/response data;
- `backend/rune/architecture_rules.py` — technology/provider detection rules and role naming rules;
- `backend/rune/architecture_prompt.py` only if optional LLM enrichment is implemented.

Avoid adding this logic to `routes/visualize.py`; that file should remain a thin HTTP adapter.

### Evidence collection

Use existing analysis results where possible:

- dependency graph;
- file profiles and role classification;
- symbol graph, especially HTTP routes, external calls, and side effects;
- repository tree and languages;
- known entry points;
- existing module graph.

Add safe parsing for:

- package manifests and lockfiles;
- `pyproject.toml`, `requirements*.txt`, `package.json`, and comparable manifests;
- `Dockerfile`, Docker Compose, deployment/IaC files, and build files;
- example environment files and configuration references;
- source-level SDK initialisation, endpoint URLs, queue clients, cache clients, database clients, and model declarations.

The collector must create evidence records with a relative file path, optional line range, evidence type, and a confidence score.

### Technology catalog

Implement a maintained technology catalog that maps package imports, client types, URL patterns, and configuration names to a provider, product, role, and optional model extraction rule.

Initial catalog must cover at least:

- Supabase;
- PostgreSQL;
- Redis;
- MongoDB;
- MySQL;
- Zilliz/Milvus;
- Pinecone;
- Qdrant;
- Chroma;
- AWS S3, SQS, SNS, Lambda, and EventBridge;
- Cloudflare Workers AI;
- OpenAI;
- Anthropic;
- Google Gemini;
- Groq;
- Ollama;
- Kafka;
- RabbitMQ;
- GitHub, GitLab, and Bitbucket.

Catalog matches are evidence, not assumptions. Multiple pieces of evidence can increase confidence; no match may be shown as an `unknown_external` only if a direct network endpoint or client call is truly detected.

### Responsibility-node construction

Build nodes from runtime responsibilities, not files. A node needs:

- stable semantic ID;
- role-based label;
- category and group;
- one-sentence summary;
- ordered technologies;
- source evidence;
- confidence;
- importance score for overview selection.

Use deterministic clustering first, based on route handlers, worker entry points, runtime effects, technology use, and dependency neighborhoods.

Examples of valid cluster labels:

- `Authentication & Session Management`
- `Checkout Processing`
- `Document Ingestion Pipeline`
- `Embedding & Indexing Service`
- `Repository Analysis Pipeline`
- `Notification Worker`

Examples of invalid labels:

- `main.py`
- `routes/auth.py`
- `utils`
- `services folder`
- `Node 4`

### Runtime-edge construction

Build an edge only when evidence supports a runtime relationship.

Examples:

- route handler calls service → `Processes request` (`internal`);
- service creates a Supabase client → `Reads sessions` or `Persists analysis` (`database`/`sdk`);
- indexer calls an embedding API → `Embeds code chunks` (`sdk`);
- worker publishes to a queue → `Publishes job` (`queue`);
- an HTTP client calls a provider → `Generates answer` (`http`/`sdk`).

If source code proves a dependency but not an operation, prefer a lower-detail internal edge such as `Coordinates` only when the relation is meaningful. Otherwise keep the relation in inspector evidence instead of drawing it.

### Optional LLM enrichment

Static analysis is the default and must require no model call.

An optional, user-triggered enrichment pass may improve responsibility names, summaries, and edge verbs. It must:

- accept a bounded evidence digest only;
- use strict JSON schema validation;
- be quota-gated;
- only rename or merge source-backed items;
- never add an unproven service, provider, model, or edge;
- fall back to the static manifest on error or invalid JSON.

### Analysis-time caching

Build and store the static architecture evidence/manifest during repository analysis, after the dependency, classification, and symbol-graph stages are available.

Cache view-specific responses using:

```text
repo_id + analysis_version + architecture_schema_version + canonical_request_hash
```

This prevents an overview, request-flow view, and integrations view of the same repository from overwriting one another.

## API contract

### Endpoint

Add the versioned endpoint:

```http
POST /api/visualize/architecture/{repo_id}
Authorization: Bearer <Supabase JWT>
Content-Type: application/json
```

Use POST because the diagram has legitimate, typed configuration and view-selection inputs. Maintain the existing GET endpoint only during migration; do not add further features to it.

### Universal request payload

Use this payload for the default architecture diagram of any repository:

```json
{
  "schema_version": "architecture.v2",
  "view": "overview",
  "detail": "standard",
  "include": {
    "actors": true,
    "entry_points": true,
    "application_capabilities": true,
    "state": true,
    "async_infrastructure": true,
    "external_integrations": true,
    "technology_products": true,
    "model_names": true,
    "edge_labels": true,
    "evidence": "inspector_only"
  },
  "layout": {
    "direction": "LR",
    "routing": "orthogonal",
    "max_nodes": 18,
    "max_edges": 26,
    "collapse_supporting_components": true
  },
  "enrichment": {
    "mode": "static"
  }
}
```

The backend must reject unknown request fields, clamp server-side limits, and ignore any client request to expose secrets or raw source contents.

### View payloads for any repository

Use the same endpoint and evidence model for every repository. Only the `view` and optional focus change.

| Required diagram | `view` | Additional payload |
| --- | --- | --- |
| Main system view | `overview` | None |
| Request journey | `request_flow` | `"focus": { "entrypoint_id": "<id from available_focuses>" }` |
| External products and AI tools | `integration_map` | `"detail": "expanded"` |
| Storage lifecycle | `data_lifecycle` | `"include": { "state": true, "external_integrations": false }` |
| Queue and event flow | `event_flow` | `"include": { "async_infrastructure": true }` |
| One capability | `component` | `"focus": { "node_id": "<semantic node id>" }` |

The client must use semantic IDs returned by `available_focuses`; it must not submit filenames as focus IDs.

### Required response payload

```json
{
  "type": "architecture_graph",
  "data": {
    "schema_version": "architecture.v2",
    "repository": {
      "repo_id": "abc123",
      "topology": "web_application",
      "confidence": 0.91
    },
    "groups": [
      {
        "id": "client",
        "label": "Client Experience",
        "order": 1,
        "kind": "client"
      }
    ],
    "nodes": [
      {
        "id": "rag-chat",
        "label": "RAG Chat Service",
        "kind": "service",
        "group_id": "application",
        "summary": "Retrieves repository context and produces answers.",
        "technologies": [
          {
            "vendor": "Cloudflare",
            "product": "Workers AI",
            "model": "BGE Large",
            "purpose": "query embeddings",
            "confidence": 0.98
          }
        ],
        "confidence": 0.96,
        "evidence": [
          {
            "path": "rune/routes/chat.py",
            "lines": [74, 205],
            "reason": "route and vector search"
          }
        ]
      }
    ],
    "edges": [
      {
        "id": "rag-chat-to-vector-store",
        "source": "rag-chat",
        "target": "zilliz-milvus",
        "label": "Searches code context",
        "kind": "database",
        "protocol": "Milvus SDK",
        "async": false,
        "confidence": 0.97,
        "evidence_count": 2
      }
    ],
    "collapsed": [
      {
        "id": "supporting-cache-components",
        "label": "+ 4 supporting components",
        "member_ids": ["..."],
        "reason": "overview_density_limit"
      }
    ],
    "available_focuses": [
      { "id": "analyze-request", "kind": "entrypoint", "label": "Analyze repository" }
    ],
    "diagnostics": {
      "status": "complete",
      "unsupported_languages": [],
      "excluded_low_confidence_edges": 3,
      "source_coverage": 0.88
    }
  }
}
```

Source paths and evidence records may appear only in the inspector/export details, never in the visible overview node label.

## Frontend implementation

### Required files

Refactor or create:

- `frontend/components/report/viz/ArchitectureGraph.tsx` — graph orchestration only;
- `frontend/components/report/viz/architecture/layout.ts` — ELK setup, placement, route sections, label placement;
- `frontend/components/report/viz/architecture/ArchitectureNode.tsx` — typed node cards;
- `frontend/components/report/viz/architecture/ArchitectureEdge.tsx` — orthogonal SVG path rendering;
- `frontend/components/report/viz/architecture/ArchitectureInspector.tsx` — evidence, technology, and connection details;
- `frontend/components/report/viz/architecture/types.ts` — frontend representation of the API contract;
- `frontend/lib/api.ts` — typed `architecture.v2` API call and response;
- `frontend/lib/mockData.ts` — updated mock payload;
- architecture-specific test files next to `ArchitectureGraph`.

### Consumers to update

Both consumer paths must render the same `architecture.v2` data:

- `frontend/components/report/viz/VizContainer.tsx`;
- `frontend/components/visualize/FocusedVisualization.tsx`;
- `backend/rune/orchestrator.py` for the report-stream architecture section;
- `frontend/lib/api.ts` request handling;
- any download/export implementation that serializes architecture diagrams.

### Interaction behavior

- Hover: isolate direct inbound/outbound edges and dim unrelated elements.
- Click: open a side inspector with summary, providers, products/models, edge list, confidence, and source evidence.
- Expand: reveal one collapsed semantic cluster at a time, then relayout.
- Focus path: show upstream/downstream runtime path for one selected node.
- Accessibility: keyboard focus for nodes and edges, accessible names, non-color cues, reduced-motion support.
- Responsive behavior: preserve a pannable canvas; do not compress cards or edge labels until they overlap.

## Tests and acceptance criteria

### Backend tests

Add repository fixtures for:

1. Next.js + FastAPI + Supabase + Redis + vector database + AI providers;
2. TypeScript event-driven worker with queue and scheduler;
3. Python CLI/library with no external services;
4. ML/RAG pipeline with explicit embedding and generation models;
5. repository with unsupported languages and ambiguous dependencies.

Assert that:

- visible labels contain no filenames or extensions;
- detected services/products/models are included only when evidenced;
- every returned edge has source evidence and a permitted runtime kind;
- no secret values appear;
- static mode triggers no LLM call;
- invalid enrichment falls back to static output;
- request payloads with unknown fields or excessive limits are rejected/clamped;
- cache keys differ by normalized request view.

### Frontend tests

Assert that:

- parent/group bounds contain their member nodes;
- non-endpoint edge segments do not intersect unrelated node boxes;
- edge-label boxes do not overlap nodes or each other;
- output layout is deterministic for identical input;
- graphs over the density limit produce visible collapsed summaries;
- repeated provider calls do not create duplicate service nodes;
- dark and light snapshots remain readable;
- keyboard focus, hover isolation, and reduced motion work.

### Manual visual acceptance

Use CodeKAVI as the first acceptance fixture. The overview must clearly show:

- Browser User → CodeKAVI Web App → API & Access Control;
- Repository Analysis Pipeline, RAG Chat Service, and AI Explanation Service;
- Supabase, Redis, Zilliz/Milvus, local workspace, and source hosts;
- Cloudflare Workers AI, Groq/Llama 3.3, and Google Gemini;
- action-labelled arrows with no node/label/edge overlap at the initial zoom.

## Migration and rollout

1. Build the static manifest builder and unit-test it before changing the UI.
2. Add `POST /visualize/architecture/{repo_id}` and preserve the old GET endpoint temporarily.
3. Update both report and standalone views to consume `architecture.v2` behind an `architecture_v2` feature flag.
4. Validate the fixture suite and manual diagram screenshots.
5. Monitor layout failures, collapsed-node count, unknown-integration rate, source coverage, and frontend rendering errors.
6. Make V2 default after parity validation.
7. Remove the legacy file-level architecture endpoint, filename-card UI, and old architecture layout tests only after V2 is stable.

## Final definition of done

The feature is complete only when:

- both architecture entry points use the same V2 payload builder;
- visible architecture nodes are responsibility-based and contain no filenames;
- specific detected services and AI models are named explicitly;
- all visible cross-group arrows are short, meaningful, and non-overlapping;
- the initial diagram uses orthogonal routing with no congestion;
- evidence remains inspectable and source-backed;
- static output works without an LLM;
- the full test suite and manual visual acceptance criteria pass.
