"""
routes/chat.py — RAG-powered chat endpoint.

Endpoints:
    POST /chat/{repo_id} — Ask a question about a previously analyzed repo.
"""

import logging

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Request

from codekavi.auth import verify_supabase_token
from codekavi.cache import AnalysisCache
from codekavi.exceptions import RateLimitError
from codekavi.limiter import per_minute
from codekavi.llm import get_provider
from codekavi.llm.prompts import UNTRUSTED_CODE_DISCLAIMER
from codekavi.llm.providers import Message
from codekavi.quota import get_token_tracker
from codekavi.routes._errors import internal_error
from codekavi.routes.dependencies import get_cache
from codekavi.schemas import ChatRequest
from codekavi.session import assert_repo_owner
from codekavi.utils import run_sync as _run_sync

router = APIRouter()
logger = logging.getLogger(__name__)

# Sprint-4 / C4 — skip redundant ensure_repo_loaded calls.
# Set of repo_ids validated within the last _VALIDATION_TTL seconds.
_VALIDATION_TTL = 300  # seconds (5 minutes)
_validated_repos: TTLCache = TTLCache(maxsize=2048, ttl=_VALIDATION_TTL)


# Keywords that signal a technical/architecture question
_TECHNICAL_KEYWORDS = [
    "architecture",
    "rag",
    "pipeline",
    "embedding",
    "vector",
    "backend",
    "api",
    "database",
    "engineer",
    "technical",
    "system design",
    "infrastructure",
    "deployment",
    "security",
    "authentication",
    "middleware",
    "service",
    "model",
    "schema",
    "algorithm",
    "indexer",
    "orchestrator",
    "provider",
    "llm",
    "chunking",
    "retrieval",
    "prompt",
]


