# Plan: Citation Policy Centralization & Scalable Prompt Architecture

## Context

Citation rules currently live in **4 separate locations** with diverging content:

| Location | Role | Problem |
|---|---|---|
| `backend/app/providers/mistral_provider.py` (lines 36–92) | Full inline system prompt | Mistral-specific quirks mixed with shared policy |
| `backend/app/providers/claude_provider.py` (lines 37–91) | Full inline system prompt | Claude-specific rules mixed with shared policy |
| `backend/app/providers/base.py` (lines 85–123) | Template for other providers | Missing SYLLABUS RULE, VERBATIM TEST, 3-tier policy |
| `backend/app/services/intent_classifier.py` `_CITATION_POLICY` (lines 22–48) | Appended to every intent suffix | Most up-to-date version, isolated; duplicates provider system messages |

Every citation rule change requires editing up to 4 files. Drift is already present (base.py is missing rules Mistral and Claude have). There is no safe extension point for adding new citation tiers.

**Root cause**: citation policy (product rule) is entangled with provider I/O formatting (infrastructure). The goal: one canonical policy module, thin providers that call it.

---

## Current Prompt Composition (as-is)

```
chat.py calls provider.stream_completion(
    context,           → RAG sources block
    research_prompt,   → from research_modes.py
    intent_prompt,     → from intent_classifier.py (already includes _CITATION_POLICY)
)

Provider builds system prompt inline:
  [context block + syllabus rule + guidelines + inference policy
   + verbatim test + attribution rules + placement rules + examples]
  + research_prompt
  + intent_prompt          ← _CITATION_POLICY is appended HERE again (duplicate)
```

`_CITATION_POLICY` in intent_classifier.py is the most complete version. The provider system messages are a second, slightly-different copy. The model currently receives citation policy **twice** on every request.

---

## Target Architecture

```
backend/app/prompts/
  __init__.py
  citation_policy.py     ← single source of truth for all citation/inference rules
  prompt_builder.py      ← assembles full system prompt; providers call this

providers become thin:
  base.py                ← calls build_system_prompt(); no inline policy strings
  mistral_provider.py    ← calls build_system_prompt(provider_quirks=MISTRAL_QUIRKS)
  claude_provider.py     ← calls build_system_prompt(provider_quirks=None)

intent_classifier.py:
  _CITATION_POLICY       ← replaced by import from citation_policy.py (1-line change)
```

---

## Phase 1 — Create `backend/app/prompts/citation_policy.py`

**New file.** Every citation rule is a named string constant. Sections map 1:1 to the logical blocks that exist today across providers.

```python
CITATION_POLICY_VERSION = "v1"

# --- Section constants ---

CONTEXT_INTRO: str
# "Use the following context to help answer the user's question.
#  Each source is numbered... [Sources for reference]\n{context}"

SYLLABUS_RULE: str
# "SYLLABUS RULE — When retrieved sources are course syllabi...
#  Do NOT generate content about materials they reference..."

GUIDELINES: str
# "- ONLY use citation numbers that match the [Source N] headers...
#  - Do NOT use footnotes from inside source documents...
#  - Cite from ALL sources that contain relevant information..."

INFERENCE_POLICY: str
# "INFERENCE POLICY — Three markers:
#  Tier 1 — Grounded facts (inference prohibited)...
#  Tier 2 — Source-grounded inference (permitted, must be attributed)...
#  Tier 3 — General knowledge (permitted, must be labeled)..."

VERBATIM_TEST: str
# "CITATION INTEGRITY — THE VERBATIM TEST:
#  Before tagging any statement as [N], ask: 'Can I find this specific claim...'
#  - A source that lists a case study does NOT contain that case study's facts..."

ATTRIBUTION_RULES: str
# "REQUIRED — Inference & Knowledge Attribution:
#  Every sentence MUST carry exactly one marker: [N] / [AI:N,M] / [AI]
#  - [N] and [AI] are mutually exclusive...
#  - NEVER place citation markers at the START of a sentence...
#  - NEVER write 'Inference:', 'Note:', 'Observation:'...
#  Examples: ..."

MISTRAL_QUIRKS: str
# Provider-specific formatting artifact rules (NOT product policy):
# "- Citations must immediately follow the claim with no space...
#  - NEVER end a sentence or bullet with a space before the period..."

CLOSING: str
# "Now provide an accurate and helpful response with inline citations."

ATTACHMENT_ONLY_RULES: str
# "The user has attached documents... Reference by filename...
#  Do NOT use numbered citation markers like [1] or [2]..."

# --- Canonical export used by intent_classifier.py ---
CITATION_POLICY: str
# Compact form of ATTRIBUTION_RULES + VERBATIM_TEST for intent suffix append.
# Replaces the existing _CITATION_POLICY string in intent_classifier.py.
```

