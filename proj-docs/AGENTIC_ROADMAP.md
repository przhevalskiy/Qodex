# Qodex Agentic Roadmap
**Document Date:** March 2026
**Current Level:** L2 (Reactive RAG)
**Target Level:** L3–L4 (Guided + Proactive)

---

## Where We Are — L2 Defined

Qodex today is a **reactive, single-turn RAG system**. The interaction loop is:

```
User asks → Pinecone retrieves → LLM answers → User asks again
```

The system is optimized for retrieval precision but offers no feedback mechanism when retrieval is weak, no memory of what's been explored across sessions, and no ability to guide users toward what it knows. Every turn is stateless from the user's perspective.

**What makes it L2:**
- Responds to prompts but does not initiate
- No cross-session memory or continuity
- No self-correction or confidence signaling
- No awareness of its own knowledge boundaries
- Empty state uses hardcoded prompts disconnected from the actual KB
- Suggested questions are context-aware but not KB-aware
- Low retrieval scores fail silently into generic LLM fallback

**The core feedback that frames this:**
> *"It requires repeated and increasingly specific prompting to arrive at the desired output, which assumes prior familiarity with the underlying database."*

This is the L2 ceiling. Users carry the cognitive load of knowing what to ask and how to ask it. The system does not meet them halfway.

---

## The Retrieval Spectrum — How the System Currently Handles It

Understanding where the system breaks down requires mapping the full retrieval range:

| Score Range | Current Behavior | Correct Behavior |
|-------------|-----------------|-----------------|
| ≥ 0.40 | Direct retrieval, `[N]` citation | ✅ Already correct |
| 0.25 – 0.40 | Silently discarded, LLM falls back to general knowledge | ❌ Should trigger causal bridge inference `[AI:N,M]` |
| < 0.25 | "No sources found, rephrase" — generic dead end | ❌ Should trigger scaffolding — redirect to what exists |
| 0.00 | Same generic dead end | ❌ Scaffolding with KB entry points |

The gap between 0.25 and 0.40 is the most critical failure zone. This is where causal bridge inference *should* fire but doesn't, because those chunks are discarded before the model ever sees them.

---

## The Citation Architecture — What's Already Built

The system has a sophisticated three-tier citation policy already implemented in the provider prompts:

### Tier 1 — Direct Grounding `[N]`
Source directly supports the claim. Score ≥ threshold. No inference required. The model cites and states.

### Tier 2 — Causal Bridge Inference `[AI:N,M]`
Sources contain related material with meaningful conceptual overlap to the query. The model MAY draw explicit causal connections, clearly labeled as inference with the reasoning chain shown.

> *"The sources don't directly cover X, but do address Y which shares [specific traits] with X — suggesting [connection]."*

- Never presented as established fact
- Never used to answer a direct factual query the sources don't support
- This is the **ignition effect** — the system generates signal from adjacent material rather than failing silently

### Tier 3 — General Knowledge `[AI]`
No source connection at all. Pure training knowledge. No retrieval grounding.

### The Ignition Effect
Causal bridge inference is what makes the system useful in the gap between a perfect hit and a complete miss. It converts *"I don't have that exactly"* into *"here's what I can reasonably connect to it, and here's the chain."* Without it, users in the middle ground get an ungrounded answer with no signal about why — they don't know whether to rephrase, upload more, or whether the system actually has something relevant.

---

## Scaffolding — The Boundary Condition

**Scaffolding** is the coexistent partner to bridge inference. They are not competing features — they operate at different noise floors and protect each other's integrity.

```
Score ≥ 0.40   →  Direct retrieval      →  [N]
0.25 – 0.40    →  Bridge inference      →  [AI:N,M] — ignition fires
< 0.25         →  Scaffolding           →  Redirect to what exists
```

**What scaffolding does:**
When retrieval is below the noise floor, instead of attempting inference from nothing (which would degrade the trustworthiness of `[AI:N,M]`), the system:
1. Does a secondary broad sweep of the KB — top 3 documents by any score
2. Surfaces those documents and what they can answer
3. Guides the user toward a reformulated query that will retrieve well

**Why they coexist:**
Scaffolding draws the hard line below which inference shouldn't be attempted. This preserves the integrity of the `[AI:N,M]` label when it fires. Scaffolding is the floor; bridge inference is the middle ground. Together they give the user a complete and honest signal across the entire retrieval spectrum — nothing is opaque.

