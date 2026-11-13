# CodeKAVI — Compact Landing Page Specification (3 Sections)

> **Context & Audit Note:**  
> This specification is built directly from the live codebase (`backend/rune/` and `frontend/`). All features, stage names, role classifications, visualizations, and metrics reflect the actual implementation in the repository, completely bypassing outdated references.

---

## Executive Summary: Structure & Tone

- **Target Persona:** Engineers, tech leads, consultants, and new hires inheriting an unfamiliar or legacy repository.
- **Tone:** Technical, calm, precise, zero-marketing fluff. Engineer-to-engineer.
- **Page Length:** Strictly **3 compact sections** designed to avoid infinite scrolling and deliver instant clarity:
  1. **Section 1: Hero & Immediate Input** (Value proposition, single-field repo input, quick-try chips, live telemetry bar).
  2. **Section 2: The 4 Core Intelligence Views** (Interactive tabbed showcase: Grounded Chat, Dependency Graph, 6-Section Report, Advanced Visualizations).
  3. **Section 3: Pipeline & Architecture Transparency** (The 8-stage deterministic engine, supported languages, privacy guarantee, and minimalist closing action).

---

## Section 1: Hero & Immediate Input

### 1. Header (Floating Pill Navigation)
- **Component Style:** Floating frosted-glass pill (`backdrop-filter: blur(20px)`), centered at the top.
- **Left:** CodeKAVI geometric SVG glyph + `CodeKAVI` logotype.
- **Center:** Jump links (`#features`, `#pipeline`, `#tech-specs`).
- **Right Pill Action:** `Launch App` / `Sign In` (links to `/login` or auth modal).

### 2. Main Hero Content
- **Eyebrow:** `CODEBASE INTELLIGENCE FOR INHERITED REPOSITORIES`
- **Primary Headline (2 Lines):**
  > **Read any repository**  
  > **like you wrote it.**
- **Sub-headline (Concise, 2 sentences):**
  > Clone, parse, and map any public repository in seconds. CodeKAVI extracts real syntax trees, classifies file roles, and provides grounded answers citing verified file paths and line ranges.

### 3. The Primary Action ("The One Input")
Rather than hiding the action behind buttons or modal clicks, the primary interaction is embedded directly in the hero:
- **Input Field:**
  - Prefix: `github.com/` (monospace label)
  - Placeholder: `owner/repository` (e.g., `tiangolo/fastapi`)
  - Submit Button: `Analyze Repository ↵` (triggers 8-stage streaming analysis)
- **Quick-Try Chips (Real tested repositories):**
  - `pallets/flask` (Python)
  - `vercel/swr` (TypeScript)
  - `tiangolo/fastapi` (Python ASGI)
- **Secondary Micro-Copy:**  
  *Supports GitHub, GitLab, and Bitbucket public repositories. No local installation required.*

### 4. Telemetry / Proof Bar (Real Codebase Metrics)
A clean, horizontal stat strip directly under the input:
| Metric | Label | Source Verification |
| :--- | :--- | :--- |
| **14+** | **Architectural Roles** | Categorized via graph topology (`entry_point`, `core_module`, `orchestrator`, `shared_utility`, etc.) |
| **8** | **Streaming Stages** | Real-time SSE progress from shallow git clone to Zilliz vector indexing |
| **6** | **Deep Visualizers** | Complexity Radar, Module Architecture, Data Flow, Mind Map, Symbol Calls, 3D Neural Net |
| **100%** | **Grounded Citations** | Every LLM answer cites verified file paths and line numbers (`file.py:L1-L25`) |

---

## Section 2: The 4 Core Intelligence Views (Interactive Feature Segment)

Instead of four tall sections that stretch the page, Section 2 is a single, compact **segmented display** (Tabs or Side-by-Side Switcher) demonstrating the four workspace surfaces that CodeKAVI generates from a single repository parse.

```
┌────────────────────────────────────────────────────────────────────────┐
│  [ 1. Grounded Chat ]  [ 2. Dependency Graph ]  [ 3. Streamed Report ]  [ 4. Visualizations ]  │
└────────────────────────────────────────────────────────────────────────┘
```

### Tab 1: Grounded RAG Chat (`ChatPanel.tsx`)
- **Headline:** Answers with proof, not hallucinations.
- **Copy:**  
  CodeKAVI indexes repository source code into a Zilliz vector database using Gemini embeddings. When you ask architectural questions, it retrieves targeted code chunks and enforces line-numbered citations directly in the response.
- **Visual Display:**  
  A sleek terminal-style chat exchange showing:
  - **User:** *"Where are errors intercepted and transformed into HTTP responses?"*
  - **CodeKAVI:** *"In the outermost middleware stack. `starlette/middleware/errors.py` wraps the ASGI callable and handles exception bubbling before response serialization."*
  - **Source Citation Chip:** `starlette/middleware/errors.py:L146-L171` (with syntax-highlighted code snippet and real line numbers).

### Tab 2: Interactive Dependency & Symbol Graph (`GraphCanvas.tsx`)
- **Headline:** True syntax-tree topology, down to symbol calls.
- **Copy:**  
  Built from static AST analysis, not regex guesses. Explore file-to-file imports, module-level boundaries, cycle warnings, and symbol-level call relationships (functions, classes, inheritance).
