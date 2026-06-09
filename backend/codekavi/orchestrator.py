"""
orchestrator.py — Parallel explanation orchestrator.

Generates 8 explanation sections in 3 parallel batches,
yielding SSE event dicts as each section completes.

Event types:
  - "stats"    → instant repo statistics (zero LLM cost)
  - "tree"     → directory structure (zero LLM cost)
  - "progress" → {phase, progress, message}
  - "section"  → {name, title, content, code_snippets, ...}
  - "warning"  → {section, message} for failed sections
"""


import asyncio
import json
import os
import re
import logging
from typing import AsyncIterator

from codekavi.llm.providers import get_provider
from codekavi.config import EXTENSION_LANGUAGE_MAP, detect_layer

logger = logging.getLogger(__name__)


class ExplanationOrchestrator:
    def __init__(
        self,
        repo_path: str,
        tree: dict,
        analysis: dict,
        classification: list,
        selected_files: list,
        depth: str = "detailed",
    ):
        self.repo_path = repo_path
        self.tree = tree
        self.analysis = analysis
        self.classification = classification
        self.selected_files = selected_files
        self.depth = depth
        self.sections_completed = 0
        self.total_sections = 8

    async def run(self) -> AsyncIterator[dict]:
        """
        Yields event dicts: {"type": str, "data": dict}
        """
        # ── INSTANT EVENTS (no LLM, no cost, no latency) ──
        yield {"type": "stats", "data": {
            "total_files": len(self.tree.get("files", [])),
            "languages": self._count_languages(),
            "selected_files": len(self.selected_files),
            "entry_points": self.analysis.get("entry_points", []),
        }}
        yield {"type": "tree", "data": {
            "structure": self.tree.get("tree", self.tree)
        }}
        yield self._progress(10, "generating", "AI is reading your codebase...")

        # Load file contents
        file_contents = self._load_selected_file_contents()
        graph_data = self._build_graph_context()

        # ── BATCH 1 — 3 sections in parallel ──
        batch_1 = {
            "overview": self._gen("overview", "overview",
                self._prompt_overview(file_contents, graph_data)),
            "dependencies": self._gen("dependencies", "viz_data",
                self._prompt_dependencies(graph_data)),
            "complexity": self._gen("complexity", "viz_data",
                self._prompt_complexity()),
        }
        async for ev in self._run_batch(batch_1, 15, 40):
            yield ev

        # Rate-limit pause: stay safely under Groq's 30 RPM
        await asyncio.sleep(3)

        # ── BATCH 2 — 3 sections in parallel ──
        batch_2 = {
            "architecture": self._gen("architecture", "architecture",
                self._prompt_architecture(file_contents, graph_data)),
            "components": self._gen("components", "components",
                self._prompt_components(file_contents)),
            "data_flow": self._gen("data_flow", "data_flow",
                self._prompt_dataflow(file_contents, graph_data)),
        }
        async for ev in self._run_batch(batch_2, 40, 75):
            yield ev

        # Rate-limit pause: stay safely under Groq's 30 RPM
        await asyncio.sleep(3)

        # ── BATCH 3 — 2 sections in parallel ──
        batch_3 = {
            "patterns": self._gen("patterns", "patterns",
                self._prompt_patterns(file_contents)),
            "mindmap": self._gen("mindmap", "mindmap_data",
                self._prompt_mindmap(file_contents, graph_data),
                json_mode=True),
        }
        async for ev in self._run_batch(batch_3, 75, 95):
            yield ev

        yield self._progress(100, "complete", "Report generation complete!")

    # ─────────────────────────────────────────
    # Batch runner
    # ─────────────────────────────────────────

    async def _run_batch(self, tasks: dict, p_start: int, p_end: int):
        """Run a dict of {name: coroutine} in parallel, yield events as each completes."""
        named_tasks = {
            name: asyncio.create_task(coro)
            for name, coro in tasks.items()
        }
        done_count = 0
        total = len(named_tasks)

        pending = set(named_tasks.values())
        task_to_name = {v: k for k, v in named_tasks.items()}

        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                name = task_to_name[task]
                self.sections_completed += 1
                done_count += 1
                progress = p_start + int((done_count / total) * (p_end - p_start))
                try:
                    result = task.result()
                    yield {"type": "section", "data": {"name": name, **result}}
                    yield self._progress(
                        progress, "generating",
                        f"Generated {result['title']} ({self.sections_completed}/{self.total_sections})"
                    )
                except Exception as e:
                    logger.error(f"Section {name} failed: {e}")
                    yield {"type": "warning", "data": {
                        "section": name, "message": str(e)[:200]
                    }}

    # ─────────────────────────────────────────
    # Section generator
    # ─────────────────────────────────────────

    async def _gen(self, name: str, task_type: str, prompt: dict, json_mode: bool = False) -> dict:
        """Generate a single section via async LLM call."""
        provider = get_provider(task_type)
        response = await provider.generate(
            system_prompt=prompt["system"],
            user_prompt=prompt["user"],
            temperature=prompt.get("temperature", 0.3),
            max_tokens=prompt.get("max_tokens", 3000),
            json_mode=json_mode,
        )

        snippets = self._extract_snippets(response)
        viz_data = None

        if json_mode:
            try:
                parsed = json.loads(response)
                raw_viz = parsed.get("visualization", {})
                viz_data = {"root": raw_viz} if raw_viz else None
                response = parsed.get("content", "")
            except json.JSONDecodeError:
                viz_data = None

        if viz_data is None:
            viz_data = self._auto_viz(name)

        return {
            "title": self._title(name),
            "content": response,
            "code_snippets": snippets,
            "visualization_type": self._viz_type(name),
            "visualization_data": viz_data,
        }

    # ─────────────────────────────────────────
    # Prompt builders
    # ─────────────────────────────────────────

    _SYSTEM_PROMPT = (
        "You are a senior software architect explaining a codebase. "
        "Be specific — reference actual file names and function names. "
        "Use markdown formatting with headers, bullet points, and code blocks. "
        "Do NOT generate ASCII diagrams, mermaid syntax, or any kind of "
        "visual diagram in your response. Write prose and structured "
        "markdown only. Visualization data is handled separately."
    )

    def _prompt_overview(self, file_contents: dict, graph_data: dict) -> dict:
        files_list = list(file_contents.keys())[:30]
        entry_points = graph_data.get("entry_points", [])[:2]
        entry_code = ""
        for ep in entry_points:
            ep_file = ep.get("file", "")
            if ep_file in file_contents:
                entry_code += f"\n### {ep_file}\n```\n{file_contents[ep_file][:3000]}\n```\n"

        languages = self._count_languages()
        dep_count = self.analysis.get("stats", {}).get("total_edges", 0)

        user = (
            f"## Files in repository (first 30)\n{chr(10).join(f'- {f}' for f in files_list)}\n\n"
            f"## Entry point code\n{entry_code}\n\n"
            f"## Language distribution\n{json.dumps(languages, indent=2)}\n\n"
            f"## Dependency count: {dep_count}\n\n"
            "## Please analyze:\n"
            "1. **Purpose** — What does this project do?\n"
            "2. **Tech Stack** — What languages, frameworks, libraries are used?\n"
            "3. **Architecture** — What architectural pattern does it follow?\n"
            "4. **Design Decisions** — Key design choices visible in the code\n"
            "5. **Maturity** — How mature/production-ready does it appear?"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3000}

    def _prompt_architecture(self, file_contents: dict, graph_data: dict) -> dict:
        classifications = []
        for fp in (self.classification or [])[:20]:
            classifications.append(f"- `{fp.get('path', '')}` — {fp.get('role_label', fp.get('role', '?'))}")

        dep_graph = graph_data.get("adjacency", {})
        dep_lines = []
        for src, targets in list(dep_graph.items())[:20]:
            for t in (targets if isinstance(targets, list) else [targets])[:3]:
                dep_lines.append(f"- `{src}` → `{t}`")

        key_files = []
        for path, content in list(file_contents.items())[:10]:
            key_files.append(f"### {path}\n```\n{content[:2000]}\n```")

        user = (
            f"## File classifications (top 20)\n{chr(10).join(classifications)}\n\n"
            f"## Dependency graph (top 20 edges)\n{chr(10).join(dep_lines)}\n\n"
            f"## Key file contents\n{chr(10).join(key_files)}\n\n"
            "## Please analyze:\n"
            "1. **Pattern** — What architectural pattern is used? (MVC, layered, microservices, etc.)\n"
            "2. **Layers** — Break down the system into logical layers\n"
            "3. **Communication** — How do components communicate?\n"
            "4. **Request Flow** — Trace a typical request through the system\n"
            "5. **State Management** — How is state managed?"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3500}

    def _prompt_components(self, file_contents: dict) -> dict:
        components = []
        for fp in (self.classification or [])[:15]:
            path = fp.get("path", "")
            content = file_contents.get(path, "")
            if content:
                components.append(
                    f"### {path}\n"
                    f"- Role: {fp.get('role_label', '?')}\n"
                    f"- Importance: {fp.get('importance_score', 0)}\n"
                    f"```\n{content[:2000]}\n```"
                )

        user = (
            f"## Top components with source code\n{chr(10).join(components)}\n\n"
            "## For each component, explain:\n"
            "1. **Purpose** — What is this component responsible for?\n"
            "2. **Key Functions** — What are the main functions/classes?\n"
            "3. **Connections** — How does it connect to other components?\n"
            "4. **Patterns** — Notable design patterns used"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3500}

    def _prompt_dataflow(self, file_contents: dict, graph_data: dict) -> dict:
        entry_points = graph_data.get("entry_points", [])[:3]
        entry_code = ""
        for ep in entry_points:
            ep_file = ep.get("file", "")
            if ep_file in file_contents:
                entry_code += f"\n### {ep_file}\n```\n{file_contents[ep_file][:2500]}\n```\n"

        dep_graph = graph_data.get("adjacency", {})
        dep_lines = []
        for src, targets in list(dep_graph.items())[:20]:
            for t in (targets if isinstance(targets, list) else [targets])[:3]:
                dep_lines.append(f"- `{src}` → `{t}`")

        user = (
            f"## Entry point code\n{entry_code}\n\n"
            f"## Dependency graph subset\n{chr(10).join(dep_lines)}\n\n"
            "## Please analyze:\n"
            "1. **User Flows** — Trace step-by-step flows from entry points\n"
            "2. **Transformations** — How is data transformed as it moves through?\n"
            "3. **External Calls** — What external services or APIs are called?\n"
            "4. **Error Handling** — How are errors propagated?\n"
            "5. **Side Effects** — What side effects occur (DB writes, file I/O, etc.)?"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3000}

    def _prompt_dependencies(self, graph_data: dict) -> dict:
        dep_graph = graph_data.get("adjacency", {})
        dep_lines = []
        for src, targets in list(dep_graph.items())[:25]:
            for t in (targets if isinstance(targets, list) else [targets])[:3]:
                dep_lines.append(f"- `{src}` → `{t}`")

        central = graph_data.get("central_files", [])[:10]
        central_lines = [f"- `{c.get('file', '')}` (in: {c.get('in_degree', 0)}, out: {c.get('out_degree', 0)})" for c in central]

        entry_lines = [f"- `{e.get('file', '')}`" for e in graph_data.get("entry_points", [])[:5]]

        user = (
            f"## Dependency graph (top 25)\n{chr(10).join(dep_lines)}\n\n"
            f"## Most central files\n{chr(10).join(central_lines)}\n\n"
            f"## Entry points\n{chr(10).join(entry_lines)}\n\n"
            "## Please analyze:\n"
            "1. **Core Chains** — What are the main dependency chains?\n"
            "2. **Hub Modules** — Which modules are dependency hubs?\n"
            "3. **External Libraries** — What major external dependencies exist?\n"
            "4. **Circular Dependencies** — Any circular dependency risks?\n"
            "5. **Coupling Assessment** — How tightly coupled is the codebase?"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3000}

    def _prompt_complexity(self) -> dict:
        classifications = []
        for fp in (self.classification or [])[:30]:
            classifications.append(
                f"- `{fp.get('path', '')}` — role: {fp.get('role', '?')}, "
                f"importance: {fp.get('importance_score', 0)}, "
                f"in_degree: {fp.get('in_degree', 0)}, out_degree: {fp.get('out_degree', 0)}"
            )
        file_count = len(self.tree.get("files", []))

        user = (
            f"## File classifications (top 30)\n{chr(10).join(classifications)}\n\n"
            f"## Total file count: {file_count}\n\n"
            "## Please analyze:\n"
            "1. **Most Complex Files** — Which files are likely the most complex and why?\n"
            "2. **Maintenance Hotspots** — Which areas will be hardest to maintain?\n"
            "3. **Risky Files** — Which files carry the most risk if changed?\n"
            "4. **Reduction Suggestions** — How could complexity be reduced?"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 2500}

    def _prompt_patterns(self, file_contents: dict) -> dict:
        samples = []
        for fp in (self.classification or [])[:10]:
            path = fp.get("path", "")
            content = file_contents.get(path, "")
            if content:
                samples.append(f"### {path}\n```\n{content[:1500]}\n```")

        user = (
            f"## Code samples from top files\n{chr(10).join(samples)}\n\n"
            "## Please analyze:\n"
            "1. **Design Patterns** — What design patterns are used? (Factory, Singleton, Observer, etc.)\n"
            "2. **Naming Conventions** — What naming conventions are followed?\n"
            "3. **Error Handling** — How are errors handled throughout?\n"
            "4. **Configuration Approach** — How is configuration managed?\n"
            "5. **Code Quality** — Overall code quality assessment"
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.3, "max_tokens": 3000}

    def _prompt_mindmap(self, file_contents: dict, graph_data: dict) -> dict:
        files_list = list(file_contents.keys())[:20]
        entry_points = [e.get("file", "") for e in graph_data.get("entry_points", [])[:5]]
        languages = self._count_languages()
        classifications = []
        for fp in (self.classification or [])[:20]:
            classifications.append(f"{fp.get('path', '')} ({fp.get('role_label', '?')})")

        user = (
            f"## Files: {', '.join(files_list)}\n\n"
            f"## Entry points: {', '.join(entry_points)}\n\n"
            f"## Languages: {json.dumps(languages)}\n\n"
            f"## Classifications: {', '.join(classifications)}\n\n"
            "## IMPORTANT: You MUST return valid JSON in this exact format:\n"
            '{"content": "Brief description of the codebase architecture", '
            '"visualization": {"name": "Root", "children": ['
            '{"name": "Category", "children": [{"name": "Item"}]}'
            "]}}\n\n"
            "Categories to include: Tech Stack, Architecture Layers, Core Modules, "
            "Data Flow, External Services, Key Patterns."
        )
        return {"system": self._SYSTEM_PROMPT, "user": user, "temperature": 0.2, "max_tokens": 3000}

    # ─────────────────────────────────────────
    # Code snippet extraction
    # ─────────────────────────────────────────

    def _extract_snippets(self, response: str) -> list[dict]:
        """Extract code snippets referenced in the LLM response by matching backtick-wrapped file paths."""
        snippets = []
        # Match backtick-wrapped file paths like `src/auth.js`
        matches = re.findall(r'`([^\s`]+\.[a-zA-Z]{1,5})`', response)

        selected_set = set(
            (f["path"] if isinstance(f, dict) else f) for f in self.selected_files
        ) if self.selected_files else set()
        seen = set()

        for match in matches:
            if match in seen or len(snippets) >= 5:
                break
            seen.add(match)

            # Check if the matched path exists in selected files
            if match not in selected_set:
                continue

            # Read actual file content from disk
            abs_path = os.path.join(self.repo_path, match)
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    code = f.read(2000)
                lines = code.count("\n") + 1
                snippets.append({
                    "file_path": match,
                    "code": code,
                    "line_start": 1,
                    "line_end": lines,
                })
            except (OSError, IOError):
                continue

        return snippets

    # ─────────────────────────────────────────
    # Auto-visualization (zero LLM cost)
    # ─────────────────────────────────────────

    def _auto_viz(self, section_name: str) -> dict | None:
        if section_name == "dependencies":
            return self._auto_viz_dependencies()
        elif section_name == "complexity":
            return self._auto_viz_complexity()
        elif section_name in ("architecture", "data_flow"):
            return self._auto_viz_dependencies()  # reuse same graph data
        return None

    def _auto_viz_dependencies(self) -> dict:
        """Build dependency graph viz from analysis data."""
        nodes = []
        edges = []
        seen_nodes = set()

        adjacency = self.analysis.get("adjacency", {})
        for src, targets in adjacency.items():
            if len(nodes) >= 60:
                break
            if src not in seen_nodes:
                seen_nodes.add(src)
                nodes.append({
                    "id": src,
                    "label": os.path.basename(src),
                    "type": self._detect_layer(src),
                })
            target_list = targets if isinstance(targets, list) else [targets]
            for t in target_list:
                if len(edges) >= 100:
                    break
                if t not in seen_nodes and len(nodes) < 60:
                    seen_nodes.add(t)
                    nodes.append({
                        "id": t,
                        "label": os.path.basename(t),
                        "type": self._detect_layer(t),
                    })
                if t in seen_nodes:
                    edges.append({"source": src, "target": t})

        return {"nodes": nodes, "edges": edges}

    def _auto_viz_complexity(self) -> dict:
        children = []
        for fp in (self.classification or [])[:80]:
            children.append({
                "name": os.path.basename(fp.get("path", "")),
                "value": fp.get("importance_score", 1),
            })
        return {"name": "Complexity", "children": children}

    def _detect_layer(self, path: str) -> str:
        """Delegate to canonical detect_layer in config.py."""
        return detect_layer(path)

    # ─────────────────────────────────────────
    # Helper methods
    # ─────────────────────────────────────────

    def _count_languages(self) -> dict[str, int]:
        """Count file extensions from tree files, map using EXTENSION_LANGUAGE_MAP."""
        lang_counts: dict[str, int] = {}
        for f in self.tree.get("files", []):
            path = f.get("path", "") if isinstance(f, dict) else str(f)
            _, ext = os.path.splitext(path)
            lang = EXTENSION_LANGUAGE_MAP.get(ext.lower(), None)
            if lang:
                lang_counts[lang] = lang_counts.get(lang, 0) + 1
        return lang_counts

    def _load_selected_file_contents(self) -> dict[str, str]:
        """Read selected files from disk, truncate to 12000 chars each."""
        contents = {}
        for item in self.selected_files:
            # Handle both dict (from SmartFileSelector) and plain string formats
            file_path = item["path"] if isinstance(item, dict) else item
            abs_path = os.path.join(self.repo_path, file_path)
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    contents[file_path] = f.read(12000)
            except (OSError, IOError):
                continue
        return contents

    def _build_graph_context(self) -> dict:
        """Extract deps, entry_points, central_files from analysis."""
        return {
            "adjacency": self.analysis.get("adjacency", {}),
            "reverse_adjacency": self.analysis.get("reverse_adjacency", {}),
            "entry_points": self.analysis.get("entry_points", []),
            "central_files": self.analysis.get("central_files", []),
            "stats": self.analysis.get("stats", {}),
        }

    def _progress(self, pct: int, phase: str, msg: str) -> dict:
        return {"type": "progress", "data": {
            "phase": phase,
            "progress": pct,
            "message": msg,
        }}

    def _title(self, name: str) -> str:
        titles = {
            "overview": "Project Overview",
            "architecture": "Architecture Analysis",
            "components": "Component Breakdown",
            "data_flow": "Data Flow Analysis",
            "dependencies": "Dependency Analysis",
            "complexity": "Complexity Assessment",
            "patterns": "Design Patterns & Code Quality",
            "mindmap": "Codebase Mind Map",
        }
        return titles.get(name, name.replace("_", " ").title())

    def _viz_type(self, name: str) -> str | None:
        viz_types = {
            "dependencies": "dependency_graph",
            "complexity": "treemap",
            "architecture": "architecture_graph",
            "data_flow": "flow_diagram",
            "mindmap": "radial_mindmap",
        }
        return viz_types.get(name)
