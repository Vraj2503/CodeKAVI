import asyncio
import hashlib
import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter

from rune.config import detect_language
from rune.config import detect_layer as _detect_layer
from rune.embedding import CloudflareEmbedding
from rune.exceptions import IndexingError
from rune.index_status import INTERRUPTED, IndexOutcome, make_status, record_index_status, status_from_outcome
from rune.settings import settings
from rune.vectorstore import zilliz_client

load_dotenv()

logger = logging.getLogger(__name__)

# ── Configuration ──
BATCH_SIZE = 20  # chunks per embedding request
MAX_RETRIES = 6  # Retry attempts on transient / rate-limit errors
INITIAL_BACKOFF_S = 20  # Start at 20s; doubles each attempt on 429


def _chunk_line_spans(content: str, chunks: list[str], file_path: str) -> list[tuple[int, int]]:
    """1-based (start_line, end_line) for each chunk, in order.

    The splitter emits exact substrings of ``content`` in document order, so
    each chunk is found by searching forward from just past the previous
    chunk's start (chunks overlap, so the next one starts before the previous
    one ends). Line numbers advance by counting only the newlines between
    successive offsets, instead of re-slicing the file from the top per chunk.

    A chunk the forward search misses is retried from the top of the file. One
    that isn't in the file at all gets (0, 0), the value chat already treats as
    "no line numbers", and is logged rather than stored silently.
    """
    spans: list[tuple[int, int]] = []
    search_from = 0
    cursor, cursor_line = 0, 1  # an offset and its 1-based line number
    for index, chunk in enumerate(chunks):
        offset = content.find(chunk, search_from)
        if offset == -1:
            offset = content.find(chunk)
        if offset == -1:
            logger.warning(f"Chunk {index} of {file_path} not found in the file; storing it without line numbers")
            spans.append((0, 0))
            continue
        if offset >= cursor:
            cursor_line += content.count("\n", cursor, offset)
            cursor = offset
            start_line = cursor_line
        else:  # only reachable through the retry: an occurrence behind the cursor
            start_line = content.count("\n", 0, offset) + 1
        spans.append((start_line, start_line + chunk.count("\n")))
        search_from = max(search_from, offset + 1)
    return spans


async def _flush_batch(
    collection: Any,
    embedder: CloudflareEmbedding,
    repo_id: str,
    texts: list[str],
    metadata: list[dict[str, Any]],
) -> int:
    """Embed and insert one batch; return how many rows were persisted.

    The caller hands this batch over and never touches ``texts`` or
    ``metadata`` again, so nothing mutable is shared across the awaits below
    or across the thread boundary into ``collection.insert``. A failed batch is
    logged and reported as 0 rows persisted rather than raised.
    """
    batch_len = len(texts)
    try:
        embeddings = await embedder.embed_texts(texts)
        # M-23: insert_data below zips embeddings against metadata
        # positionally with no length check — if Cloudflare returns
        # fewer/misordered vectors, chunks get stored against the wrong
        # embeddings and RAG silently cites the wrong source lines.
        # Fail the whole batch loudly instead so it's counted as lost.
        if len(embeddings) != batch_len:
            raise IndexingError(f"embedding count {len(embeddings)} != texts {batch_len} for {repo_id}")
        provider_name = "cloudflare"

        insert_data = [
            [m["id"] for m in metadata],
            [m["repo_id"] for m in metadata],
            [m["file_path"] for m in metadata],
            [m["role"] for m in metadata],
            [m["language"] for m in metadata],
            [m["layer"] for m in metadata],
            [m["start_line"] for m in metadata],
            [m["end_line"] for m in metadata],
            texts,
            [provider_name] * batch_len,
            embeddings,
        ]

        mr = await asyncio.to_thread(collection.insert, insert_data)
        # M-14: don't assume a full insert just because insert() didn't
        # raise — a partial insert (fewer primary_keys than rows sent)
        # would otherwise silently count as "N/N inserted".
        verified = len(getattr(mr, "primary_keys", []) or [])
        if verified and verified != batch_len:
            logger.warning(f"Partial insert for {repo_id}: {verified}/{batch_len} rows persisted")
        return verified or batch_len

    except Exception as e:
        logger.error(f"Failed batch of {batch_len} chunks after {MAX_RETRIES} attempts: {e}")
        logger.warning(f"Lost {batch_len} chunks: {e}")
        return 0