- **Key Capabilities Highlighted:**
  - **Layer Swimlanes:** Grouped into architectural tiers (Entry, Domain, Infrastructure, Shared).
  - **Cycle Detection:** Automatically flags circular dependencies with warning badges.
  - **Architecture Tour:** Step-by-step guided walkthrough highlighting core execution paths.

### Tab 3: Six-Section Architecture Report (`ReportView.tsx`)
- **Headline:** Instant architectural documentation for new maintainers.
- **Copy:**  
  Streams six structured report sections generated in parallel batches over Server-Sent Events (SSE). Each section is tied directly to the classified file roles.
- **The 6 Real Sections:**
  1. `Overview`: High-level system purpose, tech stack, and primary runtime contracts.
  2. `Architecture`: Module boundaries, state encapsulation, and entry-point routing.
  3. `Components`: Key modules, responsibility contracts, and internal helpers.
  4. `Data Flow`: Request-response lifecycles and pipeline flow from source to sink.
  5. `Patterns`: Established coding conventions, design patterns, and anti-patterns.
  6. `Mind Map`: Conceptual hierarchy and mental model of the codebase.

### Tab 4: Multi-Model Visualizers (`VisualizationPanel.tsx`)
- **Headline:** Multi-dimensional inspection of code health and layout.
- **Copy:**  
  Six specialized visualization formats computed deterministically from static analysis metadata:
  - **Complexity Radar:** Concentric architectural tiers paired with a McCabe cyclomatic complexity hull.
  - **Data Flow Diagram:** Traces execution from user entry points through downstream layers.
  - **Symbol Knowledge Graph:** Graph of functions and classes with call and inheritance edges.
  - **3D Neural Network Extractor:** Automatic PlotNeuralNet-style 3D architectural rendering for PyTorch `nn.Module` and Keras models.

---

## Section 3: The Engine & Architecture Transparency

Engineers trust tools when they know how they work under the hood. Section 3 covers the pipeline mechanics, supported languages, privacy, and the closing call to action.

### 1. The 8-Stage Streaming Pipeline
A compact horizontal pipeline bar showing the exact sequence executed by `backend/rune/routes/analyze.py`:

```
01 Clone ──> 02 Traverse ──> 03 AST Parse ──> 04 Classify Roles
                                                    │
08 Complete <── 07 Vector Index <── 06 Select Files <── 05 Build Graph
```

1. **01 Cloning:** Ephemeral shallow clone (`--depth 1`) off the main event loop.
2. **02 Traversing:** Respects ignore patterns (`.git`, `node_modules`, `venv`, build targets).
3. **03 Analyzing:** Native AST extraction (Python) and Tree-sitter AST parsing (JavaScript/TypeScript).
4. **04 Classifying:** Maps 14+ architectural roles based on degree centrality and syntax heuristics.
5. **05 Graphing:** Assembles dependency matrices, resolves local paths, and detects import cycles.
6. **06 Selecting:** Filters the top central files to feed targeted LLM context windows.
7. **07 Indexing:** Generates semantic code embeddings and synchronizes with Zilliz vector store.
8. **08 Complete:** Hydrates workspace sessions and streams architecture walkthroughs.

### 2. Multi-Language Support Grid
- **First-Class AST Support:** Python (`ast`), JavaScript/TypeScript (`tree-sitter`).
- **Dependency & Import Parsing:** Go, Java, C/C++, Rust, Ruby, PHP, and Jupyter Notebooks (`.ipynb`).
- **ML Detection:** Automatic extraction for PyTorch and Keras neural network architectures.

### 3. Engineering Guarantees (Objection Killing)
- **Zero Hallucination Grounding:** No arbitrary text generation; answers without retrieved code context are explicitly rejected.
- **Cache-Accelerated Re-Analysis:** SHA-256 file fingerprinting (`PARTIAL_UPDATE`) means re-analyzing a modified commit only parses changed files.
- **Data Privacy & Ephemeral Storage:** Analyzed repositories can be wiped at any time with one click. Public repositories are discarded upon session cleanup.

### 4. Compact Closing CTA & Footer
- **Closing Headline:**
  > **Point it at the repository you inherited.**  
  > One clone, one parse, eight stages. Start exploring in under 30 seconds.
- **Action:** Re-render the single input field `[ github.com/user/repo ]` + `[ Analyze ]`.
- **Watermark Brand:** Full-width subtle `CodeKAVI` logotype.
- **Footer Bar:** `© 2026 CodeKAVI · Powered by Rune Architecture Engine` · Links to Privacy, Terms, and GitHub repository.

---

## Recommended Page Implementation Matrix

| Section | Height Budget | DOM Components Required |
| :--- | :--- | :--- |
| **Top Navigation** | Floating (`48px`) | Glass pill (`.pill-nav`), SVG logo, 3 section anchors, CTA pill |
| **Section 1: Hero & Input** | `100svh` (or `~650px`) | H1, lead copy, URL input group, quick-try chips, stat strip, live interactive graph canvas background |
| **Section 2: 4 Core Views** | `~600px` | 4-tab segment control (`Chat`, `Graph`, `Report`, `Visualizer`), interactive preview window |
| **Section 3: Pipeline & Close**| `100svh` (or `~600px`) | 8-stage stepper bar, language chips, privacy badges, CTA input, full-width `CodeKAVI` footer |

