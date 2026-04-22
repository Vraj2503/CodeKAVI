"""
app.py — FastAPI server for CodeKavi.

Endpoints:
    POST /api/analyze                — Accept a GitHub URL, clone the repo, and return full analysis.
    GET  /api/graph/{repo_id}        — Get dependency graph in a specific format.
    POST /api/explain/{repo_id}      — Generate LLM explanations for top files + architecture.
    POST /api/explain/file/{repo_id} — Generate LLM explanation for a single file.
    DELETE /api/cleanup              — Remove a previously cloned repo.
    GET  /api/health                 — Health check.
"""

import os
import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from codekavi.cloner import clone_repo, cleanup_repo, parse_github_url
from codekavi.config import CLONE_BASE_DIR
from codekavi.traverser import traverse_repo
from codekavi.analyzer import analyze_dependencies
from codekavi.classifier import classify_files, summarize_roles
from codekavi.graph import (
    export_graph_json,
    export_dot,
    export_mermaid,
    build_module_graph,
    detect_cycles,
)
from codekavi.llm import get_provider, Explainer
from codekavi.indexer import index_repository
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="CodeKavi API")

# CORS — allow all origins during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for active sessions and their analysis results
active_sessions: dict[str, str] = {}          # repo_id → clone_path
active_results: dict[str, dict] = {}           # repo_id → full analysis data

# Logger
logger = logging.getLogger(__name__)


# ── Request / Response models ──
class AnalyzeRequest(BaseModel):
    """ Request body for /api/analyze endpoint. Contains the GitHub URL to analyze. """
    github_url: str


class ExplainRequest(BaseModel):
    """ Request body for /api/explain/{repo_id} endpoint. Contains parameters for LLM explanations. """
    top_n: int = 10
    min_importance: float = 10.0
    model: str | None = "llama-3.3-70b-versatile"  # Default model for explanations


class ExplainFileRequest(BaseModel):
    """ Request body for /api/explain/file/{repo_id} endpoint. Contains the file path and optional model. """
    file_path: str
    model: str | None = "llama-3.3-70b-versatile"  # Default model for file explanations

class ChatRequest(BaseModel):
    """ Request body for /api/chat/{repo_id} endpoint. """
    query: str
    model: str | None = "llama-3.3-70b-versatile"


def _find_clone_path_by_repo_id(repo_id: str) -> str | None:
    """Find an on-disk clone folder by repo_id suffix: <repo_name>_<repo_id>."""
    if not os.path.isdir(CLONE_BASE_DIR):
        return None

    suffix = f"_{repo_id}"
    for entry in os.listdir(CLONE_BASE_DIR):
        full_path = os.path.join(CLONE_BASE_DIR, entry)
        if os.path.isdir(full_path) and entry.endswith(suffix):
            return full_path
    return None


def _ensure_repo_loaded(repo_id: str) -> tuple[dict | None, str | None]:
    """
    Ensure repo analysis is available in memory for a repo_id.
    If missing, lazily rebuild from an existing cloned folder on disk.
    """
    result = active_results.get(repo_id)
    clone_path = active_sessions.get(repo_id)
    if result and clone_path:
        return result, clone_path

    clone_path = clone_path or _find_clone_path_by_repo_id(repo_id)
    if not clone_path:
        return None, None

    # If we have path but not result, rebuild cached analysis for this process.
    if not result:
        repo_data = traverse_repo(clone_path)
        dep_data = analyze_dependencies(clone_path, repo_data["files"])
        file_profiles = classify_files(clone_path, repo_data["files"], dep_data)
        role_summary = summarize_roles(file_profiles)
        graph_json = export_graph_json(dep_data, file_profiles)
        module_graph = build_module_graph(dep_data, file_profiles, depth=1)

        repo_dir = os.path.basename(clone_path)
        repo_name, _, _ = repo_dir.rpartition("_")

        active_results[repo_id] = {
            "repo_name": repo_name,
            "owner": "",
            "repo_data": repo_data,
            "dep_data": dep_data,
            "file_profiles": file_profiles,
            "role_summary": role_summary,
            "graph_json": graph_json,
            "module_graph": module_graph,
        }

    active_sessions[repo_id] = clone_path
    return active_results.get(repo_id), clone_path