async def index_repository(
    repo_id: str,
    file_profiles: list[dict[str, Any]],
    clone_path: str,
) -> IndexOutcome:
    """
    Chunks source code files, embeds them with Cloudflare Workers AI,
    and inserts the vectors into Zilliz. Returns what the run achieved.
    """
    logger.info(f"Starting vector indexing for repo {repo_id}…")

    # 1. Setup Collection & Client
    try:
        collection = zilliz_client.setup_collection()
    except Exception as e:
        logger.error(f"Failed to setup Zilliz collection: {e}")
        return IndexOutcome(error="vector_store_unavailable")

    try:
        cf_client = CloudflareEmbedding()
    except ValueError as e:
        logger.warning(f"Embedding configuration missing: {e}. Skipping indexing.")
        return IndexOutcome(error="embedding_not_configured")

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
    batch_texts: list[str] = []
    batch_metadata: list[dict[str, Any]] = []
    attempted = 0
    inserted = 0

    async def dispatch() -> None:
        nonlocal batch_texts, batch_metadata, attempted, inserted
        if not batch_texts:
            return
        # Snapshot-and-hand-off: take the accumulated batch and start fresh
        # accumulators before any await. The flushed lists are never touched
        # again, so whatever the embedder or the insert thread still holds
        # stays intact even once batches are flushed concurrently.
        texts, metadata = batch_texts, batch_metadata
        batch_texts, batch_metadata = [], []
        attempted += len(texts)

        persisted = await _flush_batch(collection, cf_client, repo_id, texts, metadata)
        inserted += persisted
        if persisted:
            logger.info(f"  Inserted {persisted} chunks via cloudflare (Total: {inserted}/{attempted})")
            if settings.indexer_batch_delay_s > 0:
                await asyncio.sleep(settings.indexer_batch_delay_s)

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
        spans = _chunk_line_spans(content, chunks, file_path)

        # Consistent stable hash for file
        file_hash = hashlib.md5(file_path.encode()).hexdigest()[:10]

        for i, (chunk, (start_line, end_line)) in enumerate(zip(chunks, spans, strict=True)):
            chunk_id = f"{repo_id[:20]}_{file_hash}_{i}"

            encoded_chunk = chunk.encode("utf-8")
            if len(encoded_chunk) > 65000:
                chunk = encoded_chunk[:65000].decode("utf-8", "ignore")

            batch_texts.append(chunk)
            batch_metadata.append(
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

            if len(batch_texts) >= BATCH_SIZE:
                await dispatch()

    # Flush remaining
    await dispatch()

    lost = attempted - inserted
    summary = f"Finished indexing for {repo_id}: {inserted}/{attempted} chunks inserted"
    if attempted == 0:
        logger.error(f"{summary} — no chunks were attempted; RAG will serve empty contexts for this repo")
    elif lost > 0:
        summary += f" ({lost} lost due to errors)"
        logger.warning(summary)
    else:
        logger.info(summary)

    return IndexOutcome(attempted=attempted, inserted=inserted)


async def index_repository_and_record(
    repo_id: str,
    file_profiles: list[Any],
    clone_path: str,
    cache: Any,
) -> None:
    """Background-task entry point: index the repo, then record the outcome
    on its cached analysis so a failed or unfinished index is visible."""
    try:
        outcome = await index_repository(repo_id, file_profiles, clone_path)
    except asyncio.CancelledError:
        await record_index_status(cache, repo_id, make_status(INTERRUPTED))
        raise
    except Exception:
        await record_index_status(cache, repo_id, status_from_outcome(IndexOutcome(error="indexing_crashed")))
        raise
    await record_index_status(cache, repo_id, status_from_outcome(outcome))
