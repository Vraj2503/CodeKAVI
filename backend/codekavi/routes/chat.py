"""
routes/chat.py — RAG-powered chat endpoint.

Endpoints:
    POST /chat/{repo_id} — Ask a question about a previously analyzed repo.
"""

import os
import logging

from fastapi import APIRouter, HTTPException

from codekavi.schemas import ChatRequest
from codekavi.llm import get_provider
from codekavi.llm.providers import Message
from codekavi.utils import run_sync as _run_sync

router = APIRouter()
logger = logging.getLogger(__name__)


# Keywords that signal a technical/architecture question
_TECHNICAL_KEYWORDS = [
    "architecture", "rag", "pipeline", "embedding", "vector",
    "backend", "api", "database", "engineer", "technical",
    "system design", "infrastructure", "deployment", "security",
    "authentication", "middleware", "service", "model", "schema",
    "algorithm", "indexer", "orchestrator", "provider", "llm",
    "chunking", "retrieval", "prompt",
]


@router.post("/chat/{repo_id}")
async def chat_repo(repo_id: str, body: ChatRequest):
    """
    RAG endpoint that searches the Zilliz vector store for relevant code context
    and answers the user's question using the LLM.

    For technical/architecture questions, retrieves more chunks (top_k=8)
    and filters out frontend/test code for higher relevance.
    """
    # Validate repo_id format early (must be 12-char hex from clone_repo)
    import re
    if not re.match(r'^[a-f0-9]{12}$', repo_id):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid repo_id format: {repo_id!r}. Must be a 12-character hex string."
        )

    try:
        from codekavi.vectorstore import zilliz_client

        # Check Zilliz is configured before attempting search
        if not zilliz_client.uri or not zilliz_client.token:
            raise HTTPException(
                status_code=503,
                detail="Vector store not configured. Set ZILLIZ_URI and ZILLIZ_API_KEY environment variables."
            )

        # Verify repo exists in our cache (ensures we can serve other endpoints too)
        from codekavi.session import ensure_repo_loaded
        result, _ = ensure_repo_loaded(repo_id)
        if not result:
            raise HTTPException(
                status_code=404,
                detail="Repo not found. Run /api/analyze first, or the repo may have expired."
            )

        # 1. Detect if the question is technical/architectural
        query_lower = body.query.lower()
        is_technical = any(kw in query_lower for kw in _TECHNICAL_KEYWORDS)

        # 2. Retrieve Context from Zilliz (blocking network I/O)
        if is_technical:
            results = await _run_sync(
                zilliz_client.search, body.query, repo_id,
                limit=8, layer_filter="exclude_frontend",
            )
        else:
            results = await _run_sync(
                zilliz_client.search, body.query, repo_id, limit=5,
            )

        if not results:
            return {"success": False, "error": "No relevant code context found. Ensure the repository was fully indexed."}

        context_blocks = []
        for i, res in enumerate(results):
            chunk_text = res['text']
            start_line = res.get('start_line', 0)

            # Prepend actual line numbers to each line of code so the LLM
            # sees them and naturally preserves them when picking subsets.
            if start_line > 0:
                raw_lines = chunk_text.split('\n')
                numbered_lines = [
                    f"{start_line + j} | {line}"
                    for j, line in enumerate(raw_lines)
                ]
                display_text = '\n'.join(numbered_lines)
            else:
                display_text = chunk_text

            context_blocks.append(
                f"--- Context {i+1} ---\n"
                f"File: {res['file_path']}\n"
                f"Role: {res['role']}\n"
                f"Language: {res.get('language', 'Unknown')}\n"
                f"Layer: {res.get('layer', 'other')}\n"
                f"Code Snippet:\n{display_text}\n"
            )

        combined_context = "\n".join(context_blocks)

        # 3. Build the Prompt — architecture-focused for deeper answers
        system_prompt = (
            "You are an expert AI engineer analyzing a codebase. You have "
            "deep knowledge of software architecture, RAG pipelines, "
            "embedding strategies, vector databases, API design, and "
            "system design patterns.\n\n"
            "You are provided with code snippets retrieved from the "
            "repository. Answer the user's question using the provided "
            "context.\n\n"
            "Rules:\n"
            "1. Focus on ARCHITECTURE, DESIGN DECISIONS, and ENGINEERING "
            "TRADE-OFFS — not surface-level code descriptions.\n"
            "2. When asked technical questions, discuss: why certain patterns "
            "were chosen, what alternatives exist, scalability implications, "
            "and potential improvements.\n"
            "3. When showing relevant code, include ONLY the relevant portion "
            "in a fenced code block. The opening fence MUST use this format:\n"
            "   ```language:path/to/file.py\n"
            "IMPORTANT: Each line in the code snippets is prefixed with its "
            "real line number like '54 | code here'. You MUST preserve these "
            "prefixes exactly as-is when showing code. Do NOT remove them, "
            "do NOT renumber them, do NOT add your own numbers. Example:\n"
            "   ```python:codekavi/indexer.py\n"
            "   54 | def index_repository(repo_id, file_profiles, clone_path):\n"
            "   55 |     logger.info(f\"Starting indexing...\")\n"
            "   56 |     collection = zilliz_client.setup_collection()\n"
            "   ```\n"
            "4. If the retrieved context doesn't contain relevant backend/AI "
            "code, say so honestly instead of discussing irrelevant UI code.\n"
            "5. Structure answers with clear sections and bullet points.\n"
            "6. When discussing RAG: cover chunking strategy, embedding model "
            "choice, retrieval method, context window management, and "
            "prompt engineering.\n\n"
            f"--- RETRIEVED CONTEXT ---\n{combined_context}\n--------------------------"
        )

        # 4. Call LLM
        provider = get_provider("chat")

        messages = [
            Message(role="system", content=system_prompt),
            Message(role="user", content=body.query)
        ]

        response = await _run_sync(
            provider.complete,
            messages=messages,
            temperature=0.4,
            max_tokens=2048,
        )

        return {
            "success": True,
            "repo_id": repo_id,
            "answer": response.content,
            "sources": [{"file_path": r["file_path"], "score": r["score"]} for r in results]
        }

    except HTTPException:
        raise  # Re-raise our own HTTP exceptions (400, 404, 503)
    except Exception as e:
        logger.error(f"Chat RAG error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
