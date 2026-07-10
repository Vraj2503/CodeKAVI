import hashlib
import logging
import os
import time
import asyncio
from typing import Any

from dotenv import load_dotenv
from google import genai
from langchain_text_splitters import RecursiveCharacterTextSplitter

from codekavi.config import detect_language
from codekavi.config import detect_layer as _detect_layer
from codekavi.settings import settings
from codekavi.vectorstore import zilliz_client

load_dotenv()

logger = logging.getLogger(__name__)

# ── Configuration ──
BATCH_SIZE = 20  # Gemini batch-embed accepts up to ~100 items/call; 20 is safe
MAX_RETRIES = 6  # Retry attempts on transient / rate-limit errors
INITIAL_BACKOFF_S = 20  # Start at 20s; doubles each attempt on 429


from codekavi.embedding import CloudflareEmbedding


async def index_repository(
    repo_id: str,
    file_profiles: list[dict[str, Any]],
    clone_path: str,
) -> bool:
    """
    Chunks source code files and embeds them using Gemini,
    then inserts into Zilliz database.
    """
    logger.info(f"Starting vector indexing for repo {repo_id}…")

    # 1. Setup Collection & Client
    try:
        collection = zilliz_client.setup_collection()
    except Exception as e:
        logger.error(f"Failed to setup Zilliz collection: {e}")
        return False

    try:
        cf_client = CloudflareEmbedding()
    except ValueError as e:
        logger.warning(f"Embedding configuration missing: {e}. Skipping indexing.")
        return False

    # Clear old data for this repo
    zilliz_client.clear_repo(repo_id)

    # 2. Text Splitter - optimized for code
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500,
        chunk_overlap=200,
        length_function=len,
        is_separator_regex=False,
    )

    # Batch accumulators
    current_batch_texts: list[str] = []
    current_batch_metadata: list[dict[str, Any]] = []
    total_chunks_attempted = 0
    total_chunks_inserted = 0

    async def flush_batch():
        nonlocal current_batch_texts, current_batch_metadata
        nonlocal total_chunks_attempted, total_chunks_inserted

        if not current_batch_texts:
            return

        batch_len = len(current_batch_texts)
        total_chunks_attempted += batch_len

        try:
            embeddings = await cf_client.embed_texts(current_batch_texts)
            provider_name = "cloudflare"

            ids = [m["id"] for m in current_batch_metadata]
            repo_ids = [m["repo_id"] for m in current_batch_metadata]
            file_paths = [m["file_path"] for m in current_batch_metadata]
            roles = [m["role"] for m in current_batch_metadata]
            languages = [m["language"] for m in current_batch_metadata]
            layers = [m["layer"] for m in current_batch_metadata]
            start_lines = [m["start_line"] for m in current_batch_metadata]
            end_lines = [m["end_line"] for m in current_batch_metadata]
            providers = [provider_name] * batch_len

            insert_data = [
                ids,
                repo_ids,
                file_paths,
                roles,
                languages,
                layers,
                start_lines,
                end_lines,
                current_batch_texts,
                providers,
                embeddings,
            ]

            await asyncio.to_thread(collection.insert, insert_data)
            total_chunks_inserted += batch_len
            logger.info(
                f"  Inserted {batch_len} chunks via {provider_name} (Total: {total_chunks_inserted}/{total_chunks_attempted})"
            )

        except Exception as e:
            logger.error(f"Failed batch of {batch_len} chunks after {MAX_RETRIES} attempts: {e}")
            logger.warning(f"Lost {batch_len} chunks: {e}")

        # Reset batch regardless of success/failure
        current_batch_texts.clear()
        current_batch_metadata.clear()

    # 3. Process each file
    for profile in file_profiles:
        p_dict = profile.model_dump() if hasattr(profile, "model_dump") else profile
        file_path = p_dict["path"]
        role = p_dict.get("role_label", "Unknown")

        abs_path = os.path.join(clone_path, file_path)
        if not os.path.exists(abs_path):
            logger.warning(f"File skipped in indexer: path {abs_path} does not exist.")
            continue

        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()

            if file_path.endswith(".ipynb"):
                try:
                    import json

                    nb_data = json.loads(content)
                    extracted_lines = []
                    for cell in nb_data.get("cells", []):
                        if cell.get("cell_type") in ("code", "markdown"):
                            source = cell.get("source", [])
                            if isinstance(source, list):
                                extracted_lines.extend(source)
                            else:
                                extracted_lines.append(source)
                    content = "\n".join(extracted_lines)
                except Exception as e:
                    logger.warning(f"Failed to parse notebook {file_path}, falling back to raw text: {e}")

        except Exception as e:
            logger.warning(f"File skipped in indexer: failed to read {abs_path}: {e}")
            continue

        if not content.strip():
            logger.warning(f"File skipped in indexer: content is empty for {file_path}")
            continue

        chunks = text_splitter.split_text(content)

        # Consistent stable hash for file
        file_hash = hashlib.md5(file_path.encode()).hexdigest()[:10]

        # Compute exact line numbers for each chunk by locating it
        # in the original file content
        search_start = 0
        for i, chunk in enumerate(chunks):
            chunk_id = f"{repo_id[:20]}_{file_hash}_{i}"

            # Find chunk position in original content to get exact lines
            char_offset = content.find(chunk, search_start)
            if char_offset == -1:
                # Fallback: if exact match fails (e.g. truncation), use 0
                start_line = 0
                end_line = 0
            else:
                start_line = content[:char_offset].count("\n") + 1
                end_line = start_line + chunk.count("\n")
                # Advance search_start past this chunk's start to handle
                # overlapping chunks correctly
                search_start = char_offset + 1

            if len(chunk) > 65000:
                chunk = chunk[:65000]

            current_batch_texts.append(chunk)
            current_batch_metadata.append(
                {
                    "id": chunk_id,
                    "repo_id": repo_id[:64],
                    "file_path": file_path[:512],
                    "role": role[:64],
                    "language": detect_language(file_path)[:64],
                    "layer": _detect_layer(file_path)[:32],
                    "start_line": start_line,
                    "end_line": end_line,
                }
            )

            if len(current_batch_texts) >= BATCH_SIZE:
                await flush_batch()
                # No inter-batch delay needed — rate limits are handled
                # per-API-call in _embed_with_retry via exponential backoff

    # Flush remaining
    await flush_batch()

    lost = total_chunks_attempted - total_chunks_inserted
    summary = f"Finished indexing for {repo_id}: {total_chunks_inserted}/{total_chunks_attempted} chunks inserted"
    if total_chunks_attempted == 0:
        logger.error(f"{summary} — no chunks were attempted; RAG will serve empty contexts for this repo")
    elif lost > 0:
        summary += f" ({lost} lost due to errors)"
        logger.warning(summary)
    else:
        logger.info(summary)

    return total_chunks_inserted > 0
