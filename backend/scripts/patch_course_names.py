#!/usr/bin/env python3
"""
Patch existing Pinecone vectors with course_name metadata.

Fetches all vectors, extracts the course title from chunk_index=0 content
for each document, then updates every chunk's metadata with course_name.
No re-embedding — metadata-only update via Pinecone upsert.

Usage:
    python scripts/patch_course_names.py
"""

import sys
import os
import asyncio
import logging

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import get_settings
from app.utils.course_utils import extract_course_title_from_content
from pinecone import Pinecone

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


async def patch_course_names():
    settings = get_settings()
    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(host=settings.pinecone_host)

    logger.info("Fetching all vector IDs from Pinecone...")

    # List all vector IDs via pagination
    # index.list() returns an iterator of string ID lists
    all_ids = []
    for id_batch in index.list(prefix=""):
        if isinstance(id_batch, list):
            all_ids.extend(id_batch)
        else:
            all_ids.append(id_batch)

    logger.info(f"Found {len(all_ids)} vectors")

    # Group IDs by document_id
    doc_chunks: dict = {}
    for vid in all_ids:
        parts = vid.rsplit("_", 1)
        doc_id = parts[0] if len(parts) == 2 and parts[1].isdigit() else vid
        doc_chunks.setdefault(doc_id, []).append(vid)

    logger.info(f"Found {len(doc_chunks)} documents")

    # Process in batches of 100 (Pinecone fetch limit)
    patched_docs = 0
    patched_vectors = 0
    skipped = 0

    doc_ids = list(doc_chunks.keys())
    for batch_start in range(0, len(doc_ids), 10):
        batch_doc_ids = doc_ids[batch_start:batch_start + 10]

        # Fetch the chunk_index=0 vector for each doc to get course title
        first_chunk_ids = [f"{doc_id}_0" for doc_id in batch_doc_ids]
        fetch_result = index.fetch(ids=first_chunk_ids)
        fetched = fetch_result.vectors if hasattr(fetch_result, "vectors") else {}

        for doc_id in batch_doc_ids:
            first_id = f"{doc_id}_0"
            vec = fetched.get(first_id)
            if not vec:
                skipped += 1
                continue

            metadata = vec.metadata or {}
            existing_course = metadata.get("course_name", "")
            first_content = metadata.get("content", "")
            filename = metadata.get("filename", "")

            # Extract course name from first chunk content (filename as fallback)
            course_name = extract_course_title_from_content([first_content], filename=filename) or ""

            # Skip only if already has a non-empty course_name
            if existing_course and existing_course == course_name:
                skipped += 1
                continue

            # Fetch all chunks for this document and re-upsert with course_name
            chunk_ids = doc_chunks[doc_id]
            all_chunk_ids_batched = [chunk_ids[i:i+100] for i in range(0, len(chunk_ids), 100)]

            for id_batch in all_chunk_ids_batched:
                fetch_chunks = index.fetch(ids=id_batch)
                chunks_fetched = fetch_chunks.vectors if hasattr(fetch_chunks, "vectors") else {}

                upsert_vectors = []
                for cid, cvec in chunks_fetched.items():
                    updated_metadata = dict(cvec.metadata or {})
                    updated_metadata["course_name"] = course_name
                    upsert_vectors.append({
                        "id": cid,
                        "values": cvec.values,
                        "metadata": updated_metadata,
                    })

                if upsert_vectors:
                    index.upsert(vectors=upsert_vectors)
                    patched_vectors += len(upsert_vectors)

            patched_docs += 1
            logger.info(f"[{patched_docs}] {filename} → '{course_name}' ({len(chunk_ids)} chunks)")

    logger.info(f"\nDone. Patched {patched_docs} documents ({patched_vectors} vectors). Skipped {skipped}.")


if __name__ == "__main__":
    asyncio.run(patch_course_names())
