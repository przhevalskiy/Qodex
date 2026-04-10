"""
Pre-warm the document_formatted_chunks Supabase cache for all documents.

Run once from the backend/ directory:
    python scripts/prewarm_format_cache.py

What it does:
  1. Lists all vector IDs from Pinecone and groups them by document_id
  2. Fetches each document's vectors directly (no embedding query needed)
  3. Skips documents already cached in Supabase
  4. Formats uncached documents via GPT-4o-mini and persists to Supabase

After this runs, every document preview will open instantly.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.pinecone_service import get_pinecone_service
from app.api.routes.documents import (
    FormatChunk,
    _get_formatted_from_db,
    _run_format_and_persist,
)


async def fetch_chunks_for_document(
    pinecone, document_id: str, vector_ids: list
) -> list:
    """Fetch vectors by ID in batches of 100 (Pinecone limit)."""
    chunks = []
    for i in range(0, len(vector_ids), 100):
        batch = vector_ids[i : i + 100]
        fetched = await pinecone.fetch_vectors(batch)
        for vid, vec in fetched.items():
            metadata = vec.get("metadata", {})
            content = metadata.get("content", "")
            if content:
                chunks.append(
                    {
                        "id": vid,
                        "content": content,
                        "chunk_index": metadata.get("chunk_index", 0),
                    }
                )
    # Sort by chunk_index for consistent ordering
    chunks.sort(key=lambda c: c["chunk_index"])
    return chunks


_DOC_CONCURRENCY = 10  # documents processed in parallel


async def process_one(pinecone, doc_id: str, vector_ids: list, index: int, total: int, counters: dict) -> None:
    prefix = f"[{index}/{total}] {doc_id[:8]}... ({len(vector_ids)} chunks)"

    existing = await _get_formatted_from_db(doc_id)
    if existing and len(existing) == len(vector_ids):
        print(f"{prefix} — already cached, skipping", flush=True)
        counters["skipped"] += 1
        return

    try:
        raw_chunks = await fetch_chunks_for_document(pinecone, doc_id, vector_ids)
    except Exception as e:
        print(f"{prefix} — FAILED to fetch: {e}", flush=True)
        counters["failed"] += 1
        return

    if not raw_chunks:
        print(f"{prefix} — no content found, skipping", flush=True)
        counters["skipped"] += 1
        return

    try:
        chunks = [FormatChunk(id=c["id"], content=c["content"]) for c in raw_chunks]
        await _run_format_and_persist(doc_id, chunks)
        print(f"{prefix} — done", flush=True)
        counters["formatted"] += 1
    except Exception as e:
        print(f"{prefix} — FAILED to format: {e}", flush=True)
        counters["failed"] += 1


async def main() -> None:
    pinecone = get_pinecone_service()

    print("Listing all vectors from Pinecone...")
    all_ids = await pinecone.list_all_vector_ids()
    print(f"Found {len(all_ids)} vectors total\n")

    if not all_ids:
        print("Nothing to do — no vectors in Pinecone.")
        return

    doc_vectors: dict[str, list[str]] = {}
    for vid in all_ids:
        parts = vid.rsplit("_", 1)
        doc_id = parts[0] if len(parts) == 2 and parts[1].isdigit() else vid
        doc_vectors.setdefault(doc_id, []).append(vid)

    documents = list(doc_vectors.items())
    print(f"Found {len(documents)} document(s) — processing {_DOC_CONCURRENCY} at a time\n")

    counters = {"skipped": 0, "formatted": 0, "failed": 0}
    sem = asyncio.Semaphore(_DOC_CONCURRENCY)

    async def bounded(index, doc_id, vector_ids):
        async with sem:
            await process_one(pinecone, doc_id, vector_ids, index, len(documents), counters)

    await asyncio.gather(*[
        bounded(i, doc_id, vector_ids)
        for i, (doc_id, vector_ids) in enumerate(documents, start=1)
    ])

    print(f"\nSummary: {counters['formatted']} formatted, {counters['skipped']} skipped, {counters['failed']} failed")


if __name__ == "__main__":
    asyncio.run(main())