**Scalability**: adding Tier 4 (e.g., cross-document synthesis) = edit `INFERENCE_POLICY` + bump `CITATION_POLICY_VERSION`. Zero other files change.

---

## Phase 2 — Create `backend/app/prompts/prompt_builder.py`

**New file.** Single function that assembles the base system prompt.

```python
from typing import Literal, Optional
from app.prompts.citation_policy import (
    CONTEXT_INTRO, SYLLABUS_RULE, GUIDELINES, INFERENCE_POLICY,
    VERBATIM_TEST, ATTRIBUTION_RULES, CLOSING, ATTACHMENT_ONLY_RULES,
)

def build_system_prompt(
    context: str,
    context_type: Literal["pinecone", "attachment"],
    provider_quirks: Optional[str] = None,
) -> str:
    if context_type == "pinecone":
        return "\n\n".join(filter(None, [
            CONTEXT_INTRO.format(context=context),
            SYLLABUS_RULE,
            GUIDELINES,
            INFERENCE_POLICY,
            VERBATIM_TEST,
            ATTRIBUTION_RULES,
            provider_quirks,
            CLOSING,
        ]))
    else:
        return ATTACHMENT_ONLY_RULES.format(context=context)
```

`research_prompt` and `intent_prompt` are **not** passed here. They remain as append-after-system in each provider, preserving the existing composition order. The builder owns only the base system message.

---

## Phase 3 — Slim down providers

**Files: `base.py`, `mistral_provider.py`, `claude_provider.py`**

Replace ~60-line inline string blocks in each provider with:

```python
# mistral_provider.py
from app.prompts.prompt_builder import build_system_prompt
from app.prompts.citation_policy import MISTRAL_QUIRKS

context_type = "attachment" if is_attachment_only else "pinecone"
system_content = build_system_prompt(context, context_type, provider_quirks=MISTRAL_QUIRKS)
if research_prompt:
    system_content += research_prompt
if intent_prompt:
    system_content += intent_prompt
```

```python
# claude_provider.py — identical, provider_quirks=None
system_message = build_system_prompt(context, context_type, provider_quirks=None)
if research_prompt:
    system_message += research_prompt
if intent_prompt:
    system_message += intent_prompt
```

`base.py`'s `_format_messages_for_api()` does the same. The `attachment_only` detection already exists in all providers (the `elif` branch on `has_pinecone_sources`) — maps directly to `context_type`.

---

## Phase 4 — Update `intent_classifier.py`

Single-line change at line 22. Replace the entire `_CITATION_POLICY = (...)` block with:

```python
from app.prompts.citation_policy import CITATION_POLICY as _CITATION_POLICY
```

Zero other changes. All 10 intent `prompt_suffix` strings, `CONTINUATION_INSTRUCTION`, `INTENT_LOOKUP`, and the line-449 append loop are untouched.

---

## What Does NOT Change

- `chat.py` — call signature, RAG pipeline, intent resolution, continuation logic, course-not-found fallback
- `intent_classifier.py` — all 10 intent definitions, patterns, prompt_suffix structures, CONTINUATION_INSTRUCTION
- `research_modes.py` — untouched
- Provider API call code (Mistral async stream, Claude messages.stream) — untouched
- Frontend — no changes

---

## Files Summary

| File | Action | Description |
|---|---|---|
| `backend/app/prompts/__init__.py` | Create | Empty init |
| `backend/app/prompts/citation_policy.py` | Create | All named section constants + `CITATION_POLICY` export |
| `backend/app/prompts/prompt_builder.py` | Create | `build_system_prompt()` function |
| `backend/app/providers/base.py` | Modify | Replace inline strings with `build_system_prompt()` |
| `backend/app/providers/mistral_provider.py` | Modify | Replace inline strings with `build_system_prompt(MISTRAL_QUIRKS)` |
| `backend/app/providers/claude_provider.py` | Modify | Replace inline strings with `build_system_prompt(None)` |
| `backend/app/services/intent_classifier.py` | Modify | Replace `_CITATION_POLICY` block with 1-line import |

