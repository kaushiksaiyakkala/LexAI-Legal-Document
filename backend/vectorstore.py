"""
ChromaDB vector store — document ingestion and semantic retrieval.
Uses all-MiniLM-L6-v2 for local embeddings (no API key needed).
"""

import os
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

_ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMA_PATH = os.path.join(_ROOT, "chroma_db")
EMBED_MODEL = "all-MiniLM-L6-v2"

_client   = None
_embed_fn = None


def _get_client():
    global _client, _embed_fn
    if _client is None:
        print(f"Initialising ChromaDB at {CHROMA_PATH}...")
        _embed_fn = SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)
        _client   = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client, _embed_fn


def ingest_document(doc_id: str, chunks: list) -> int:
    """Embed and persist document chunks. Returns number of chunks stored."""
    texts = [
        (c.get("text", c) if isinstance(c, dict) else str(c)).strip()
        for c in chunks
    ]
    texts = [t for t in texts if len(t.split()) > 10]
    if not texts:
        return 0

    client, ef = _get_client()

    # Drop old collection for this doc if re-uploading
    try:
        client.delete_collection(f"doc_{doc_id}")
    except Exception:
        pass

    col = client.create_collection(f"doc_{doc_id}", embedding_function=ef)
    col.upsert(
        documents=texts,
        ids=[f"{doc_id}_{i}" for i in range(len(texts))],
    )
    return len(texts)


def search(doc_id: str, query: str, n: int = 5) -> list:
    """Return up to n semantically similar chunks for the query."""
    client, ef = _get_client()
    try:
        col   = client.get_collection(f"doc_{doc_id}", embedding_function=ef)
        count = col.count()
        if count == 0:
            return []
        results = col.query(query_texts=[query], n_results=min(n, count))
        return results["documents"][0]
    except Exception:
        return []


def delete_document(doc_id: str):
    client, _ = _get_client()
    try:
        client.delete_collection(f"doc_{doc_id}")
    except Exception:
        pass
