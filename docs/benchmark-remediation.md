# Qodex AI Provider Benchmark — Issue Analysis & Remediation

**Date**: February 2026
**Providers evaluated**: Mistral (avg 3.8), Claude (avg 4.1), OpenAI (avg 2.9), Cohere (avg 3.1)
**Benchmark parameters**: Retrieval Accuracy, Instruction Following, Reasoning Depth, Hallucination Rate, Context Integration, Comparative Analysis, Simulation Design, Consistency

---

## Provider Removals

### Issue
OpenAI and Cohere scored below acceptable thresholds (2.9 and 3.1 respectively).

**OpenAI failures:**
- Pulled answers from only 4 schools vs. Mistral's 7 and Claude's 6
- Responses were shorter with no comparison tables, no instructor names, no prerequisites
- Paraphrased everything — impossible to distinguish retrieved content from general knowledge
- No direct quotes from syllabi in comparative analysis prompts
- Attached wrong course code to a syllabus (right retrieval, wrong LLM-attached identifier)

**Cohere failures:**
- Shallowest analytical depth across all prompts
- No instructor names for most courses, no prerequisites
- Did not generate a full response on the simulation design prompt (scored 0)
- No direct quotes from syllabi; all content paraphrased

### Root Cause
Both providers produced generic, ungrounded responses regardless of what Pinecone returned — indicating poor instruction-following of the citation and sourcing rules in the system prompt.

### Remediation
- Deleted `backend/app/providers/openai_provider.py` and `backend/app/providers/cohere_provider.py`
- Removed all references from `providers/__init__.py`, `main.py`, `config.py`, `chat.py`, `requirements.txt`, `.env` files
- Updated frontend: `ProviderName` type narrowed to `'mistral' | 'claude'`, removed from `DEFAULT_PROVIDERS`, name mappings in `ChatMessage.tsx`, `pdfExport.ts`, `docxExport.ts`

---

## Issue 1 — Claude Running at Temperature ~1.0 Instead of 0.1

### User-Flagged Symptom
- Consistency score: **2/5** for Claude (same question asked twice returned materially different responses)
- Claude responses showed higher structural and content variance than Mistral despite both receiving the same base instructions

### Root Cause Found in Analysis
`backend/app/providers/claude_provider.py` lines 87–92: the `messages.stream()` API call was missing the `temperature` parameter entirely.

```python
# Broken — Anthropic API defaults to ~1.0 (maximum randomness)
async with self.client.messages.stream(
    model=self.model,
    max_tokens=max_tokens,
    system=system_message or "",
    messages=formatted_messages,
    # temperature missing
) as stream:
```

Every chat request sends `temperature=0.1` (the request default in `chat.py`), but because Claude's provider never forwarded it, Anthropic applied its internal default of ~1.0. Mistral's provider correctly passed `temperature=temperature` at line 81.

### Remediation
Added `temperature=temperature` to Claude's `messages.stream()` call.

```python
async with self.client.messages.stream(
    model=self.model,
    max_tokens=max_tokens,
    system=system_message or "",
    messages=formatted_messages,
    temperature=temperature,   # ← added
) as stream:
```

**Expected impact**: Claude now operates at temperature 0.1 (same as Mistral). Consistency scores should improve significantly. Hallucination variance also reduced.

---

## Issue 2 — Providers Inferring Beyond Retrieved Sources in Structured Output Modes

### User-Flagged Symptom
- Reasoning Depth: **Mistral 3.5/5** — "Six times Mistral explicitly admits it has no retrieved evidence and is generating from its own knowledge (inferences)"
- Simulation Design: **Mistral 3.5/5** — "Some citations directly tagged to PDFs, but some are plausible and unverifiable"
- Explainer mode noted as "leaving lesser room to retrieve information and more for the LLM to elaborate"

### Root Cause Found in Analysis
The 8 intent-specific prompt suffixes in `backend/app/services/intent_classifier.py` each define a detailed output *structure* (section headings, bullet formats, etc.) but none reiterate the source-grounding requirement established in the base system prompt. When a model is focused on filling a specific structural template, it fills gaps with inference rather than flagging them.

The base system prompt (`claude_provider.py` / `mistral_provider.py`) contains entity verification and anti-hallucination rules, but these are not repeated at the intent level — and the intent suffix is appended *after* the base prompt, effectively becoming the final instruction the model acts on most strongly.

### Remediation
Appended a `STRICT SOURCE REQUIREMENT` block to all 9 prompt suffixes (8 intents + generalist fallback):