# ── Routes ──
@app.post("/api/analyze")
async def analyze(body: AnalyzeRequest):
    """Clone a GitHub repo and return its file metadata."""
    github_url = body.github_url.strip()

    # Validate URL format
    try:
        parse_github_url(github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Clone the repository
    try:
        clone_info = clone_repo(github_url)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Traverse and collect metadata
    try:
        repo_data = traverse_repo(clone_info["clone_path"])
    except Exception as e:
        cleanup_repo(clone_info["clone_path"])
        raise HTTPException(status_code=500, detail=f"Failed to traverse repository: {e}")

    # Analyze dependencies
    try:
        dep_data = analyze_dependencies(clone_info["clone_path"], repo_data["files"])
    except Exception as e:
        dep_data = {"error": f"Dependency analysis failed: {e}", "edges": [], "adjacency": {}, "reverse_adjacency": {}, "entry_points": [], "central_files": [], "stats": {}}

    # Classify file roles
    try:
        file_profiles = classify_files(clone_info["clone_path"], repo_data["files"], dep_data)
        role_summary = summarize_roles(file_profiles)
    except Exception as e:
        file_profiles = []
        role_summary = {"error": f"Classification failed: {e}"}

    # Build graph exports
    try:
        graph_json = export_graph_json(dep_data, file_profiles)
        mermaid_file = export_mermaid(graph_json)
        module_graph = build_module_graph(dep_data, file_profiles, depth=1)
        cycles = detect_cycles(dep_data)
    except Exception as e:
        graph_json = {"error": f"Graph export failed: {e}", "nodes": [], "edges": []}
        mermaid_file = ""
        module_graph = {"error": f"Module graph failed: {e}"}
        cycles = {"has_cycles": False, "cycles": [], "summary": f"Detection failed: {e}"}

    # Index repository for RAG
    if "GEMINI_API_KEY" in os.environ and "ZILLIZ_URI" in os.environ:
        try:
            index_repository(clone_info["repo_id"], file_profiles, clone_info["clone_path"])
        except Exception as e:
            logging.error(f"Vector indexing failed: {e}")

    # Store session and results for later retrieval
    repo_id = clone_info["repo_id"]
    active_sessions[repo_id] = clone_info["clone_path"]
    active_results[repo_id] = {
        "repo_name": clone_info["repo_name"],
        "owner": clone_info["owner"],
        "repo_data": repo_data,
        "dep_data": dep_data,
        "file_profiles": file_profiles,
        "role_summary": role_summary,
        "graph_json": graph_json,
        "module_graph": module_graph,
    }

    return {
        "success": True,
        "repo_id": repo_id,
        "repo_name": clone_info["repo_name"],
        "owner": clone_info["owner"],
        "github_url": github_url,
        **repo_data,
        "dependencies": dep_data,
        "file_profiles": file_profiles,
        "role_summary": role_summary,
        "graph": graph_json,
        "module_graph": module_graph,
        "cycles": cycles,
        "mermaid": {
            "file_level": mermaid_file,
            "module_level": module_graph.get("mermaid", "") if isinstance(module_graph, dict) else "",
        },
    }


@app.get("/api/graph/{repo_id}")
async def get_graph(
    repo_id: str,
    format: str = Query("json", description="Export format: json, dot, mermaid, module"),
    depth: int = Query(1, description="Directory depth for module grouping (1-3)", ge=1, le=3),
    max_nodes: int = Query(50, description="Max nodes for Mermaid diagrams", ge=10, le=200),
):
    """
    Retrieve the dependency graph for a previously analyzed repo
    in a specific export format.
    """
    try:
        result, _ = _ensure_repo_loaded(repo_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    dep_data = result["dep_data"]
    file_profiles = result["file_profiles"]
    graph_json = result["graph_json"]

    if format == "json":
        return graph_json

    elif format == "dot":
        dot_str = export_dot(graph_json, title=f"Dependencies — {repo_id}")
        return PlainTextResponse(content=dot_str, media_type="text/vnd.graphviz")

    elif format == "mermaid":
        mermaid_str = export_mermaid(graph_json, max_nodes=max_nodes)
        return PlainTextResponse(content=mermaid_str, media_type="text/plain")

    elif format == "module":
        module_data = build_module_graph(dep_data, file_profiles, depth=depth)
        return module_data

    else:
        raise HTTPException(status_code=400, detail=f"Unknown format: {format}. Use json, dot, mermaid, or module.")


@app.delete("/api/cleanup/{repo_id}")
async def cleanup(repo_id: str):
    """Remove a previously cloned repo by its ID."""
    clone_path = active_sessions.pop(repo_id, None)
    active_results.pop(repo_id, None)
    if clone_path:
        cleanup_repo(clone_path)
        return {"success": True, "message": f"Repo {repo_id} cleaned up."}
    raise HTTPException(status_code=404, detail="Session not found")


# ─────────────────────────────────────────────
# LLM Explanation endpoints
# ─────────────────────────────────────────────

def _get_explainer(model: str | None = None):
    """Create an Explainer instance. Raises HTTPException if no API key."""
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY environment variable not set. "
                   "Set it to your Groq API key to enable LLM explanations."
        )

    provider = get_provider("groq", api_key=api_key)
    return Explainer(provider, model=model)


@app.post("/api/explain/{repo_id}")
async def explain_repo(repo_id: str, body: ExplainRequest):
    """
    Generate LLM explanations for a previously analyzed repo.

    Returns:
      - architecture_overview: full architecture narrative
      - file_explanations: list of top-N file explanations
      - module_summaries: short summaries per module
      - stats: token usage, timing, etc.
    """
    try:
        result, clone_path = _ensure_repo_loaded(repo_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    explainer = _get_explainer(model=body.model)

    dep_data = result["dep_data"]
    file_profiles = result["file_profiles"]
    module_graph = result["module_graph"]
    repo_data = result.get("repo_data", {})
    role_summary = result.get("role_summary", {})
    repo_name = result.get("repo_name", os.path.basename(clone_path).rsplit("_", 1)[0])
    owner = result.get("owner", "")

    # 1. Architecture overview
    logger.info(f"Generating architecture overview for {repo_id}...")
    arch_result = explainer.explain_architecture(
        repo_name=repo_name,
        owner=owner,
        total_files=repo_data.get("total_files", len(file_profiles)),
        total_size_formatted=repo_data.get("total_size_formatted", ""),
        languages=repo_data.get("languages", {}),
        role_summary=role_summary,
        entry_points=dep_data.get("entry_points", []),
        central_files=dep_data.get("central_files", []),
        module_graph=module_graph if isinstance(module_graph, dict) else {},
        file_profiles=file_profiles,
    )

    # 2. Top file explanations
    logger.info(f"Explaining top {body.top_n} files for {repo_id}...")
    file_results = explainer.explain_top_files(
        file_profiles=file_profiles,
        repo_root=clone_path,
        repo_name=repo_name,
        top_n=body.top_n,
        min_importance=body.min_importance,
    )

    # 3. Module summaries
    logger.info(f"Generating module summaries for {repo_id}...")
    if isinstance(module_graph, dict) and "modules" in module_graph:
        module_summaries = explainer.explain_modules(module_graph, repo_name)
    else:
        module_summaries = {}

    return {
        "success": True,
        "repo_id": repo_id,
        "architecture": {
            "overview": arch_result.overview,
            "model": arch_result.model,
            "tokens_used": arch_result.tokens_used,
            "duration_ms": arch_result.duration_ms,
            "error": arch_result.error,
        },
        "file_explanations": [
            {
                "file": r.file_path,
                "explanation": r.explanation,
                "model": r.model,
                "tokens_used": r.tokens_used,
                "duration_ms": r.duration_ms,
                "error": r.error,
            }
            for r in file_results
        ],
        "module_summaries": module_summaries,
        "stats": explainer.get_stats(),
    }


@app.post("/api/explain/file/{repo_id}")
async def explain_single_file(repo_id: str, body: ExplainFileRequest):
    """
    Generate an LLM explanation for a single file in a previously analyzed repo.
    """
    try:
        result, clone_path = _ensure_repo_loaded(repo_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load repo: {e}") from e

    if not result or not clone_path:
        raise HTTPException(status_code=404, detail="Repo not found. Run /api/analyze first.")

    file_profiles = result["file_profiles"]

    # Find the file profile
    profile = None
    for fp in file_profiles:
        if fp["path"] == body.file_path:
            profile = fp
            break

    if not profile:
        raise HTTPException(status_code=404, detail=f"File not found: {body.file_path}")

    explainer = _get_explainer(model=body.model)
    repo_name = os.path.basename(clone_path).rsplit("_", 1)[0]

    file_result = explainer.explain_file(profile, clone_path, repo_name)

    return {
        "success": True,
        "file": file_result.file_path,
        "explanation": file_result.explanation,
        "model": file_result.model,
        "provider": file_result.provider,
        "tokens_used": file_result.tokens_used,
        "duration_ms": file_result.duration_ms,
        "error": file_result.error,
    }


# ─────────────────────────────────────────────
# RAG Chat Endpoint
# ─────────────────────────────────────────────

@app.post("/api/chat/{repo_id}")
async def chat_repo(repo_id: str, body: ChatRequest):
    """
    RAG endpoint that searches the Zilliz vector store for relevant code context
    and answers the user's question using the LLM.
    """
    try:
        from codekavi.vectorstore import zilliz_client
        from codekavi.llm.providers import Message

        # 1. Retrieve Context from Zilliz
        results = zilliz_client.search(body.query, repo_id, limit=5)
        if not results:
            return {"success": False, "error": "No relevant code context found. Ensure the repository was fully indexed."}
            
        context_blocks = []
        for i, res in enumerate(results):
            context_blocks.append(
                f"--- Context {i+1} ---\n"
                f"File: {res['file_path']}\n"
                f"Role: {res['role']}\n"
                f"Code Snippet:\n{res['text']}\n"
            )
        
        combined_context = "\n".join(context_blocks)
        
        # 2. Build the Prompt
        system_prompt = (
            "You are an expert, conversational developer acting as an AI host discussing a codebase. "
            "You are provided with several context snippets retrieved from the repository's source code. "
            "Answer the user's question using ONLY the provided context.\\n\\n"
            "Your answers should be highly engaging, clear, and direct. If you reference specific logic, "
            "always cite the relevant file path enclosed in backticks (e.g. `src/auth.js`).\\n\\n"
            f"--- RETRIEVED CONTEXT ---\\n{combined_context}\\n--------------------------"
        )
        
        # 3. Call LLM (using default Explainer logic)
        explainer = _get_explainer(model=body.model)
        
        messages = [
            Message(role="system", content=system_prompt),
            Message(role="user", content=body.query)
        ]
        
        # Directly use the provider under the explainer
        response = explainer.provider.complete(
            messages=messages,
            temperature=0.4,
            max_tokens=2048
        )
        
        return {
            "success": True,
            "repo_id": repo_id,
            "answer": response.content,
            "sources": [{"file_path": r["file_path"], "score": r["score"]} for r in results]
        }
        
    except Exception as e:
        logger.error(f"Chat RAG error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    groq_configured = bool(os.environ.get("GROQ_API_KEY", ""))
    return {
        "status": "ok",
        "service": "CodeKavi API",
        "llm_configured": groq_configured,
        "llm_provider": "groq" if groq_configured else None,
    }
