# Research Mode Retrofit Plan

## Background

Research modes currently control three things: `top_k` (document count), `min_score` (retrieval threshold), and `prompt_enhancement` (synthesis style). After the dynamic chunk cap in the RAG performance plan, `top_k` becomes redundant — intent + verb count handles document depth more accurately. `prompt_enhancement` conflicts with intent `prompt_suffix` — both append synthesis instructions to the same system prompt, sending contradictory instructions to the model.

Only `min_score` remains genuinely non-conflicting. It sits at the top of the retrieval pipeline, before intent classification, before chunk capping, before context assembly — a completely separate stage that nothing else touches.

**Resolution:** Research modes become purely retrieval sensitivity controls. `min_score` is the only differentiator between modes. Names and icons are updated to reflect what the user is actually choosing.

---

## Pipeline Position

```
User selects research mode  → sets min_score only (this change)
Pinecone fetch              → fixed top_k ceiling (20) × 2
min_score filter            → research mode owns this stage exclusively  ← HERE
Entity boost re-ranking     → per-chunk effective_score
Dynamic chunk cap           → intent + verb count (RAG performance plan)
Context assembly + hard cap → RAG performance plan
LLM streaming
```

---

## What Changes

### Names and Icons

| Current | New | Icon | Rationale |
|---|---|---|---|
| Quick | **Focused** | `Crosshair` | Tight, on-target, precise — matches min_score 0.40 |
| Enhanced | **Broad** | `ScanSearch` | Wider scan, more coverage — matches min_score 0.30 |
| Deep Research | **Exploratory** | `Telescope` | Open discovery, widest net — matches min_score 0.25 |

`Zap` (speed) and `Atom` (scientific depth) retired — both implied the wrong mental model. `Telescope` was already used for Enhanced and maps better to Exploratory, so it stays but moves. `Crosshair` and `ScanSearch` are unused in the current codebase.

### What each mode now means to the user

- **Focused** — only chunks with strong semantic similarity pass (0.40). Precise answers, tight signal. Best for specific, well-formed queries.
- **Broad** — adjacent and related concepts included (0.30). Cross-source synthesis, richer context. Best for topic exploration.
- **Exploratory** — widest net (0.25). Weakly related material passes through. Best for open-ended discovery and comparative queries.

The intent classifier handles output structure and synthesis style — the mode only controls how wide the retrieval net is cast.

---

## Implementation Checklist

### Backend — `backend/app/core/research_modes.py`

- [ ] Remove `prompt_enhancement` field from `ResearchModeConfig` dataclass entirely
- [ ] Set `top_k=20` for all three modes (fixed ceiling — same value for all)
- [ ] Leave `min_score` values unchanged: 0.40 / 0.30 / 0.25
- [ ] Update `label` field: `"Quick"` → `"Focused"`, `"Enhanced"` → `"Broad"`, `"Deep Research"` → `"Exploratory"`
- [ ] Update `description` field to reflect retrieval sensitivity, not document count or output style

```python
ResearchMode.QUICK: ResearchModeConfig(
    mode=ResearchMode.QUICK,
    label="Focused",
    description="Searches for the most directly relevant sources",
    top_k=20,
    min_score=0.40,
),
ResearchMode.ENHANCED: ResearchModeConfig(
    mode=ResearchMode.ENHANCED,
    label="Broad",
    description="Wider search including adjacent and related sources",
    top_k=20,
    min_score=0.30,
),
ResearchMode.DEEP: ResearchModeConfig(
    mode=ResearchMode.DEEP,
    label="Exploratory",
    description="Widest search for open-ended discovery and analysis",
    top_k=20,
    min_score=0.25,
),
```

### Backend — `backend/app/api/routes/chat.py`

- [ ] Remove `research_prompt=research_config.prompt_enhancement` argument from the `stream_completion` call entirely
- [ ] Find where `research_config.top_k` drives `pinecone_top_k` — replace with fixed `pinecone_top_k = 40` (20 × 2 over-fetch, same for all modes)
- [ ] Confirm `min_score` is still read from `research_config.min_score` — no change needed here

### Backend — providers

- [ ] `backend/app/providers/base.py` — remove `research_prompt` parameter from `stream_completion` signature and remove the `if research_prompt` append block
- [ ] `backend/app/providers/mistral_provider.py` — same removal
- [ ] `backend/app/providers/claude_provider.py` — same removal

### Frontend — `frontend/src/features/research/config.ts`

- [ ] Replace `Zap` import with `Crosshair`
- [ ] Replace `Atom` import with `ScanSearch`
- [ ] Keep `Telescope` import (moves from Enhanced to Exploratory)
- [ ] Update `quick` config: icon → `Crosshair`, label → `"Focused"`, description → retrieval sensitivity language
- [ ] Update `enhanced` config: icon → `ScanSearch`, label → `"Broad"`, description updated
- [ ] Update `deep` config: icon → `Telescope`, label → `"Exploratory"`, description updated
- [ ] Remove `rangeLabel` from all three configs ("up to 7", "up to 12", "up to 16" — document count is no longer user-facing)

```typescript
import { Crosshair, ScanSearch, Telescope } from 'lucide-react';

export const RESEARCH_MODE_UI: Record<ResearchMode, ResearchModeUIConfig> = {
  quick: {
    icon: Crosshair,
    label: 'Focused',
    description: 'Searches for the most directly relevant sources',
  },
  enhanced: {
    icon: ScanSearch,
    label: 'Broad',
    description: 'Wider search including adjacent and related sources',
  },
  deep: {
    icon: Telescope,
    label: 'Exploratory',
    description: 'Widest search for open-ended discovery and analysis',
  },
};
```

### Frontend — `frontend/src/features/research/components/ResearchModeSelector.tsx`

- [ ] Find where `rangeLabel` is rendered and remove that element
- [ ] Confirm label and description fields render from config (no hardcoded strings)

### Frontend — `frontend/src/features/research/store.ts`

- [ ] Update `DEFAULT_MODES` fallback array: update labels and descriptions to match new names
- [ ] Remove source count from descriptions ("7 sources", "12 sources", "16 sources")

---

## Verify

- [ ] Focused mode query — confirm only high-relevance chunks retrieved, response quality unchanged
- [ ] Broad mode query — confirm adjacent content pulls through, citation breadth increases vs Focused
- [ ] Exploratory mode query — confirm widest retrieval, weakly related material surfaces
- [ ] Builder intent on any mode — confirm chunk depth unchanged (intent cap handles it, not mode)
- [ ] Confirm `research_prompt` parameter no longer exists in any provider `stream_completion` signature
- [ ] UI shows correct icons and labels for all three modes
- [ ] Default mode (Focused) persists correctly via Zustand store

---

## What Does NOT Change

- `min_score` values — 0.40 / 0.30 / 0.25, unchanged
- Enum keys (`quick`, `enhanced`, `deep`) — kept as-is to avoid breaking stored preferences in Zustand persist
- Three-position UI structure — unchanged
- Default mode — remains Quick/Focused
- Research mode selector component position in the plus dropdown — unchanged

---

## Critical Files

- `backend/app/core/research_modes.py`
- `backend/app/api/routes/chat.py`
- `backend/app/providers/base.py`
- `backend/app/providers/mistral_provider.py`
- `backend/app/providers/claude_provider.py`
- `frontend/src/features/research/config.ts`
- `frontend/src/features/research/components/ResearchModeSelector.tsx`
- `frontend/src/features/research/store.ts`
