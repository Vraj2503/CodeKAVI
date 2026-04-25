import os
import time
import hashlib
import logging
from typing import List, Dict, Any

from dotenv import load_dotenv
load_dotenv()

from google import genai
from langchain_text_splitters import RecursiveCharacterTextSplitter

from codekavi.vectorstore import zilliz_client

logger = logging.getLogger(__name__)

# ── Configuration ──
BATCH_SIZE = 20          # Keep well under free-tier 100 req/min limit
BATCH_DELAY_S = 1.5      # Pause between batches to avoid rate-limit bursts
MAX_RETRIES = 4           # Retry attempts on transient / rate-limit errors
INITIAL_BACKOFF_S = 10    # First retry waits this long; doubles each attempt


def get_genai_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:
        logger.error(f"Error initializing GenAI client: {e}")
        return None


def _embed_with_retry(client, texts: List[str]) -> List[List[float]]:
    """
    Call Gemini embed_content with exponential backoff on rate-limit (429) errors.
    Raises on non-retryable failures after exhausting retries.
    """
    backoff = INITIAL_BACKOFF_S

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.embed_content(
                model="gemini-embedding-001",
                contents=texts,
            )
            return [emb.values for emb in response.embeddings]

        except Exception as e:
            err_str = str(e)
            is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

            if is_rate_limit and attempt < MAX_RETRIES:
                logger.warning(
                    f"Rate-limited (attempt {attempt}/{MAX_RETRIES}). "
                    f"Waiting {backoff:.0f}s before retry…"
                )
                time.sleep(backoff)
                backoff *= 2  # exponential backoff
                continue
            else:
                raise  # non-retryable or exhausted retries


def index_repository(
    repo_id: str,
    file_profiles: List[Dict[str, Any]],
    clone_path: str,
) -> bool:
    """
    Chunks source code files and embeds them using Gemini,
    then inserts into Zilliz database.
    """
    logger.info(f"Starting vector indexing for repo {repo_id}…")
    print(f"Starting vector indexing for repo {repo_id}...")

    # 1. Setup Collection & Client
    try:
        collection = zilliz_client.setup_collection()
    except Exception as e:
        logger.error(f"Failed to setup Zilliz collection: {e}")
        return False

    client = get_genai_client()
    if not client:
        logger.warning("GenAI client not available. Skipping indexing.")
        return False

    # Clear old data for this repo
    zilliz_client.clear_repo(repo_id)

    # 2. Text Splitter – optimized for code
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500,
        chunk_overlap=200,
        length_function=len,
        is_separator_regex=False,
    )

    # Batch accumulators
    current_batch_texts: List[str] = []
    current_batch_metadata: List[Dict[str, str]] = []
    total_chunks_attempted = 0
    total_chunks_inserted = 0

    def flush_batch():
        nonlocal current_batch_texts, current_batch_metadata
        nonlocal total_chunks_attempted, total_chunks_inserted

        if not current_batch_texts:
            return

        batch_len = len(current_batch_texts)
        total_chunks_attempted += batch_len

        try:
            # Generate embeddings (with retry on rate-limit)
            embeddings = _embed_with_retry(client, current_batch_texts)

            ids = [m["id"] for m in current_batch_metadata]
            repo_ids = [m["repo_id"] for m in current_batch_metadata]
            file_paths = [m["file_path"] for m in current_batch_metadata]
            roles = [m["role"] for m in current_batch_metadata]

            insert_data = [
                ids,
                repo_ids,
                file_paths,
                roles,
                current_batch_texts,
                embeddings,
            ]

            collection.insert(insert_data)
            total_chunks_inserted += batch_len
            print(
                f"  ✓ Inserted {batch_len} chunks "
                f"(Total: {total_chunks_inserted}/{total_chunks_attempted})"
            )

        except Exception as e:
            logger.error(
                f"Failed batch of {batch_len} chunks after {MAX_RETRIES} attempts: {e}"
            )
            print(f"  ✗ Lost {batch_len} chunks: {e}")

        # Reset batch regardless of success/failure
        current_batch_texts.clear()
        current_batch_metadata.clear()

    # 3. Process each file
    for profile in file_profiles:
        file_path = profile["path"]
        role = profile.get("role_label", "Unknown")

        abs_path = os.path.join(clone_path, file_path)
        if not os.path.exists(abs_path):
            continue

        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue

        if not content.strip():
            continue

        chunks = text_splitter.split_text(content)

        # Consistent stable hash for file
        file_hash = hashlib.md5(file_path.encode()).hexdigest()[:10]

        for i, chunk in enumerate(chunks):
            chunk_id = f"{repo_id[:20]}_{file_hash}_{i}"

            if len(chunk) > 65000:
                chunk = chunk[:65000]

            current_batch_texts.append(chunk)
            current_batch_metadata.append(
                {
                    "id": chunk_id,
                    "repo_id": repo_id[:64],
                    "file_path": file_path[:512],
                    "role": role[:64],
                }
            )

            if len(current_batch_texts) >= BATCH_SIZE:
                flush_batch()
                # Pause between batches to respect rate limits
                time.sleep(BATCH_DELAY_S)

    # Flush remaining
    flush_batch()

    lost = total_chunks_attempted - total_chunks_inserted
    summary = (
        f"Finished indexing for {repo_id}: "
        f"{total_chunks_inserted}/{total_chunks_attempted} chunks inserted"
    )
    if lost > 0:
        summary += f" ({lost} lost due to errors)"
        logger.warning(summary)
    else:
        logger.info(summary)
    print(summary)

    return total_chunks_inserted > 0