@router.post("/chat/{repo_id}", dependencies=[Depends(per_minute(5))])
async def chat_repo(
    request: Request,
    repo_id: str,
    body: ChatRequest,
    cache: AnalysisCache = Depends(get_cache),
    user_id: str = Depends(verify_supabase_token),
):
    """
    RAG endpoint that searches the Zilliz vector store for relevant code context
    and answers the user's question using the LLM.

    For technical/architecture questions, retrieves more chunks (top_k=8)
    and filters out frontend/test code for higher relevance.

    T4.1 — quota gate. Raises HTTP 429 with ``quota_exceeded`` if the
    authenticated user is over their daily token budget (only enforced
    when ``settings.enforce_token_quota`` is True).
    """
    from codekavi.settings import settings

    tracker = get_token_tracker()
    if not tracker.check_quota(user_id):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "message": "Daily LLM token quota exceeded. Please retry tomorrow.",
                "remaining_tokens": tracker.get_remaining(user_id),
                "enforced": settings.enforce_token_quota,
            },
        )

    # Validate repo_id format early (must be 12-char hex from clone_repo)
    import re

    if not re.match(r"^[a-f0-9]{12}$", repo_id):
        raise HTTPException(
            status_code=400, detail=f"Invalid repo_id format: {repo_id!r}. Must be a 12-character hex string."
        )

    try:
        from codekavi.vectorstore import zilliz_client

        # Check Zilliz is configured before attempting search
        if not zilliz_client.uri or not zilliz_client.token:
            raise HTTPException(
                status_code=503,
                detail="Vector store not configured. Set ZILLIZ_URI and ZILLIZ_API_KEY environment variables.",
            )

        # Verify repo exists in our cache (ensures we can serve other endpoints too)
        # Sprint-4 / C4: skip the full L1→L2→L3 cache walk when the repo
        # was already validated recently and L1 still holds its data.
        _skip_full_load = False
        if repo_id in _validated_repos:
            l1_result = cache._memory.get(repo_id)
            if l1_result is not None:
                assert_repo_owner(l1_result, user_id)
                result = l1_result
                _skip_full_load = True
                logger.debug("C4: skipped ensure_repo_loaded for %s (L1 hit, recently validated)", repo_id)

        if not _skip_full_load:
            from codekavi.session import ensure_repo_loaded

            result, _ = await _run_sync(ensure_repo_loaded, repo_id, cache, user_id)
            if result:
                _validated_repos[repo_id] = True

        if not result:
            raise HTTPException(
                status_code=404, detail="Repo not found. Run /api/analyze first, or the repo may have expired."
            )

        # 1. Detect if the question is technical/architectural
        query_lower = body.query.lower()
        is_technical = any(kw in query_lower for kw in _TECHNICAL_KEYWORDS)

        # 2. Retrieve Context from Zilliz (network I/O, now natively async)
        if is_technical:
            results = await zilliz_client.search(
                body.query,
                repo_id,
                limit=8,
                layer_filter="exclude_frontend",
            )
        else:
            results = await zilliz_client.search(
                body.query,
                repo_id,
                limit=5,
            )

        if not results:
            return {
                "success": False,
                "error": "No relevant code context found. Ensure the repository was fully indexed.",
            }

        context_blocks = []
        for i, res in enumerate(results):
            chunk_text = res["text"]
            start_line = res.get("start_line", 0)

            # Prepend actual line numbers to each line of code so the LLM
            # sees them and naturally preserves them when picking subsets.
            if start_line > 0:
                raw_lines = chunk_text.split("\n")
                numbered_lines = [f"{start_line + j} | {line}" for j, line in enumerate(raw_lines)]
                display_text = "\n".join(numbered_lines)
            else:
                display_text = chunk_text

            context_blocks.append(
                f"--- Context {i + 1} ---\n"
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
            '   55 |     logger.info(f"Starting indexing...")\n'
            "   56 |     collection = zilliz_client.setup_collection()\n"
            "   ```\n"
            "4. If the retrieved context doesn't contain relevant backend/AI "
            "code, say so honestly instead of discussing irrelevant UI code.\n"
            "5. Structure answers with clear sections and bullet points.\n"
            "6. When discussing RAG: cover chunking strategy, embedding model "
            "choice, retrieval method, context window management, and "
            "prompt engineering.\n\n"
            f"{UNTRUSTED_CODE_DISCLAIMER}\n\n"
            f"--- RETRIEVED CONTEXT ---\n{combined_context}\n--------------------------"
        )

        # 4. Call LLM
        # Support multi-model: if user explicitly requests gemini, use it
        if body.model and "gemini" in body.model.lower():
            provider = get_provider("gemini")
        else:
            provider = get_provider("groq")

        messages = [Message(role="system", content=system_prompt), Message(role="user", content=body.query)]

        try:
            response = await _run_sync(
                provider.complete,
                messages=messages,
                temperature=0.4,
                max_tokens=2048,
            )
        except RateLimitError as e:
            if provider.name == "groq":
                logger.warning(f"Groq rate limit hit during chat, falling back to Gemini: {e}")
                provider = get_provider("gemini")
                response = await _run_sync(
                    provider.complete,
                    messages=messages,
                    temperature=0.4,
                    max_tokens=2048,
                )
            else:
                raise

        # H-03 — record actual token usage against the per-user daily quota.
        # Without this, check_quota() gates nothing since usage never accrues.
        tokens_used = response.usage.get("total_tokens", 0) if response.usage else 0
        tracker.record(user_id, provider=provider.name, tokens=tokens_used)

        return {
            "success": True,
            "repo_id": repo_id,
            "answer": response.content,
            "provider_used": provider.name,
            "sources": [{"file_path": r["file_path"], "score": r["score"]} for r in results],
        }

    except HTTPException:
        raise  # Re-raise our own HTTP exceptions (400, 404, 503)
    except Exception as e:
        raise internal_error(e, context="Chat RAG error") from e


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, user_id: str = Depends(verify_supabase_token)):
    """
    Delete a chat session and all its messages.
    Uses the backend service key to bypass frontend RLS if a DELETE policy is missing.
    """
    try:
        from supabase import ClientOptions, create_client

        from codekavi.settings import settings

        options = ClientOptions(postgrest_client_timeout=10)
        supabase = create_client(settings.supabase_url, settings.supabase_service_key, options=options)

        # Delete the session only if it belongs to the authenticated user
        result = supabase.table("sessions").delete().eq("id", session_id).eq("user_id", user_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found or not owned by user.")

        return {"success": True, "message": "Session deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e, context=f"Failed to delete session {session_id}") from e
