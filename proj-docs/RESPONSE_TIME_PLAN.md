# Response Time Reduction Plan

## Context

Response times are running 30-40s on broad generalist queries. Four distinct bottlenecks identified through code inspection. Each is independent. Goal: cut perceived wait time without degrading citation quality.

---

## Bottleneck Breakdown

| # | Bottleneck | File | Impact |
|---|---|---|---|
| 1 | `effective_max_tokens` takes MAX — intent caps never lower output budget | `chat.py:836-844` | **Highest** — generalist outputs up to 8192 tokens when 2000 is sufficient |
| 2 | Suggested questions block the `done` event | `chat.py:896-931` | Medium — 300-800ms dead time after stream completes |
| 3 | No per-document chunk cap — all chunks from every doc go into context | `chat.py:702` | Medium — cuts TTFT by 3-6s on heavy queries |
| 4 | No total context hard cap | `chat.py:719-720` | Low/Safety net |

---

## Fix 1 — `effective_max_tokens` Logic + Per-Intent Caps

**Problem (`chat.py:836-844`):**
```python
effective_max_tokens = max(request.max_tokens, intent_result.max_tokens or 0)
```
Takes the *larger* value. An intent override of 2000 is silently ignored because `request.max_tokens` defaults to 8192. Intent-level output caps are completely inert.

**Fix:**
```python
effective_max_tokens = intent_result.max_tokens or request.max_tokens
```
Intent override wins when set; falls back to request default.

**Then set `max_tokens` per intent in `intent_classifier.py`:**

| Intent | Current | New |
|---|---|---|
| generalist | None → 8192 | 2500 |
| summarize | None → 8192 | 1500 |
| explain | None → 8192 | 1500 |
| compare | None → 8192 | 2000 |
| critique | None → 8192 | 2000 |
| methodology | None → 8192 | 2000 |
| lesson_plan | None → 8192 | 3000 |
| find_readings | None → 8192 | 1500 |
| builder | 12000 | 12000 (keep) |
| continuation | 12000 | 12000 (keep) |

**Expected gain:** ~15s on heavy generalist queries (generating 2500 tokens vs 8192).

---

## Fix 2 — Suggested Questions Non-Blocking

**Problem (`chat.py:896-931`):** After the last response chunk streams, the endpoint awaits a second LLM call before sending the `done` event. The user sees the full response but UI stays in loading state for 300-800ms.

**Fix:** Send `done` immediately after the stream, fire suggested questions as a background `asyncio.create_task`. The frontend already handles `suggested_questions` as a separate SSE event from `done` — no frontend changes needed.

```python
# Send done immediately
yield f"data: {json.dumps({'type': 'done', ...})}\n\n"

# Fire in background — sends suggested_questions SSE event when ready
asyncio.create_task(_generate_and_send_suggested_questions(...))
```

**Expected gain:** 300-800ms eliminated from end of every response.

---

## Fix 3 — Per-Document Chunk Cap

**Problem (`chat.py:702`):**
```python
combined_content = "\n\n".join(group["chunks"])  # ALL chunks, no limit
```
A single syllabus can contribute 6-10 chunks. 7 sources × 8 chunks = 56 chunks in context.

**Fix:** Cap at 3 chunks per document:
```python
combined_content = "\n\n".join(group["chunks"][:3])
```

**Expected gain:** Context size cut 40-60% on heavy queries → TTFT reduced 3-6s.

---

## Fix 4 — Total Context Hard Cap

**Problem (`chat.py:719-720`):** No ceiling on assembled context string.

**Fix:** After joining `context_parts`, truncate at last clean source boundary if over 28,000 chars:
```python
_MAX_CONTEXT_CHARS = 28_000

if context_parts:
    context = "\n\n---\n\n".join(context_parts)
    if len(context) > _MAX_CONTEXT_CHARS:
        last_boundary = context[:_MAX_CONTEXT_CHARS].rfind("\n\n---\n\n")
        if last_boundary > _MAX_CONTEXT_CHARS // 2:
            context = context[:last_boundary]
        else:
            context = context[:_MAX_CONTEXT_CHARS]
```

**Expected gain:** Safety net — minimal day-to-day impact once Fix 3 is in.

---

## Implementation Order

| Priority | Fix | Effort | Gain |
|---|---|---|---|
| 1 | Fix `effective_max_tokens` + per-intent caps | 20 min | ~15s on generalist |
| 2 | Suggested questions non-blocking | 20 min | 300-800ms every response |
| 3 | Per-document chunk cap | 10 min | 3-6s TTFT on heavy queries |
| 4 | Total context hard cap | 10 min | Safety net |

---

## Critical Files

- `backend/app/api/routes/chat.py` — lines 702, 719-720, 836-844, 896-931
- `backend/app/services/intent_classifier.py` — all intent definitions, `max_tokens` fields

## Verification

1. Run: "I need some ideas for my sustainability management course" — target: ~18-22s (down from ~38s)
2. Confirm `[N]` and `[AI:N,M]` citation markers still present
3. Confirm suggested questions appear in UI after `done` (slight delay acceptable)
4. Builder intent still gets full 12000 token budget
5. Continuation intent still gets 12000 token budget
6. Short factual query ("who teaches SUMA PS4100") stays fast and concise