```
STRICT SOURCE REQUIREMENT: Base ALL factual claims on the retrieved sources above.
If the sources do not explicitly cover part of the question, state that gap clearly —
do NOT infer, speculate, or fill gaps from general knowledge.
```

**Intents updated**: `summarize`, `explain`, `compare`, `case_study`, `generate_questions`, `critique`, `methodology`, `lesson_plan`, generalist fallback.

**Expected impact**: Mistral's inference behaviour in reasoning-depth and simulation prompts should be replaced with explicit gap acknowledgements. Hallucination rate remains high (5/5) for the absurd-entity test but improves for ambiguous/partial-coverage queries.

---

## Issue 3 — Different Providers Surfacing Different Syllabi from the Same Query

### User-Flagged Symptom
- Retrieval Accuracy: Total unique syllabi surfaced across all 4 providers: **9**. No single provider found all 9.
  - Mistral found 7, Claude found 6, Cohere found 6, OpenAI found 4
- "The LLM choice should only affect how the retrieved material gets presented, not what gets retrieved. But that's not what we see — different LLMs are picking up different syllabi."

### Root Cause Found in Analysis
The Pinecone retrieval pipeline is fully provider-agnostic — all providers receive identical chunks from the same `text-embedding-3-small` query. The discrepancy is not in *retrieval* but in *presentation*: LLMs selectively cite sources they find most relevant and silently omit others, even when those others were retrieved and injected into the context.

The base system prompt's guidelines section explained *how* to cite (`[N]` inline markers) but did not instruct the model to cite *all* relevant retrieved sources.

### Remediation
Added one guideline bullet to both providers' base system prompts (in `claude_provider.py` and `mistral_provider.py`):

```
- Cite from ALL sources that contain relevant information — do not omit retrieved sources that support the answer
```

**Expected impact**: Both providers should surface more overlapping syllabus coverage when answering the same broad query. The total unique syllabi per provider should converge upward rather than each provider cherry-picking a subset.

---

## Issues Not Addressed (by design)

| Issue | Benchmark Finding | Decision |
|-------|-------------------|----------|
| Claude UI cutoff (Instruction Following score 2) | "The UI is cutting off takeaway 3. Only 2 takeaways visible." | Frontend code analysis confirmed **zero CSS truncation or height limits**. The full text was in the DOM (user confirmed copy-paste worked). Assessed as a scroll-position issue, not a code bug. No change made. |
| Inherent consistency variance | All providers scored 2/5 on consistency | At temperature=0.1 some variance is inherent to autoregressive sampling. Fix 1 (Claude temp) will reduce this substantially but not eliminate it. Acceptable. |
| top_k retrieval counts | — | Already well-configured: Quick=7 (3× over-fetch = 21 candidates), Enhanced=12/36, Deep=16/48. No change needed. |

---

## Files Modified

| File | Change |
|------|--------|
| `backend/app/providers/claude_provider.py` | Added `temperature=temperature` to stream call; added cite-all guideline bullet |
| `backend/app/providers/mistral_provider.py` | Added cite-all guideline bullet |
| `backend/app/services/intent_classifier.py` | Added STRICT SOURCE REQUIREMENT footer to all 9 prompt suffixes |
| `backend/app/providers/openai_provider.py` | **Deleted** |
| `backend/app/providers/cohere_provider.py` | **Deleted** |
| `backend/app/providers/__init__.py` | Removed OpenAI and Cohere exports |
| `backend/app/main.py` | Removed OpenAI and Cohere from startup status |
| `backend/app/core/config.py` | Removed `openai_model`, `cohere_api_key`, `cohere_model` settings |
| `backend/app/api/routes/chat.py` | Removed OpenAI and Cohere from provider_configs |
| `backend/requirements.txt` | Removed `cohere>=4.47` |
| `backend/.env` / `.env.example` / `.env.production.example` | Removed Cohere and OpenAI model env vars |
| `frontend/src/shared/types/index.ts` | Narrowed `ProviderName` to `'mistral' \| 'claude' \| 'auto'` |
| `frontend/src/features/providers/store.ts` | Removed OpenAI and Cohere from `DEFAULT_PROVIDERS` |
| `frontend/src/features/chat/components/chat/ChatMessage.tsx` | Removed OpenAI and Cohere from provider name mappings |
| `frontend/src/shared/services/pdfExport.ts` | Removed OpenAI and Cohere from provider name mappings |
| `frontend/src/shared/services/docxExport.ts` | Removed OpenAI and Cohere from provider name mappings |
