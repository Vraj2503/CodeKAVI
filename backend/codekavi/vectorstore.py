import logging
import re
import asyncio
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
            "provider",
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
            FieldSchema(name="provider", dtype=DataType.VARCHAR, max_length=32),
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

    async def search(
        self,
        query: str,
        repo_id: str,
        limit: int = 5,
        layer_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Embeds the query using both Gemini and Cloudflare, searches Zilliz for both,
        combines results, and returns the top 'limit' matching code chunks.
        """
        if not self.collection:
            self.collection = self.setup_collection()

        assert self.collection is not None
        
        # Import providers here to avoid circular imports
        from codekavi.embedding import CloudflareEmbedding
        
        cf_client = CloudflareEmbedding()
        
        # 1. Embed query with Cloudflare
        try:
            q_cf_texts = await cf_client.embed_texts([query])
        except Exception as e:
            logger.error(f"Error during query embedding: {e}")
            return []
            
        search_params = {"metric_type": "COSINE", "params": {}}
        repo_id = _validate_repo_id(repo_id)
        
        base_expr = f"repo_id == '{repo_id}'"
        if layer_filter == "exclude_frontend":
            base_expr += ' and layer not in ["frontend", "test"]'
            
        all_hits = []
        
        # Function to perform a search safely
        def do_search(vector, provider_name):
            expr = f"{base_expr} and provider == '{provider_name}'"
            try:
                self.collection.load()
                results = self.collection.search(
                    data=[vector],
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
                        "provider",
                    ],
                )
                return results
            except Exception as e:
                logger.warning(f"Search failed for {provider_name}: {e}")
                return []
                
        # 2. Search Cloudflare namespace
        if isinstance(q_cf_texts, list) and q_cf_texts:
            cf_results = await asyncio.to_thread(do_search, q_cf_texts[0], "cloudflare")
            for hits in cf_results:
                for hit in hits:
                    all_hits.append({
                        "file_path": hit.entity.get("file_path"),
                        "role": hit.entity.get("role"),
                        "language": hit.entity.get("language", ""),
                        "layer": hit.entity.get("layer", ""),
                        "start_line": hit.entity.get("start_line", 0),
                        "end_line": hit.entity.get("end_line", 0),
                        "text": hit.entity.get("text"),
                        "provider": hit.entity.get("provider"),
                        "score": hit.distance,
                    })
                    
        # 3. Combine and sort
        # Distance metric is COSINE in Milvus/Zilliz. 
        # Lower distance (closer to 0) means more similar.
        all_hits.sort(key=lambda x: x["score"])
        
        # 4. Deduplicate based on file_path + start_line + end_line 
        # (in case the same chunk was somehow indexed twice, though unlikely with our flag)
        seen = set()
        deduped = []
        for hit in all_hits:
            sig = f"{hit['file_path']}:{hit['start_line']}-{hit['end_line']}"
            if sig not in seen:
                seen.add(sig)
                deduped.append(hit)
                
        return deduped[:limit]


# Global instance for app to use
zilliz_client = ZillizClient()
