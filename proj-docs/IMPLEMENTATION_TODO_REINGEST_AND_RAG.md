# Implementation TODO: Pinecone Re-Ingest + RAG Chunk Retrieval Fix

## Overview

Four sequential workstreams:
1. **Manual pre-flight** — drop non-Columbia syllabi (you do this)
2. **Clean Pinecone re-ingest** — clear, re-ingest with `course_name` metadata, remove hotfix
3. **Second-pass full document fetch** — solve the chunk retrieval gap
4. **Post-ingest validation** — verify retrieval quality

Total dev effort: ~5–6 hours. Ingest execution time: ~1–2 hours depending on PDF count.

---

## Phase 0 — Manual Pre-Flight (You)
**Estimated time: 30–60 min**

- [ ] Open `/path/to/New_Syllabi/` folder
- [ ] Delete all non-Columbia syllabi (keep only Columbia Business School + SIPA/SEAS syllabi)
- [ ] Confirm final file count and naming convention before ingest
- [ ] Signal when done — Phase 1 starts after this

> **Why first:** Re-ingest is destructive (clears Pinecone). Do not proceed to Phase 1 until the folder is clean.

---

## Phase 1 — Pinecone Clear + Re-Ingest
**Estimated dev time: 1 hour | Execution time: 1–2 hours**

### 1.1 Verify `course_name` tagging is wired end-to-end

- [ ] Confirm `document_service.py` calls `extract_course_title_from_content()` and stores `course_name` in Pinecone metadata at ingest time
- [ ] Confirm `document_registry.json` is cleared/reset so it doesn't block re-ingest deduplication
  - Either delete `document_registry.json` before ingest, or run with `--force`
  - **Recommended:** clear the registry to avoid stale entries

### 1.2 Clear Pinecone

```bash
cd backend
python scripts/clear_pinecone.py
```

- [ ] Confirm output: `✓ Verified: Index is now empty`
- [ ] Wait ~30s for Pinecone deletion to propagate before ingesting

### 1.3 Re-ingest all Columbia syllabi

```bash
python scripts/bulk_ingest.py /path/to/New_Syllabi 3
```

- [ ] Monitor for errors — note any files that fail to ingest
- [ ] Confirm final vector count in Pinecone matches expected chunk total
- [ ] Spot-check: query for a known course title and confirm `course_name` appears in metadata

### 1.4 Remove the filename-deduplication hotfix

**File:** `backend/app/api/routes/chat.py` — lines ~654–668

The `seen_filenames` block was a hotfix for duplicate vectors created by `--force` re-ingestion. After a clean ingest it is no longer needed.

- [ ] Delete the `seen_filenames` deduplication block:

```python
# DELETE THIS ENTIRE BLOCK:
seen_filenames: dict = {}
for doc_id, group in list(doc_groups.items()):
    fname = group["filename"]
    if fname not in seen_filenames:
        seen_filenames[fname] = doc_id
    else:
        existing_id = seen_filenames[fname]
        if group["best_score"] > doc_groups[existing_id]["best_score"]:
            del doc_groups[existing_id]
            seen_filenames[fname] = doc_id
        else:
            del doc_groups[doc_id]
```

- [ ] Test that source citations no longer show duplicates for the same filename

> **Note:** If in future someone re-ingests with `--force` by mistake, duplicates will reappear. Consider replacing the deleted block with a single-line assert/log warning instead of silent dedup logic.

---

## Phase 2 — Second-Pass Full Document Fetch (RAG Chunk Retrieval Fix)
**Estimated dev time: 3–4 hours**

### Problem
Only chunks that individually score above the similarity threshold are included in context. A syllabus with 9 chunks where only chunk `_0` scores above threshold means 8 chunks (schedule, readings, assignments) are invisible to the model.

### Solution
Once a document clears the relevance bar (any chunk scores above threshold), fetch **all** chunks for that document from Pinecone and merge them into context.

---

### 2.1 Add `fetch_all_chunks_for_document()` to PineconeService

**File:** `backend/app/services/pinecone_service.py`

Add a new method after `query_vectors`:

```python
async def fetch_all_chunks_for_document(
    self,
    document_id: str,
    max_chunks: int = 150
) -> List[Dict[str, Any]]:
    """Fetch all chunks belonging to a document via metadata filter.

    Uses a zero-vector query with a document_id filter — Pinecone requires
    a vector even for filter-only queries. Results are returned sorted by
    chunk_index (ascending) to preserve document narrative order.

    Args:
        document_id: The document_id to filter on
        max_chunks: Safety cap (documents rarely exceed ~100 chunks)

    Returns:
        List of chunk dicts with id, score, metadata
    """
    index = self._get_index()
    dummy_vector = [0.0] * 1536

    results = await asyncio.to_thread(
        index.query,
        vector=dummy_vector,
        top_k=max_chunks,
        filter={"document_id": {"$eq": document_id}},
        include_metadata=True
    )

    chunks = [
        {
            "id": match.id,
            "score": match.score,
            "metadata": match.metadata or {}
        }
        for match in results.matches
    ]

    # Sort by chunk_index to preserve document reading order
    chunks.sort(key=lambda c: c["metadata"].get("chunk_index", 0))
    return chunks
```

