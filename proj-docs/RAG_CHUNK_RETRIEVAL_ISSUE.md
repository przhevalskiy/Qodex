# RAG Retrieval Gap: Chunk-Level Scoring Excludes Document Substance

## Problem

When a document is retrieved as relevant, only the chunks that **individually** score above the similarity threshold are included in the AI's context. Chunks from the same document that score below the threshold are silently excluded — even when they contain core content (grading rubrics, schedules, case requirements) that directly answers the user's query.

### Example

A query like *"What does a typical MBA operations management syllabus cover?"* retrieves the MIT 15.769 syllabus. That document has 9 chunks:

| Chunk | Content | Score (approx) | Included? |
|-------|---------|----------------|-----------|
| `_0` | Course title, description, objectives | 0.72 | ✅ |
| `_1` | Course themes, intended audience, materials | 0.38 | ❌ |
| `_2` | Grading breakdown, class participation | 0.35 | ❌ |
| `_3` | Case write-up format and requirements | 0.31 | ❌ |
| `_4` | Attendance, Zoom etiquette, workload | 0.29 | ❌ |
| `_5` | Honor code, negotiation exercise, final project | 0.28 | ❌ |
| `_6` | Final project guidelines | 0.27 | ❌ |
| `_7` | Academic accommodations | 0.24 | ❌ |
| `_8` | Session schedule table | 0.26 | ❌ |

The AI answers the question having seen only chunk `_0`. It never sees the grading breakdown, session schedule, or project requirements — the actual substance of the syllabus.

## Root Cause

Pinecone scores individual chunk embeddings against the query embedding using cosine similarity. Chunk `_0` embeds close to "operations management syllabus" because it contains those exact terms in dense topical language. Chunks `_1–_8` use course-specific vocabulary ("case write-up", "negotiation exercise", "interim progress update") that doesn't embed near the query vector, even though they're equally valid parts of the syllabus.

### Current Thresholds

| Research Mode | `top_k` (docs) | Pinecone fetch | `min_score` |
|---------------|----------------|----------------|-------------|
| Quick         | 7              | 21 chunks      | 0.40        |
| Enhanced      | 12             | 36 chunks      | 0.30        |
| Deep          | 16             | 48 chunks      | 0.25        |

There is no mechanism to pull in sibling chunks from a document once that document has been established as relevant.

## Impact

1. **Answer quality** — The model answers syllabus questions with only the intro chunk. Grading, schedule, requirements, and policies are invisible to it.
2. **Highlighting** — The document preview pane can only highlight chunks that were retrieved. Since only chunk `_0` was retrieved, only chunk `_0` is highlighted — making the "relevance-graded highlighting" feature meaningless for most queries.
3. **Citation accuracy** — Facts that appear in unchosen chunks cannot be cited, even though the document was retrieved as relevant.

## Proposed Fix: Second-Pass Full Document Fetch

Once a document clears the relevance bar (any chunk scores above threshold), issue a second Pinecone query filtered by `document_id = X` to retrieve **all** chunks belonging to that document. Include all of them in context.

### Implementation Steps

#### Backend — `backend/app/services/pinecone_service.py`

Add a method `fetch_all_chunks_for_document(document_id: str) -> List[Dict]` that queries Pinecone with a metadata filter:

```python
filter_dict = {"document_id": {"$eq": document_id}}
results = index.query(
    vector=[0.0] * 1536,       # dummy vector — we only care about the filter
    top_k=200,                 # documents rarely exceed ~100 chunks
    filter=filter_dict,
    include_metadata=True
)
```

> **Note:** Pinecone requires a vector even for filter-only queries. A zero vector or the original query vector can be used; the results are sorted by score but we want all of them so the dummy vector is fine. Alternatively use `fetch()` by IDs if chunk IDs follow a predictable pattern.

#### Backend — `backend/app/api/routes/chat.py`

After the initial Pinecone search and `doc_groups` construction, for each document that has at least one chunk above threshold, call `fetch_all_chunks_for_document()` and merge the additional chunks into `group["chunks"]`. Assign them a nominal score of 0 (or their actual returned score) so they don't affect the document's ranking but do appear in context.

```python
# Second pass: fetch all chunks for every document that cleared the bar
for doc_id, group in doc_groups.items():
    all_chunks = await doc_service.pinecone.fetch_all_chunks_for_document(doc_id)
    existing_chunk_ids = {c["id"] for c in group["chunk_data"]}
    for chunk in sorted(all_chunks, key=lambda c: c.get("metadata", {}).get("chunk_index", 0)):
        if chunk["id"] not in existing_chunk_ids:
            content = chunk.get("metadata", {}).get("content", "")
            group["chunks"].append(content)
            group["chunk_data"].append({"id": chunk["id"], "score": chunk.get("score", 0.0)})
```

#### Frontend — Multi-chunk highlighting (deferred)

Once the backend returns all chunk IDs and scores via `chunk_ids` / `chunk_scores` on `DocumentSource`, the preview pane can highlight all retrieved chunks with relevance-graded intensity (primary = brightest, supplementary = dimmer). This work was drafted and reverted pending this fix — re-implement after the second-pass fetch is in place.

## Considerations

- **Latency**: The second-pass fetch is one additional Pinecone query per relevant document, run in parallel (`asyncio.gather`). For typical queries returning 3–5 documents, this adds one parallel round-trip (~50–100ms) on top of the existing search.
- **Context size**: Including all chunks of every relevant document significantly increases the context window. For QUICK mode this might grow from ~7 chunks to potentially 50+. A per-document chunk cap (e.g. max 15 chunks per doc) may be needed.
- **Chunk ordering**: The second-pass results should be sorted by `chunk_index` to preserve document narrative flow in the context.
- **Cost**: More tokens in context = higher API cost per query. Worth measuring against quality improvement.

## Files to Change

| File | Change |
|------|--------|
| `backend/app/services/pinecone_service.py` | Add `fetch_all_chunks_for_document()` |
| `backend/app/api/routes/chat.py` | Second-pass fetch after initial doc_groups construction |
| `frontend/src/features/documents/previewStore.ts` | Re-enable `highlightedChunks` array (was reverted) |
| `frontend/src/features/documents/index.ts` | Re-export `HighlightedChunkEntry` (was reverted) |
| `frontend/src/features/chat/components/input/InlineCitation.tsx` | Pass `chunk_ids`/`chunk_scores` (was reverted) |
| `frontend/src/features/chat/components/sources/SourcesDisplay.tsx` | Pass `chunk_ids`/`chunk_scores` (was reverted) |
| `frontend/src/features/chat/components/modals/DocumentPreviewModal.tsx` | Use `highlightedChunks` (was reverted) |
| `frontend/src/features/chat/components/sources/DocumentPreviewPane.tsx` | Accept `highlightedChunks` prop (was reverted) |
| `frontend/src/features/chat/components/sources/FormattedContent.tsx` | Graded highlight map (was reverted) |
| `frontend/src/features/chat/components/sources/FormattedContent.css` | CSS custom property highlight (was reverted) |
| `backend/app/models/message.py` | Re-add `chunk_ids` / `chunk_scores` to `DocumentSource` (was reverted) |
| `frontend/src/shared/types/index.ts` | Re-add `chunk_ids?` / `chunk_scores?` to `DocumentSource` (was reverted) |
