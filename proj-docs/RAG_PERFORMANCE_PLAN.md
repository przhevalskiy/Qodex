# RAG Performance Optimization Plan — Reducing Streaming Latency on Heavy Queries

## Background

On heavy queries the LLM receives a large assembled context string before generating its first token. Attention cost scales quadratically with context length, so a query that pulls 16 documents — each potentially contributing several chunks — can push the system prompt past 20,000 tokens. The first token latency (TTFT) and inter-token rate both degrade. Four targeted changes address this without degrading answer quality.

The user experience is: **thinking indicator → first token arrives**. The gap between those two is what's felt. Changes 1+2 directly compress that gap by reducing context size. Change 3 is the absolute safety net.

---

## Pipeline Order (how all systems interact)

```
User selects research mode  → sets min_score threshold only
Intent classifier fires     → sets base_chunks + max_chunks per document
Task verb count             → scales chunk cap within intent bounds
Pinecone fetch              → fixed top_k ceiling (20) × 2 over-fetch
min_score filter            → research mode owns this stage exclusively
Entity boost re-ranking     → per-chunk effective_score calculated
Document deduplication      → by filename, keep highest score group
Sort by effective_score     → document groups ranked
Dynamic chunk cap           → intent + verb count applied per document
Context assembly            → context_parts joined
Hard cap (Change 3)         → absolute ceiling regardless of all above
LLM streaming               → smaller context = faster token generation
```

Each system owns a distinct, non-overlapping stage. No conflicts.

---

## Change 1 — Chunk Ordering Fix (Prerequisite, implement with Change 2)

**File:** `backend/app/api/routes/chat.py`

**Problem:** Chunks within each `doc_groups[doc_id]["chunks"]` are appended in Pinecone's raw return order. Entity boost is applied per-chunk individually, meaning a chunk arriving 8th could have a higher `effective_score` than one arriving 1st. Any cap applied without sorting first cuts the wrong chunks.

**Change:** Store chunks as `(content, effective_score)` tuples. Sort descending by effective score before slicing.

```python
# In the result accumulation loop (replace the append line):
group["chunks"].append((content, effective_score))

# In context assembly (replace the join line):
sorted_chunks = sorted(group["chunks"], key=lambda x: x[1], reverse=True)
top_chunks = [c for c, _ in sorted_chunks[:effective_chunk_cap]]
combined_content = "\n\n".join(top_chunks)
```

**Standalone effect:** None. This change alone produces identical output and identical speed. It is only meaningful when Change 2 is applied on top of it. Do not implement separately.

---

## Change 2 — Dynamic Per-Document Chunk Cap (implement with Change 1)

**Files:** `backend/app/api/routes/chat.py`, `backend/app/services/intent_classifier.py`

**Problem:** All chunks from every matched document pass into the LLM context with no upper bound. A single syllabus PDF can contribute 8–12 chunks. Context bloat is the direct cause of slow token generation. A flat cap ignores query complexity — a short factual question and a broad multi-part synthesis query should not receive the same chunk depth.

**Architecture:** The cap is computed dynamically from two signals available at classification time:

1. **Intent base cap** — each intent has a `base_chunks` value reflecting its typical information need
2. **Task verb count** — `_count_task_verbs()` is already implemented; more verbs = broader query = more chunks needed

```
effective_chunk_cap = min(
    base_chunks_for_intent + task_verb_count,
    max_chunks_for_intent
)
```

### 2a — Extend `IntentResult` dataclass

```python
@dataclass
class IntentResult:
    intent: str
    label: str
    prompt_suffix: str
    use_knowledge_base: bool = True
    preferred_provider: Optional[str] = None
    max_tokens: Optional[int] = None
    base_chunks_per_doc: Optional[int] = None  # base chunk cap for this intent
    max_chunks_per_doc: Optional[int] = None   # ceiling regardless of verb count
```

### 2b — Per-intent chunk values

| Intent | base_chunks | max_chunks | Rationale |
|---|---|---|---|
| summarize | 2 | 5 | Single doc summary; top chunks carry the content |
| explain | 2 | 5 | Concept explanation; top chunks carry the definition |
| find_readings | 2 | 4 | Only needs reading list sections |
| compare | 3 | 7 | Needs multiple perspectives across sources |
| critique | 3 | 7 | Needs evidence breadth |
| methodology | 3 | 8 | May need full methodological sections |
| generalist | 3 | 8 | Highly variable — verb count does the scaling |
| lesson_plan | 4 | 8 | Needs full doc structure |
| builder | 5 | 12 | Authoring from scratch; needs maximum coverage |
| continuation | inherits primary | inherits primary | No change |