- [ ] Write the method
- [ ] Manual test: call it with a known `document_id` and confirm all chunks return in order

---

### 2.2 Wire second-pass fetch into `stream_chat`

**File:** `backend/app/api/routes/chat.py`

After the initial `doc_groups` construction and scoring (after the `seen_filenames` block is removed), add a parallel second-pass fetch for all documents that cleared the relevance bar:

```python
# Second pass: fetch ALL chunks for every document that cleared the bar.
# Initial Pinecone search only returns the highest-scoring chunks;
# lower-scoring chunks (schedule, readings, policies) are invisible
# without this step.
if doc_groups:
    per_doc_cap = 20  # max additional chunks per doc to avoid context explosion

    async def _fetch_supplementary_chunks(doc_id: str, group: dict):
        try:
            all_chunks = await doc_service.pinecone.fetch_all_chunks_for_document(doc_id)
            existing_ids = {c["id"] for c in group.get("chunk_data", [])}
            added = 0
            for chunk in all_chunks:
                if chunk["id"] not in existing_ids and added < per_doc_cap:
                    content = chunk["metadata"].get("content", "")
                    if content:
                        group["chunks"].append(content)
                        group["chunk_data"].append({
                            "id": chunk["id"],
                            "score": 0.0  # supplementary — doesn't affect doc ranking
                        })
                        added += 1
        except Exception as e:
            logger.warning(f"Second-pass fetch failed for {doc_id}: {e}")

    await asyncio.gather(*[
        _fetch_supplementary_chunks(doc_id, group)
        for doc_id, group in doc_groups.items()
    ])
```

- [ ] Add the second-pass block
- [ ] Confirm `doc_service.pinecone` is the accessible path to `PineconeService` (check how `doc_service` exposes it)
- [ ] Adjust `per_doc_cap` based on testing — start at 20, tune up/down based on response quality vs. latency

---

### 2.3 Tune per-doc cap and test

- [ ] Query "what are Bruce Usher's readings for Business & Climate Change" — confirm readings from multiple chunks appear
- [ ] Query something that retrieves 4–5 documents — confirm latency stays acceptable (<3s added)
- [ ] Check context size doesn't exceed provider token limits for Quick mode (est. ~7 docs × 20 extra chunks × ~200 tokens = ~28k tokens added — may need to lower cap for Quick mode)
- [ ] Consider a per-research-mode cap: Quick=10, Enhanced=20, Deep=30

---

## Phase 3 — Post-Ingest Validation
**Estimated time: 30 min**

- [ ] Run "find bruce ushers readings" — confirm readings across all his courses appear, no "(No readings listed)" gaps
- [ ] Run "what are the readings for Business & Climate Change" — confirm syllabus content includes the actual reading list
- [ ] Run a cross-instructor query — confirm entity filtering still works correctly after re-ingest
- [ ] Run a course-not-found query — confirm the "course not in dataset" fallback still works
- [ ] Confirm source citation numbers are unique (no [1][1] duplicates from same filename)

---

## File Change Summary

| File | Change | Phase |
|------|--------|-------|
| `New_Syllabi/` folder | Drop non-Columbia files | 0 (manual) |
| `backend/data/document_registry.json` | Clear/delete before re-ingest | 1 |
| `backend/scripts/clear_pinecone.py` | Run (no code change needed) | 1 |
| `backend/scripts/bulk_ingest.py` | Run (no code change needed) | 1 |
| `backend/app/api/routes/chat.py` | Remove `seen_filenames` hotfix block | 1 |
| `backend/app/services/pinecone_service.py` | Add `fetch_all_chunks_for_document()` | 2 |
| `backend/app/api/routes/chat.py` | Add second-pass fetch block | 2 |

---

## Risk Notes

- **Ingest time:** ~265 documents at 3 concurrent = ~45–90 min. Don't interrupt mid-run.
- **Context explosion:** Second-pass adds significant tokens. Cap aggressively for Quick mode.
- **document_registry.json:** If not cleared before ingest, dedup check will skip files already in the registry even though Pinecone is empty. Clear it.
- **Hotfix removal timing:** Only remove `seen_filenames` block AFTER clean ingest confirms no duplicate vectors.
