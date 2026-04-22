import os
from dotenv import load_dotenv

load_dotenv()
import uuid
from typing import List, Dict, Any, Optional
from pymilvus import (
    connections,
    utility,
    FieldSchema,
    CollectionSchema,
    DataType,
    Collection,
)
from dotenv import load_dotenv
load_dotenv()

# Constants for schema
DIMENSION = 3072  # gemini-embedding-001 is 3072-dimensional
COLLECTION_NAME = "codekavi_chunks"

class ZillizClient:
    def __init__(self):
        self.uri = os.getenv("ZILLIZ_URI")
        self.token = os.getenv("ZILLIZ_API_KEY")
        self.collection = None
        
    def connect(self) -> bool:
        """Establishes connection to Zilliz Cloud."""
        if not self.uri or not self.token:
            return False
            
        try:
            connections.connect(
                alias="default",
                uri=self.uri,
                token=self.token
            )
            return True
        except Exception as e:
            print(f"Error connecting to Zilliz: {e}")
            return False

    def setup_collection(self) -> Collection:
        """Sets up the Milvus collection and returns it."""
        if not self.connect():
            raise ValueError("Could not connect to Zilliz. Check ZILLIZ_URI and ZILLIZ_API_KEY.")

        if utility.has_collection(COLLECTION_NAME):
            # If the collection exists but its dimension might be old (768), 
            # we should drop it and recreate it (only safe if we are fine with clearing all repos).
            # We'll rely on the existing collection if it works, or we can explicitly check schema here.
            # But normally we just return it:
            self.collection = Collection(COLLECTION_NAME)
            
            # Temporary fix: ensure it matches new dimensions.
            # Since indexer.py drops repo_id anyway, dropping the whole collection is safe in development
            # to prevent dimension mismatch errors.
            try:
                if self.collection.schema.fields[-1].params.get("dim") != DIMENSION:
                    utility.drop_collection(COLLECTION_NAME)
                    return self.setup_collection()
            except:
                pass
                
            return self.collection

        # Define schema
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=64, is_primary=True),
            FieldSchema(name="repo_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="file_path", dtype=DataType.VARCHAR, max_length=512),
            FieldSchema(name="role", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION)
        ]
        schema = CollectionSchema(fields=fields, description="Code chunks for RAG")
        
        self.collection = Collection(name=COLLECTION_NAME, schema=schema)
        
        # Create an index on the vector field for fast similarity search
        index_params = {
            "metric_type": "COSINE",
            "index_type": "AUTOINDEX",
            "params": {}
        }
        self.collection.create_index(field_name="vector", index_params=index_params)
        self.collection.load()
        return self.collection

    def clear_repo(self, repo_id: str):
        """Removes all chunks associated with a specific repo_id."""
        if not self.collection:
            self.setup_collection()
            
        try:
            self.collection.delete(f"repo_id == '{repo_id}'")
        except Exception as e:
            print(f"Error clearing repo {repo_id}: {e}")

    def search(self, query: str, repo_id: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Embeds the query using Gemini and searches Zilliz.
        Returns the top 'limit' matching code chunks.
        """
        if not self.collection:
            self.setup_collection()
            
        try:
            from google import genai
            api_key = os.environ.get("GEMINI_API_KEY")
            client = genai.Client(api_key=api_key)
            response = client.models.embed_content(
                model="gemini-embedding-001", 
                contents=[query]
            )
            query_vector = response.embeddings[0].values
            
            search_params = {
                "metric_type": "COSINE", 
                "params": {}
            }
            expr = f"repo_id == '{repo_id}'"
            
            self.collection.load()
            results = self.collection.search(
                data=[query_vector], 
                anns_field="vector", 
                param=search_params,
                limit=limit,
                expr=expr,
                output_fields=["file_path", "role", "text"]
            )
            
            formatted_results = []
            for hits in results:
                for hit in hits:
                    formatted_results.append({
                        "file_path": hit.entity.get("file_path"),
                        "role": hit.entity.get("role"),
                        "text": hit.entity.get("text"),
                        "score": hit.distance
                    })
            return formatted_results
            
        except Exception as e:
            print(f"Error searching Zilliz: {e}")
            return []

# Global instance for app to use
zilliz_client = ZillizClient()
