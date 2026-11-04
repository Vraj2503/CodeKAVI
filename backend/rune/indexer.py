import asyncio
import bisect
import hashlib
import json
import logging
import os
import time
from typing import Any

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter

from rune.config import detect_language, is_test_path
from rune.config import detect_layer as _detect_layer
from rune.embedding import EmbeddingProviderUnavailable, select_index_embedding_provider
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


def _local_token_chunks(content: str, embedder: Any) -> list[str]:
    """Split exact source substrings so each local request fits its tokenizer.

    Tokenizes content in a single pass with token character offsets (S1), preserving
    exact slices of content for _chunk_line_spans.
    """
    if not content:
        return []

    doc_prefix_tokens = embedder.document_token_count("")
    chunk_tokens = getattr(embedder, "chunk_tokens", 512)
    target_tokens = max(16, chunk_tokens - doc_prefix_tokens)
    overlap_tokens = max(0, min(settings.local_embedding_chunk_overlap_tokens, target_tokens - 1))

    encoding = embedder.tokenizer.encode(content)
    text_offsets = [o for o in encoding.offsets if o[0] < o[1]]
    num_tokens = len(text_offsets)

    if num_tokens <= target_tokens:
        return [content]

    chunks: list[str] = []
    t_start = 0
    starts = [o[0] for o in text_offsets]
    ends = [o[1] for o in text_offsets]

    while t_start < num_tokens:
        t_end = min(t_start + target_tokens, num_tokens)
        char_start = starts[t_start]
        char_end = ends[t_end - 1]

        if t_end < num_tokens:
            boundary = -1
            for sep in ("\n\n", "\n"):
                pos = content.rfind(sep, char_start + 1, char_end)
                if pos > char_start + (char_end - char_start) // 2:
                    boundary = pos + len(sep) if pos + len(sep) <= char_end else pos
                    break
            if boundary <= char_start:
                pos = content.rfind(" ", char_start + 1, char_end)
                if pos > char_start:
                    boundary = pos
            if boundary > char_start:
                char_end = boundary

        chunk = content[char_start:char_end]
        if not chunk:
            break
        chunks.append(chunk)

        if t_end >= num_tokens:
            break

        t_cut = bisect.bisect_left(ends, char_end, lo=t_start, hi=t_end)
        if overlap_tokens == 0:
            t_start = max(t_start + 1, t_cut)
        else:
            t_start = max(t_start + 1, t_cut - overlap_tokens)
            if t_start < num_tokens:
                c_start = starts[t_start]
                nl = content.find("\n", c_start, min(char_end, c_start + 100))
                if nl != -1 and nl + 1 < char_end:
                    idx = bisect.bisect_left(starts, nl + 1, lo=t_start, hi=t_cut)
                    if idx < t_cut:
                        t_start = idx

    return chunks


def _chunks_for_provider(content: str, embedder: Any) -> list[str]:
    """Keep Cloudflare's character splitter unchanged; local uses tokenizer limits."""
    if not getattr(embedder, "is_local", False):
        return RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=200,
            length_function=len,
            is_separator_regex=False,
        ).split_text(content)
    return _local_token_chunks(content, embedder)


async def _embed_batch(embedder: Any, repo_id: str, texts: list[str]) -> tuple[list[list[float]] | None, float]:
    """Embed one batch; return its vectors (None when the batch is lost) and the seconds it took.

    A failed batch is logged and reported as lost rather than raised, and its
    time is not counted as embedding time.
    """
    batch_len = len(texts)
    try:
        embedding_started = time.perf_counter()
        embeddings = await embedder.embed_texts(texts)
        embedding_seconds = time.perf_counter() - embedding_started
        # M-23: insert_data zips embeddings against metadata positionally
        # with no length check — if Cloudflare returns fewer/misordered
        # vectors, chunks get stored against the wrong embeddings and RAG
        # silently cites the wrong source lines. Fail the whole batch loudly
        # instead so it's counted as lost.
        if len(embeddings) != batch_len:
            raise IndexingError(f"embedding count {len(embeddings)} != texts {batch_len} for {repo_id}")
        return embeddings, embedding_seconds
    except Exception as e:
        logger.error(f"Failed batch of {batch_len} chunks after {MAX_RETRIES} attempts: {e}")
        logger.warning(f"Lost {batch_len} chunks: {e}")
        return None, 0.0


