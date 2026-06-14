import logging
import re
import time
from typing import Any, ClassVar

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

from codekavi.config import EMBEDDING_DIMENSION
from codekavi.settings import settings

logger = logging.getLogger(__name__)

# Constants for schema
DIMENSION = EMBEDDING_DIMENSION
COLLECTION_NAME = "codekavi_chunks"

# Retry settings for transient errors
MAX_RETRIES = 3
INITIAL_BACKOFF_S = 2

# Repo ID validation — must be a safe alphanumeric hex string
_REPO_ID_PATTERN = re.compile(r"^[a-f0-9]{12}$")


def _validate_repo_id(repo_id: str) -> str:
    """Validate repo_id is a safe hex string to prevent expression injection."""
    if not _REPO_ID_PATTERN.match(repo_id):
        raise ValueError(f"Invalid repo_id format: {repo_id!r}")
    return repo_id


class ZillizClient:
    def __init__(self):
        self.uri = settings.zilliz_uri
        self.token = settings.zilliz_api_key
        self.collection = None

    def connect(self) -> bool:
        """Establishes connection to Zilliz Cloud."""
        if not self.uri or not self.token:
            return False

        try:
            connections.connect(
                alias="default",
                uri=self.uri,
                token=self.token,
            )
            return True
        except Exception as e:
            logger.error(f"Error connecting to Zilliz: {e}")
            return False

    # Fields that MUST exist in the schema (added for metadata filtering)
    _REQUIRED_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {
            "id",
            "repo_id",
            "file_path",
            "role",
            "language",
            "layer",
            "start_line",
            "end_line",
            "text",
            "vector",
        }
    )

    def setup_collection(self) -> Collection:
        """Sets up the Milvus collection and returns it."""
        if not self.connect():
            from codekavi.exceptions import VectorStoreError

            raise VectorStoreError("Could not connect to Zilliz. Check ZILLIZ_URI and ZILLIZ_API_KEY.")

        if utility.has_collection(COLLECTION_NAME):
            self.collection = Collection(COLLECTION_NAME)

            # Safety check: if the existing collection has wrong dimensions,
            # drop and recreate it (safe in dev — indexer clears per-repo anyway).
            try:
                existing_dim = self.collection.schema.fields[-1].params.get("dim")
                if existing_dim != DIMENSION:
                    logger.warning(
                        f"Dimension mismatch ({existing_dim} vs {DIMENSION}). Dropping and recreating collection."
                    )
                    utility.drop_collection(COLLECTION_NAME)
                    return self.setup_collection()
            except Exception:
                pass

            # Safety check: if the existing collection is missing new metadata
            # fields (language, layer), drop and recreate so indexer can store them.
            try:
                existing_field_names = {f.name for f in self.collection.schema.fields}
                if not self._REQUIRED_FIELDS.issubset(existing_field_names):
                    missing = self._REQUIRED_FIELDS - existing_field_names
                    logger.warning(f"Collection missing fields {missing}. Dropping and recreating collection.")
                    utility.drop_collection(COLLECTION_NAME)
                    return self.setup_collection()
            except Exception:
                pass

            return self.collection

        # Define schema — includes language and layer for metadata filtering
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=64, is_primary=True),
            FieldSchema(name="repo_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="file_path", dtype=DataType.VARCHAR, max_length=512),
            FieldSchema(name="role", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="language", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="layer", dtype=DataType.VARCHAR, max_length=32),
            FieldSchema(name="start_line", dtype=DataType.INT64),
            FieldSchema(name="end_line", dtype=DataType.INT64),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION),
        ]
        schema = CollectionSchema(fields=fields, description="Code chunks for RAG")

        self.collection = Collection(name=COLLECTION_NAME, schema=schema)

        # Create an index on the vector field for fast similarity search
        index_params = {
            "metric_type": "COSINE",
            "index_type": "AUTOINDEX",
            "params": {},
        }
        self.collection.create_index(field_name="vector", index_params=index_params)
        self.collection.load()
        return self.collection

    def collection_exists(self) -> bool:
        """Quick health-check: can we reach Zilliz and does the collection exist?"""
        try:
            if not self.connect():
                return False
            return utility.has_collection(COLLECTION_NAME)
        except Exception:
            return False

    def clear_repo(self, repo_id: str) -> None:
        """Removes all chunks associated with a specific repo_id."""
        repo_id = _validate_repo_id(repo_id)
        if not self.collection:
            self.setup_collection()
        assert self.collection is not None
        try:
            self.collection.delete(f"repo_id == '{repo_id}'")
        except Exception as e:
            logger.error(f"Error clearing repo {repo_id}: {e}")

    def search(
        self,
        query: str,
        repo_id: str,
        limit: int = 5,
        layer_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Embeds the query using Gemini and searches Zilliz.
        Returns the top 'limit' matching code chunks.
        Retries on transient errors with exponential backoff.

        ⚠ Requires re-indexing if EMBEDDING_MODEL changes — old vectors
        live in a different embedding space and will return poor results.

        Args:
            query: The user's question.
            repo_id: Repository identifier.
            limit: Maximum results to return.
            layer_filter: If "exclude_frontend", excludes frontend and test chunks.
        """
        if not self.collection:
            self.collection = self.setup_collection()

        assert self.collection is not None
        backoff = INITIAL_BACKOFF_S

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                from google import genai

                api_key = settings.gemini_api_key
                client = genai.Client(api_key=api_key)
                response = client.models.embed_content(
                    model=settings.embedding_model,
                    contents=[query],  # type: ignore[arg-type]
                )
                if not response.embeddings or len(response.embeddings) == 0:
                    raise ValueError("No embeddings returned from Gemini")
                query_vector = response.embeddings[0].values

                search_params = {"metric_type": "COSINE", "params": {}}

                # Build filter expression
                repo_id = _validate_repo_id(repo_id)
                expr = f"repo_id == '{repo_id}'"
                if layer_filter == "exclude_frontend":
                    expr += ' and layer not in ["frontend", "test"]'

                self.collection.load()
                results = self.collection.search(
                    data=[query_vector],
                    anns_field="vector",
                    param=search_params,
                    limit=limit,
                    expr=expr,
                    output_fields=[
                        "file_path",
                        "role",
                        "language",
                        "layer",
                        "start_line",
                        "end_line",
                        "text",
                    ],
                )

                formatted_results = []
                for hits in results:
                    for hit in hits:
                        formatted_results.append(
                            {
                                "file_path": hit.entity.get("file_path"),
                                "role": hit.entity.get("role"),
                                "language": hit.entity.get("language", ""),
                                "layer": hit.entity.get("layer", ""),
                                "start_line": hit.entity.get("start_line", 0),
                                "end_line": hit.entity.get("end_line", 0),
                                "text": hit.entity.get("text"),
                                "score": hit.distance,
                            }
                        )
                return formatted_results

            except Exception as e:
                err_str = str(e)
                is_transient = any(
                    keyword in err_str for keyword in ["429", "RESOURCE_EXHAUSTED", "timeout", "Unavailable"]
                )

                if is_transient and attempt < MAX_RETRIES:
                    logger.warning(
                        f"Search transient error (attempt {attempt}/{MAX_RETRIES}): {e}. Retrying in {backoff}s…"
                    )
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                else:
                    logger.error(f"Search failed: {e}")
                    return []
        return []


# Global instance for app to use
zilliz_client = ZillizClient()
