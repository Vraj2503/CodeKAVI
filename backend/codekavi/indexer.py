import os
from dotenv import load_dotenv

load_dotenv()
import hashlib
from typing import List, Dict, Any
from google import genai
from langchain_text_splitters import RecursiveCharacterTextSplitter

from codekavi.vectorstore import zilliz_client
from dotenv import load_dotenv
load_dotenv()

def get_genai_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:
        print(f"Error initializing GenAI client: {e}")
        return None

def index_repository(repo_id: str, file_profiles: List[Dict[str, Any]], clone_path: str) -> bool:
    """
    Chunks source code files and embeds them using Gemini, 
    then inserts into Zilliz database.
    """
    print(f"Starting vector indexing for repo {repo_id}...")
    
    # 1. Setup Collection & Client
    try:
        collection = zilliz_client.setup_collection()
    except Exception as e:
        print(f"Failed to setup Zilliz collection: {e}")
        return False
        
    client = get_genai_client()
    if not client:
        print("GenAI client not available. Skipping indexing.")
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
    
    # Process in batches 
    BATCH_SIZE = 50
    current_batch_texts = []
    current_batch_metadata = []
    total_chunks_inserted = 0

    def flush_batch():
        nonlocal current_batch_texts, current_batch_metadata, total_chunks_inserted
        if not current_batch_texts:
            return
            
        try:
            # Generate embeddings via Gemini
            response = client.models.embed_content(
                model="gemini-embedding-001", 
                contents=current_batch_texts
            )
            embeddings = [emb.values for emb in response.embeddings]
            
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
                embeddings
            ]
            
            collection.insert(insert_data)
            total_chunks_inserted += len(ids)
            print(f"Inserted {len(ids)} chunks (Total: {total_chunks_inserted})")
            
        except Exception as e:
            print(f"Error flushing batch: {e}")
            
        # Reset batch
        current_batch_texts.clear()
        current_batch_metadata.clear()

    # 3. Process each file
    for profile in file_profiles:
        file_path = profile['path']
        role = profile.get('role_label', 'Unknown')
        
        abs_path = os.path.join(clone_path, file_path)
        if not os.path.exists(abs_path):
            continue
            
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
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
            current_batch_metadata.append({
                "id": chunk_id,
                "repo_id": repo_id[:64],
                "file_path": file_path[:512],
                "role": role[:64]
            })
            
            if len(current_batch_texts) >= BATCH_SIZE:
                flush_batch()
                
    flush_batch()
    print(f"Finished indexing {total_chunks_inserted} chunks for {repo_id}")
    return True