async def _insert_batch(
    collection: Any,
    embedder: Any,
    repo_id: str,
    texts: list[str],
    metadata: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> tuple[int, float]:
    """Insert one embedded batch; return the rows persisted and the seconds it took.

    The caller hands this batch over and never touches ``texts`` or
    ``metadata`` again, so nothing mutable is shared across the thread
    boundary into ``collection.insert`` — which matters now that the next
    batch is being built and embedded while this insert runs. A failed
    insert is logged and reported as 0 rows persisted rather than raised.
    """
    batch_len = len(texts)
    try:
        provider_name = getattr(embedder, "identity", "cloudflare")
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

        insert_started = time.perf_counter()
        mr = await asyncio.to_thread(collection.insert, insert_data)
        insert_seconds = time.perf_counter() - insert_started
        # M-14: don't assume a full insert just because insert() didn't
        # raise — a partial insert (fewer primary_keys than rows sent)
        # would otherwise silently count as "N/N inserted".
        verified = len(getattr(mr, "primary_keys", []) or [])
        if verified and verified != batch_len:
            logger.warning(f"Partial insert for {repo_id}: {verified}/{batch_len} rows persisted")
        return verified or batch_len, insert_seconds

    except Exception as e:
        logger.error(f"Failed to insert a batch of {batch_len} chunks: {e}")
        logger.warning(f"Lost {batch_len} chunks: {e}")
        return 0, 0.0


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

    # Select and (for LM Studio) preflight the provider before clearing this
    # repo. A local outage can therefore fall back for the *entire* index.
    try:
        selection = await select_index_embedding_provider(repo_id)
    except EmbeddingProviderUnavailable as e:
        logger.warning("Embedding provider unavailable before indexing %s: %s", repo_id, e.reason)
        return IndexOutcome(error=e.reason)
    embedder = selection.provider
    embedding_identity = getattr(embedder, "identity", "cloudflare")

    # 1. Setup Collection & Client
    try:
        collection = zilliz_client.setup_collection()
    except Exception as e:
        logger.error(f"Failed to setup Zilliz collection: {e}")
        return IndexOutcome(error="vector_store_unavailable", embedding_identity=embedding_identity)

    # Clear old data for this repo only after provider selection succeeds.
    zilliz_client.clear_repo(repo_id)

    # Batch accumulators
    is_local = getattr(embedder, "is_local", False)
    batch_size = settings.local_embedding_batch_size if is_local else BATCH_SIZE
    batch_texts: list[str] = []
    batch_metadata: list[dict[str, Any]] = []
    attempted = 0
    inserted = 0
    embedding_seconds = 0.0
    insert_seconds = 0.0
    skipped_tests = 0
    # T9: a batch's Zilliz insert runs while the next batch is embedded, so the
    # embedder no longer sits idle through every insert. At most one insert is
    # in flight: batches land in order, never race each other in
    # collection.insert, and a slow vector store holds the producer back
    # instead of piling up embedded batches in memory.
    pending_insert: asyncio.Task[tuple[int, float]] | None = None

    async def settle_insert() -> None:
        nonlocal pending_insert, inserted, insert_seconds
        if pending_insert is None:
            return
        task, pending_insert = pending_insert, None
        persisted, batch_insert_seconds = await task
        insert_seconds += batch_insert_seconds
        inserted += persisted
        if persisted:
            logger.info(
                "  Inserted %s chunks via %s (Total: %s/%s)",
                persisted,
                embedding_identity,
                inserted,
                attempted,
            )

    async def dispatch() -> None:
        nonlocal batch_texts, batch_metadata, attempted, embedding_seconds, pending_insert
        if not batch_texts:
            return
        # Snapshot-and-hand-off: take the accumulated batch and start fresh
        # accumulators before any await. The flushed lists are never touched
        # again, so whatever the embedder or the insert thread still holds
        # stays intact while the next batch is built and embedded.
        texts, metadata = batch_texts, batch_metadata
        batch_texts, batch_metadata = [], []
        attempted += len(texts)

        embeddings, batch_embedding_seconds = await _embed_batch(embedder, repo_id, texts)
        embedding_seconds += batch_embedding_seconds
        await settle_insert()  # the previous batch's insert overlapped this embedding
        if embeddings is None:
            return
        pending_insert = asyncio.create_task(_insert_batch(collection, embedder, repo_id, texts, metadata, embeddings))
        if not is_local and settings.indexer_batch_delay_s > 0:
            await asyncio.sleep(settings.indexer_batch_delay_s)

    # 3. Process each file
    loop_started = time.perf_counter()
    try:
        for profile in file_profiles:
            p_dict = profile.model_dump() if hasattr(profile, "model_dump") else profile
            file_path = p_dict["path"]
            role = p_dict.get("role_label", "Unknown")
            if settings.index_exclude_tests and is_test_path(file_path):
                skipped_tests += 1
                continue

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

            chunks = await asyncio.to_thread(_chunks_for_provider, content, embedder)
            spans = _chunk_line_spans(content, chunks, file_path)

            # Consistent stable hash for file
            file_hash = hashlib.md5(file_path.encode()).hexdigest()[:10]
            # With exclusion off, label tests by path so chat's layer filter can still drop them.
            layer = "tests" if is_test_path(file_path) else _detect_layer(file_path)

            for i, (chunk, (start_line, end_line)) in enumerate(zip(chunks, spans, strict=True)):
                chunk_id = f"{repo_id[:20]}_{file_hash}_{i}"

                # Apply 65,000-byte cap on stored text for Zilliz VARCHAR(65535) limit (R4b)
                encoded = chunk.encode("utf-8")
                if len(encoded) > 65000:
                    chunk = encoded[:65000].decode("utf-8", "ignore")

                batch_texts.append(chunk)
                batch_metadata.append(
                    {
                        "id": chunk_id,
                        "repo_id": repo_id[:64],
                        "file_path": file_path[:512],
                        "role": role[:64],
                        "language": detect_language(file_path)[:64],
                        "layer": layer[:32],
                        "start_line": start_line,
                        "end_line": end_line,
                    }
                )

                if len(batch_texts) >= batch_size:
                    await dispatch()

        # Flush remaining, then wait for the last insert
        await dispatch()
        await settle_insert()
    except BaseException:
        # Cancelled (graceful shutdown) or crashed mid-run: don't leave the insert
        # task pending. Its worker thread can't be interrupted and may still finish
        # that one batch; the next index of this repo clears it.
        if pending_insert is not None:
            pending_insert.cancel()
            await asyncio.wait({pending_insert})
        raise
    index_seconds = time.perf_counter() - loop_started

    if skipped_tests:
        logger.info(f"Left {skipped_tests} test/fixture files out of the index for {repo_id} (INDEX_EXCLUDE_TESTS)")
    lost = attempted - inserted
    # The breakdown lands in the log even if recording index_status fails.
    # Inserts overlap embedding (T9), so the parts add up to more than the total.
    summary = (
        f"Finished indexing for {repo_id}: {inserted}/{attempted} chunks inserted in {index_seconds:.1f}s "
        f"(embedding {embedding_seconds:.1f}s, inserts {insert_seconds:.1f}s)"
    )
    if attempted == 0:
        logger.error(f"{summary} — no chunks were attempted; RAG will serve empty contexts for this repo")
    elif lost > 0:
        summary += f" ({lost} lost due to errors)"
        logger.warning(summary)
    else:
        logger.info(summary)

    return IndexOutcome(
        attempted=attempted,
        inserted=inserted,
        embedding_identity=embedding_identity,
        document_prefix=getattr(embedder, "document_prefix", ""),
        embedding_seconds=embedding_seconds,
        insert_seconds=insert_seconds,
        index_seconds=index_seconds,
        fallback_from=selection.fallback_from,
    )


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
