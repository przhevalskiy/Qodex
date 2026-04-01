# Course Name Query Filtering — Implementation Plan

## Context

Faculty name filtering already exists end-to-end:
> detect name in query → validate against `instructor_index` → restrict Pinecone search to matching doc IDs → search only those docs

Course name filtering is **partially built but not wired**:
- `_extract_course_name()` exists but only fires on 2 rigid phrasings — most natural queries miss it entirely
- It is used only as a **post-search guard** (did retrieved chunks contain this course?) not a **pre-search filter** (restrict Pinecone to this course's docs)
- `course_name` is stored in Pinecone metadata on every chunk (we just populated 174/202 docs)
- No `course_index` exists — no way to map a detected course title → document IDs at query time

This plan brings course filtering to full parity with instructor filtering.

---

## What Changes and Why

| Component | Current State | Target State |
|---|---|---|
| `Document` model | No `course_name` field | Add `course_name: str = ""` field |
| `document_registry.json` | No course_name persisted | Persisted alongside filename, instructor |
| `_build_course_index()` | Does not exist | Mirror of `_build_instructor_index()` |
| `get_documents_by_course()` | Does not exist | Mirror of `get_documents_by_instructor()` |
| `bootstrap_registry()` | Does not rebuild indexes after bootstrap | Rebuild both indexes after bootstrap |
| `process_document()` | Does not rebuild indexes after upload | Rebuild both indexes after upload |
| `_extract_course_name()` | 2 rigid regex patterns | N-gram sliding window against `course_index`, same strategy as instructor names |
| Query-time routing in `stream_chat` | No course pre-filter | Detect course → look up doc IDs → pass to Pinecone |
| `_course_found_in_chunks()` | Post-search hallucination guard | Kept — complementary role, not replaced |

---

## Phase 1 — Persist `course_name` on the `Document` Model

**File:** `backend/app/services/document_service.py`

### Task 1.1 — Add `course_name` to the `Document` dataclass / model

Find where the `Document` model is defined (the object stored in `self._documents`). Add:

```python
course_name: str = ""
```

This field must survive JSON serialisation to `document_registry.json` and deserialisation on next startup.

### Task 1.2 — Write `course_name` when a document is processed

In `process_document()`, after `course_name` is computed (currently lines 617–620), also set it on the `Document` object before saving the registry:

```python
document.course_name = course_name
self._save_registry()
```

### Task 1.3 — Populate `course_name` from Pinecone during `bootstrap_registry()`

`bootstrap_registry()` fetches one representative vector per document from Pinecone and reads metadata. Add `course_name` to what it extracts from metadata and stores on the `Document` object:

```python
document.course_name = metadata.get("course_name", "")
```

This ensures that existing documents (already in Pinecone) get `course_name` populated on the in-memory `Document` object at startup, without re-ingesting anything.

**Verification:** After startup, `doc_service._documents[some_id].course_name` should return the course title, not `""`.

---

## Phase 2 — Build the Course Index

**File:** `backend/app/services/document_service.py`

### Task 2.1 — Add `course_index` attribute to `DocumentService.__init__()`

Alongside `self.instructor_index: Dict[str, List[str]] = {}` (line ~35), add:

```python
self.course_index: Dict[str, List[str]] = {}
```

### Task 2.2 — Write `_build_course_index()`

Mirror `_build_instructor_index()` exactly. Key differences:
- Source field: `doc.course_name` instead of `doc.filename`
- Normalisation: lowercase + strip only — **do not** split on CamelCase (course names are already spaced)
- Normalise `&` → `and` consistently (e.g., `"Business & Climate Change"` → `"business and climate change"`)
- Skip documents where `doc.course_name` is empty

```python
def _build_course_index(self) -> None:
    self.course_index = {}
    for doc in self._documents.values():
        name = doc.course_name.strip()
        if not name:
            continue
        key = name.lower().replace("&", "and")
        key = re.sub(r"\s+", " ", key).strip()
        self.course_index.setdefault(key, []).append(doc.id)
```

### Task 2.3 — Write `get_documents_by_course()`

Mirror `get_documents_by_instructor()`. Normalise the query the same way as the index key:

```python
def get_documents_by_course(self, course_name: str) -> Optional[List[str]]:
    key = course_name.lower().replace("&", "and")
    key = re.sub(r"\s+", " ", key).strip()
    return self.course_index.get(key)
```

### Task 2.4 — Call `_build_course_index()` in `__init__()`

Immediately after `self._build_instructor_index()` (line ~37):

```python
self._build_course_index()
```

### Task 2.5 — Rebuild both indexes after `bootstrap_registry()` completes

`bootstrap_registry()` populates `self._documents` from Pinecone. After `self._save_registry()` at the end of that method, add:

```python
self._build_instructor_index()
self._build_course_index()
```

This fixes the latent bug where both indexes are empty if no registry JSON existed at startup.

### Task 2.6 — Rebuild both indexes after `process_document()` adds a new document

After `self._documents[doc_id] = document` and `self._save_registry()` in `process_document()`, add:

```python
self._build_instructor_index()
self._build_course_index()
```

**Verification:** After startup, `doc_service.course_index` should contain entries like `{"climate finance": ["uuid-1"], "sustainability metrics": ["uuid-2"]}`.

---

## Phase 3 — Course Name Detection at Query Time

**File:** `backend/app/api/routes/chat.py`

### Task 3.1 — Replace `_extract_course_name()` with n-gram index validation

The current function uses 2 rigid regex patterns and is called **after** the search (as a fallback guard). Replace it with a function that works like `_extract_person_names()`: slide a window over the query tokens and validate each n-gram against `course_index`.

Key design decisions:
- Use sliding windows of **6, 5, 4, 3, 2 words** (in that order — prefer longest match)
- Normalise query tokens with `re.findall(r"[a-zA-Z0-9&]+", query)` to preserve `&`
- Normalise each n-gram as `" ".join(tokens).lower().replace("&", "and")` before lookup
- Return the **course_index key** (not the raw query span) so `get_documents_by_course()` receives the normalised form
- Return on the **first** (longest) match found — don't accumulate multiple courses

```python
def _extract_course_names(query: str) -> Optional[str]:
    """Detect a course title in the query by sliding n-gram windows
    against the course_index. Mirrors _extract_person_names().
    Returns the normalised course_index key, or None."""
    doc_service = get_document_service()
    course_index = doc_service.course_index
    if not course_index:
        return None

    tokens = re.findall(r"[a-zA-Z0-9&]+", query)
    if len(tokens) < 2:
        return None

    for size in range(min(6, len(tokens)), 1, -1):  # 6 down to 2
        for i in range(len(tokens) - size + 1):
            ngram = " ".join(tokens[i:i+size]).lower().replace("&", "and")
            ngram = re.sub(r"\s+", " ", ngram).strip()
            if ngram in course_index:
                return ngram
    return None
```

**Note:** The function is renamed to `_extract_course_names` (plural consistent with person names) but returns a single string or None.

### Task 3.2 — Wire course detection into the pre-search filter block

In `stream_chat`, the instructor pre-filter block lives at approximately line 552–564:

```python
if not search_doc_ids:
    person_names = _extract_person_names(search_query)
    if person_names:
        instructor_docs = doc_service.get_documents_by_instructor(person_names[0])
        if instructor_docs:
            search_doc_ids = instructor_docs
```

Immediately after that block (still inside `if not search_doc_ids` OR as a new `if not search_doc_ids` block), add course detection:

```python
if not search_doc_ids:
    detected_course = _extract_course_names(search_query)
    if detected_course:
        course_docs = doc_service.get_documents_by_course(detected_course)
        if course_docs:
            logger.info(f"Course-filtered search: detected '{detected_course}', "
                        f"restricting to {len(course_docs)} docs")
            search_doc_ids = course_docs
        else:
            logger.debug(f"Course '{detected_course}' matched index key but no docs found")
```

**Why `search_query` not `request.message`:** The query rewriter resolves follow-up references ("that course") to the actual course name. Using the rewritten query means follow-ups like "what are the readings?" after a previous course-specific response will still trigger the course filter.

### Task 3.3 — Update `_course_found_in_chunks()` call site to use the same detection

The existing post-search guard at line ~714 calls the old `_extract_course_name(request.message)`. Update it to call the new `_extract_course_names(search_query)` so both detection paths use the same logic and the same query string.

The post-search guard is kept — it serves a different purpose (hallucination prevention when a mis-tagged doc slips through).

---

## Phase 4 — Verification

### Task 4.1 — Startup index check

```bash
cd backend && python3 -c "
from app.services.document_service import get_document_service
import asyncio
async def check():
    ds = get_document_service()
    await ds.bootstrap_registry()
    print(f'course_index entries: {len(ds.course_index)}')
    print(list(ds.course_index.items())[:5])
asyncio.run(check())
"
```

Expected: ~174 entries (matching the 174 docs with course_name).

### Task 4.2 — Query routing test (manual)

Query: `"What are the readings for Climate Finance?"` → should log `"Course-filtered search: detected 'climate finance', restricting to N docs"` and return only Climate Finance syllabus sources.

Query: `"Bruce Usher's readings"` → should still log instructor filter (not course filter — instructor detection fires first).

Query: `"What is ESG?"` → should log no filter applied, full corpus search.

Query follow-up: `"What are the readings?"` (after a previous Climate Finance response, with rewriter resolving context) → should still trigger course filter.

### Task 4.3 — Edge case: short / ambiguous titles

Query: `"Tell me about Agroecology"` — "agroecology" is a 1-word title in the index. The n-gram loop starts at size 2, so it won't match a 1-gram. This is correct — single-word detection is too noisy. The full corpus search will still retrieve Agroecology chunks via semantic similarity.

### Task 4.4 — Regression: instructor filter not broken

Re-run the instructor filter queries to confirm the course detection block (added after the instructor block) does not interfere when both an instructor and a course might be detected.

---

## File Change Summary

| File | Change | Phase |
|---|---|---|
| `backend/app/services/document_service.py` | Add `course_name` to `Document` model | 1.1 |
| `backend/app/services/document_service.py` | Write `course_name` to `Document` in `process_document()` | 1.2 |
| `backend/app/services/document_service.py` | Read `course_name` from Pinecone metadata in `bootstrap_registry()` | 1.3 |
| `backend/app/services/document_service.py` | Add `self.course_index = {}` in `__init__()` | 2.1 |
| `backend/app/services/document_service.py` | Write `_build_course_index()` | 2.2 |
| `backend/app/services/document_service.py` | Write `get_documents_by_course()` | 2.3 |
| `backend/app/services/document_service.py` | Call `_build_course_index()` in `__init__()` | 2.4 |
| `backend/app/services/document_service.py` | Rebuild both indexes after `bootstrap_registry()` | 2.5 |
| `backend/app/services/document_service.py` | Rebuild both indexes after `process_document()` adds doc | 2.6 |
| `backend/app/api/routes/chat.py` | Replace `_extract_course_name()` with n-gram `_extract_course_names()` | 3.1 |
| `backend/app/api/routes/chat.py` | Add course pre-filter block after instructor block in `stream_chat` | 3.2 |
| `backend/app/api/routes/chat.py` | Update post-search guard call site to use new function + `search_query` | 3.3 |

**No changes to:** `pinecone_service.py`, `course_utils.py`, frontend, or any other service. The existing `document_ids` path in `search_documents()` handles the Pinecone scoping — no new filter parameters needed.

---

## Risk Notes

- **`&` normalisation must be consistent** — both index build and query detection must apply the same `&` → `and` substitution or matches will silently fail.
- **Course index is case-insensitive by design** — all keys are lowercased. Pinecone metadata values are not — this is fine since we never filter Pinecone directly by course_name string.
- **28 docs still have empty `course_name`** — these will not appear in `course_index` and won't be restricted to any course filter. This is correct behaviour: they remain in the full-corpus search pool.
- **Instructor filter takes priority** — if both an instructor and a course are detected in the same query, the instructor filter fires first (it's checked first). This is intentional: `"Bruce Usher's Climate Finance readings"` should scope to Usher's documents, which already contain Climate Finance.
- **Index rebuild cost** — rebuilding both indexes on every document upload is O(n) over the registry. At 202 documents this is negligible. Monitor if document count grows significantly.