**What scaffolding is not:**
- Not disambiguation (which adds friction before retrieval)
- Not a replacement for bridge inference
- Not a generic "rephrase your question" message

---

## What L3 Looks Like for Qodex

L3 is **guided autonomy** — the system has enough self-awareness to understand its own knowledge boundaries and actively help users navigate them, without requiring the user to already know what to ask.

**The L3 contract:**
- The system knows what it knows
- It surfaces that knowledge proactively
- It signals confidence honestly
- It guides failed queries toward successful ones
- It reduces the cognitive load carried by the user

Moving from L2 to L3 does not require multi-step agents or parallel execution. It requires closing the feedback loop between retrieval quality and user guidance.

---

## Concrete Features — L2 → L3

### 1. Post-Upload Question Seeding
**What it is:** When a document is uploaded, run a fast LLM pass over its opening chunks and generate 6–8 questions it can answer well. Store on the Document model. Surface in the UI immediately.

**Why it matters:** Eliminates the "prior familiarity" requirement at the moment of ingestion. The system tells the user what is now queryable without them having to discover it through trial and error.

**Changes needed:**
- Backend: Add `entry_questions: List[str]` to `Document` model and document registry
- Backend: Background task after upload — LLM call against first 3 chunks, generate questions, store
- Frontend: "Try asking:" section in document panel; clicking auto-sends

**Complexity:** Low
**Leverage:** Highest — solves the root problem at the source

---

### 2. Weak Retrieval Scaffolding
**What it is:** When retrieval scores fall below the noise floor (< 0.25), instead of a generic dead end, the system does a secondary broad KB sweep, surfaces the top 3 documents with what they can answer, and asks the user which direction to take.

**Why it matters:** Converts dead ends into guided paths. The user understands *why* the query didn't land and what to do about it — without having to guess.

**Changes needed:**
- Backend: In `chat.py`, modify the low-score fallback path — secondary Pinecone query with no threshold, grab top 3 distinct documents; pass their filenames + sampled content to a scaffolding prompt
- Backend: Scaffolding prompt instructs AI to guide rather than answer
- Frontend: No changes — scaffolding appears inline in chat

**Complexity:** Low–Medium
**Leverage:** High — closes the most frustrating gap in the current UX

---

### 3. KB-Aware Suggested Questions
**What it is:** After each response, suggested follow-up questions are generated with awareness of what the KB can actually answer — not just what would be natural to ask in conversation.

**Why it matters:** Right now suggested questions can point toward topics the KB has no coverage on, continuing the trial-and-error loop. KB-aware questions steer the conversation toward retrievable territory.

**Changes needed:**
- Backend: In `generate_suggested_questions`, pass top source document names + sampled topics into the prompt — "prefer questions that relate to these available source documents: [list]"
- One prompt change, no structural changes

**Complexity:** Minimal
**Leverage:** Medium — improves every conversation that reaches the suggested questions phase

---

### 4. Retrieval Confidence Signal
**What it is:** A per-message grounding score (average of source scores) emitted in the `done` SSE event and displayed as a small indicator on each assistant message.

**Why it matters:** Makes the system legible. Users immediately understand when an answer is well-grounded vs. mostly general knowledge — without needing to inspect individual citations.

**Visual design:**
- Green (≥ 0.70): Well grounded
- Amber (0.40–0.70): Partially grounded
- Red (< 0.40): Mostly general knowledge

**Changes needed:**
- Backend: Calculate `avg_score` from sources after assembly; add `grounding_score: float` to `done` SSE event
- Frontend: Add `groundingScore` to Message type; render badge on ChatMessage with tooltip

**Complexity:** Low
**Leverage:** Medium — passive signal, no interaction required, builds trust over time

---

### 5. KB-Aware Dynamic Empty State
**What it is:** Replace the 9 hardcoded static chip categories with dynamically generated prompts based on what is actually in the KB. On app load, a new endpoint samples representative chunks across all documents and generates relevant starting questions per document cluster.

**Why it matters:** The current empty state is cosmetically helpful but epistemically disconnected — none of those prompts reflect what's actually in the KB. A first-time user clicking "Case studies" may get nothing relevant if the KB has no case studies.