### 2c — Dynamic cap calculation in `chat.py`

```python
# Global fallback constants (when intent has no override):
_DEFAULT_BASE_CHUNKS = 3
_DEFAULT_MAX_CHUNKS = 8

# After intent classification:
task_verbs = _count_task_verbs(request.message)

base = intent_result.base_chunks_per_doc or _DEFAULT_BASE_CHUNKS
ceiling = intent_result.max_chunks_per_doc or _DEFAULT_MAX_CHUNKS
effective_chunk_cap = min(base + task_verbs, ceiling)
```

### Examples

| Query | Intent | Verbs | Cap |
|---|---|---|---|
| "who teaches this course" | generalist | 1 | 3 + 1 = 4 |
| "find X, prepare me, summarize readings, map outline" | generalist | 4 | 3 + 4 = 7 |
| "explain carbon pricing" | explain | 1 | 2 + 1 = 3 |
| "build a full case study on solar finance" | builder | 1 | 5 + 1 = 6 |
| "build a case study, include financing, risk table, discussion questions" | builder | 3 | 5 + 3 = 8 |

**Tradeoff:** Zero latency cost — all calculation is synchronous at classification time. Risk: a misfiled intent gets a lower base cap. The global fallback constants are the safety net. If citation density drops after deployment, the cap is too aggressive — raise `_DEFAULT_BASE_CHUNKS`.

---

## Change 3 — Total Context Length Hard Cap

**File:** `backend/app/api/routes/chat.py`

**Problem:** Even with per-document chunk capping, edge cases with many documents each contributing several chunks can still produce a large context string. A hard ceiling is the absolute safety net.

**Change:**

```python
# Near the top of chat.py:
_MAX_CONTEXT_CHARS = 28_000  # ~7,000 tokens; absolute ceiling

# After context_parts are joined:
if context_parts:
    context = "\n\n---\n\n".join(context_parts)
    if len(context) > _MAX_CONTEXT_CHARS:
        last_boundary = context[:_MAX_CONTEXT_CHARS].rfind("\n\n---\n\n")
        if last_boundary > _MAX_CONTEXT_CHARS // 2:
            context = context[:last_boundary]
        else:
            context = context[:_MAX_CONTEXT_CHARS]
        logger.info(f"Context truncated to {len(context)} chars")
```

28,000 chars (~7,000 tokens) leaves headroom for the system prompt boilerplate (~6,000 tokens), intent prompt (~1,500 tokens), and the response budget within a 16,384-token model window.

**Tradeoff:** Lowest-scoring sources (assembled last, already score-sorted) may be silently dropped. These are the least likely to be cited.

---

## Implementation Order

| Priority | Change | Effort | Expected Benefit |
|---|---|---|---|
| 1 | Changes 1+2 together — chunk ordering + dynamic cap | 45 min | Core streaming win; 30–60% context reduction on heavy queries |
| 2 | Change 3 — total context hard cap | 20 min | Absolute ceiling; protects edge cases |

**Changes 1+2 must be implemented as one atomic change.** Change 3 is independent and can follow.

---

## What Does NOT Change

- `_rewrite_search_query` skip logic — already implemented via `_REWRITE_TRIGGERS`
- Entity-first filtering (`_extract_person_names`, `_extract_course_names`) — untouched
- Document-level deduplication by filename — untouched
- Score-based sorting of `sorted_groups` at document level — untouched
- `min_score` values — unchanged from current (0.40 / 0.30 / 0.25)
- Research mode three-position UI structure — unchanged
- RAG_CHUNK_RETRIEVAL_ISSUE second-pass fetch — explicitly deferred

---

## Monitoring After Deployment

1. `effective_chunk_cap` — log per request; validate verb-count scaling behaves as expected
2. `context_char_len` — log after assembly; watch for consistent hits on the hard cap
3. `chunks_dropped_per_doc` — log `len(group["chunks"]) - effective_chunk_cap` when positive
4. `min_score_threshold` — log which research mode threshold fired per request
5. Citation density per mode — if Quick mode shows significantly fewer `[N]` markers after `prompt_enhancement` retirement, add lightweight citation count guidance back to intent definitions

---

## Critical Files

- `backend/app/api/routes/chat.py` — main RAG pipeline, context assembly, streaming
- `backend/app/services/intent_classifier.py` — `IntentResult` dataclass + intent definitions + `_count_task_verbs()`
- `backend/app/core/research_modes.py` — research mode definitions
- `frontend/src/features/research/config.ts` — UI labels