---

## Scalability: Adding a New Citation Tier

```
1. Edit citation_policy.py → update INFERENCE_POLICY with new tier text
2. Bump CITATION_POLICY_VERSION = "v2"
3. Deploy
```

All 3 providers and all 10 intents pick it up automatically. No other files change.

---

## Verification Checklist

- [ ] Backend starts with no import errors: `cd backend && uvicorn app.main:app --reload`
- [ ] Grounded query → `[N]` markers appear correctly
- [ ] Inference query → `[AI:N,M]` and `[AI]` appear correctly, never at sentence start
- [ ] Mistral provider → spacing quirk rule still applies
- [ ] "Continue" query → continuation response unaffected
- [ ] Attachment query → no `[N]` markers, filenames referenced instead
- [ ] (Optional debug) Log assembled system prompt and diff against pre-refactor output to confirm byte-for-byte equivalence

---

## Prompt Compliance Problem (Separate from Refactor)

### What the refactor does and does not fix

The refactor is an **architecture change**, not a content change. It centralizes the existing rules into one file. It fixes:

- **Duplication**: the model currently receives citation policy twice per request — once from the provider system message, and again from `_CITATION_POLICY` appended via `intent_prompt`. This is noise that may dilute rule priority.
- **Drift**: `base.py` is missing SYLLABUS RULE, VERBATIM TEST, and the 3-tier inference policy entirely. Any provider using `base.py` doesn't get those rules.

It does **not** fix model compliance — the model receiving better-organized rules does not guarantee it follows them.

### Observed failure mode

On broad knowledge queries (e.g., "are carbon credits effective?"), the model:

1. Answers from general training knowledge (correct, since the retrieved syllabi don't contain empirical data)
2. Fabricates specific statistics: "EU ETS led to firm-level reductions of 10-15%", "only ~30% of voluntary carbon offsets were additional", "~20% of forest carbon credits were invalidated"
3. Tags those fabricated statistics as `[1]` (a course syllabus) instead of `[AI]`
4. Omits citation markers entirely from many sentences

The rules that should have prevented this already exist in `claude_provider.py`:

> "Specific numbers (percentages, dollar amounts, dates, counts) are almost never present in a course syllabus or summary source — tag them [AI] unless you can read them verbatim in the source text provided"

> "Before tagging any statement as [N], ask: 'Can I find this specific claim in the source text above?'"

The model reads these rules and ignores them on broad knowledge queries.

### Why it happens

When the query outpaces the retrieved sources (syllabi reference topics but don't contain underlying data), the model defaults to answering from training knowledge. It then retrofits `[N]` citations from whichever source mentioned the topic — violating the VERBATIM TEST — rather than using `[AI]`. This is a consistent pattern: the model prioritizes appearing well-sourced over accurate attribution.

### Levers to improve compliance

Reorganizing where the rules live (the refactor) is a prerequisite for any of the following, but is not sufficient on its own:

1. **Failure-mode examples in the prompt**: Add a negative example showing exactly what went wrong:
   ```
   ✗ WRONG: "The EU ETS reduced firm-level emissions by 10-15%. [1]"
     → [1] is a course syllabus. Syllabi do not contain this number.
   ✓ CORRECT: "The EU ETS reduced firm-level emissions by 10-15%. [AI]"
   ```
   Negative examples (showing the forbidden pattern) are consistently more effective than positive-only examples for compliance.

2. **Stricter Tier 1 framing**: Rephrase "inference prohibited" as an explicit prohibition on generating stats:
   > "NEVER generate a percentage, dollar amount, date, or count unless you can copy it verbatim from the source text above. If the source only mentions the topic without the number, write the claim and mark it [AI]."

3. **Model selection**: Claude Sonnet follows instruction prompts more reliably than Mistral Large on multi-rule compliance tasks. If citation quality is a product priority, provider selection matters.

### Where to implement

All three levers above require editing `VERBATIM_TEST` and `ATTRIBUTION_RULES` in `citation_policy.py` (post-refactor). Pre-refactor, the same changes would need to be made in `claude_provider.py`, `mistral_provider.py`, and `base.py` separately — which is exactly why the refactor is a prerequisite.