**Changes needed:**
- Backend: New endpoint `GET /api/documents/entry-points` — samples Pinecone for representative chunks, LLM generates 3 questions per document cluster, returns grouped by document; cached with TTL, invalidated on document upload/delete
- Frontend: `useDocumentStore` fetches entry points; `ChatArea` empty state renders them dynamically; graceful fallback to static prompts if KB is empty

**Complexity:** Medium
**Leverage:** Medium — highest visibility change, most impactful for new users

---

## What L4 Looks Like (Future)

L4 is **proactive autonomy** — the system initiates, plans, and executes without being asked for each step.

These features are not immediate priorities but define the next horizon:

### Multi-Step Research Planner
User gives a high-level goal. AI breaks it into steps, executes them sequentially, synthesizes a structured output. The user is the approver, not the driver.

### Cross-Session Research Threads
Persistent projects that span multiple discussions. AI tracks what's been explored, what's unresolved, surfaces relevant past discussions when a new related query arrives.

### Document Creation Loop
AI generates new documents (lesson plans, research briefs, comparative analyses) and writes them back into the KB as first-class documents. The KB grows through use, not just through upload.

### Parallel Sub-Agents for Deep Research
For Deep mode, spawn parallel agents that each tackle a sub-question, then a synthesis agent combines them. Currently all retrieval and generation is sequential and single-threaded.

### Proactive Gap Detection
After answering, AI surfaces: *"This answer had low grounding confidence — you're missing sources on X. Consider uploading Y type of document."* Turns the system from reactive to anticipatory.

---

## Latency Considerations

L3 features (all of the above) introduce **zero perceived latency** on the primary response:
- Post-upload seeding runs in a background task — user sees the upload complete, questions appear asynchronously
- Scaffolding replaces a slow LLM fallback with a fast redirect — likely *faster* than current behavior
- KB-aware suggested questions is a prompt change — same latency as current suggested questions
- Confidence signal is a calculation on already-available data — negligible

L4 features introduce **genuine latency**:
- Sequential multi-step planning: each step waits on the previous
- Parallel sub-agents: multiplies token cost and concurrency
- Cross-session synthesis: retrieval across historical discussions adds round-trips

Mitigation at L4: streaming intermediate steps, optimistic UI showing the plan before execution, background agents that append post-response rather than blocking it.

For academic/institutional users writing research briefs and syllabi, latency tolerance is significantly higher than consumer chat — they expect to wait minutes, not seconds. L4 latency is acceptable in this context in a way it wouldn't be for a general-purpose assistant.

---

## Implementation Sequence

| Priority | Feature | Complexity | Leverage | L-Level Contribution |
|----------|---------|------------|----------|---------------------|
| 1 | Post-upload question seeding | Low | Highest | L3 — system knows what it knows |
| 2 | KB-aware suggested questions | Minimal | Medium | L3 — guides toward retrievable territory |
| 3 | Retrieval confidence signal | Low | Medium | L3 — honest self-assessment |
| 4 | Weak retrieval scaffolding | Low–Medium | High | L3 — converts dead ends into guided paths |
| 5 | KB-aware dynamic empty state | Medium | Medium | L3 — eliminates prior familiarity requirement |
| 6 | Cross-session research threads | High | High | L4 — continuity across sessions |
| 7 | Document creation loop | High | High | L4 — KB grows through use |
| 8 | Multi-step research planner | Very High | Very High | L4 — user as approver not driver |
| 9 | Parallel sub-agents | Very High | High | L4 — concurrent deep research |

---

## Summary

Qodex has a sophisticated citation and inference architecture already built — the three-tier `[N]` / `[AI:N,M]` / `[AI]` system with causal bridge inference is a genuine L3 capability in the response layer. The gap is in the **retrieval guidance layer** — the system doesn't yet surface its knowledge proactively, signal confidence honestly, or convert retrieval failures into guided paths.

The L2 → L3 transition is achievable entirely within the existing architecture. No new infrastructure, no multi-agent framework, no fundamental restructuring. It is a set of targeted additions — seeding, scaffolding, confidence signals, KB-aware prompts — that close the feedback loop between what the system knows and what the user can discover.

L3 is not about the system doing more. It is about the system being more legible about what it can do.
