# Qodex RAG Pipeline — Technical Specification

## Overview

Qodex implements a Retrieval-Augmented Generation (RAG) pipeline that connects a vector database of chunked documents to multi-provider large language models. When a user submits a question, the system converts it into a vector embedding, searches for semantically similar document chunks in Pinecone, filters and deduplicates the results through a multi-tiered relevance pipeline, and assembles them into a structured context window that is passed alongside the user's question to the selected LLM provider (OpenAI, Claude, Mistral, or Cohere).

The pipeline is governed by three configurable research modes — Quick, Enhanced, and Deep — that control how wide of a net is cast when searching for relevant sources, how aggressively low-relevance results are filtered out, and how the LLM is instructed to synthesize the retrieved material.

---

## 1. Document Ingestion & Chunking

### 1.1 Text Extraction

Documents are uploaded through the `/api/documents` endpoint and processed by the `DocumentService` (`backend/app/services/document_service.py`). Text extraction is handled by format-specific parsers:

- **PDF**: Extracted via `PyPDF2` or `pdfplumber`, preserving page boundaries
- **DOCX**: Extracted via `python-docx`, preserving paragraph structure
- **TXT/MD**: Read directly as plain text
- **HTML**: Parsed and converted to plain text, stripping tags

The extracted text is then normalized — collapsing excessive whitespace, standardizing line endings, and removing non-printable characters — before being passed to the chunking stage.

### 1.2 Chunking Strategy

The chunking algorithm is **token-aware and structure-preserving**, meaning it respects natural document boundaries (paragraphs, headings, list items) rather than splitting at arbitrary character positions.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Tokenizer | `cl100k_base` (OpenAI) | Matches the tokenizer used by `text-embedding-3-small`, ensuring accurate token counts |
| Max chunk size | 500 tokens (~3,500 characters) | Balances granularity with semantic coherence — small enough for precise retrieval, large enough to carry context |
| Overlap | 50 tokens (10%) | Ensures information at chunk boundaries is not lost; a sentence split across two chunks will appear in both |

### 1.3 Chunking Algorithm (Three Stages)

**Stage 1 — Paragraph Splitting & Type Detection**

The raw text is split on double newlines into discrete paragraphs. Each paragraph is classified into one of three structural types using heuristic rules:

| Type | Detection Rules | Example |
|------|----------------|---------|
| `heading` | All-caps text under 100 chars with ≤10 words; or numbered prefix (e.g., "1. Introduction"); or title-case with ≤8 words where ≥60% are capitalized | `CHAPTER 3: METHODOLOGY`, `1. Introduction` |
| `list` | Starts with bullet characters (`•`, `-`, `*`, `●`, `○`) or numbered patterns (`1.`, `2)`, `a.`) | `- Reduce carbon emissions by 40%` |
| `paragraph` | Default — standard prose that doesn't match heading or list patterns | Any normal sentence or block of text |

This classification is stored as `content_type` metadata on each vector, allowing downstream systems to understand the structural role of each chunk.

**Stage 2 — Accumulation with Token Budget**

Paragraphs are accumulated into chunks sequentially. The algorithm maintains a running token count and flushes the current chunk when adding the next paragraph would exceed the 500-token limit:

```
for each paragraph:
    if paragraph alone > 500 tokens:
        flush current chunk → start new chunk
        split paragraph by sentences (Stage 3)
    elif current_tokens + paragraph_tokens > 500:
        flush current chunk → start new chunk with this paragraph
    else:
        add paragraph to current chunk
flush remaining
```

This means a heading and its immediately following paragraph will typically land in the same chunk, preserving the semantic relationship between a section title and its content.

**Stage 3 — Sentence-Level Fallback**

When a single paragraph exceeds 500 tokens (common in dense academic text), it is recursively split by sentence boundaries. Sentences are accumulated into sub-chunks following the same token budget logic. The 50-token overlap is applied between these sub-chunks, ensuring no information is lost at split points.

### 1.4 Why This Chunking Strategy Matters for Retrieval

The structure-preserving approach has direct implications for retrieval quality:

- **Headings co-located with content**: A query about "methodology" will match chunks that contain both the "Methodology" heading and the opening paragraph, rather than matching a heading-only chunk with no substantive content.
- **Lists kept intact**: A query about "key findings" is more likely to retrieve a complete list of findings rather than a fragment.
- **Overlap prevents boundary losses**: If a key sentence straddles two chunks (e.g., the conclusion of one paragraph and the opening of the next), the 50-token overlap ensures it appears in both chunks, doubling its chance of being retrieved.

---

## 2. Embedding & Vector Storage

### 2.1 Embedding Model

| Property | Value |
|----------|-------|
| Model | `text-embedding-3-small` (OpenAI) |
| Dimensions | 1536 |
| Max input | 8,191 tokens per text |
| Cost | ~$0.02 per 1M tokens |

The same model is used for both indexing (embedding document chunks) and querying (embedding user questions). This is critical — using different models for indexing and querying would produce vectors in different embedding spaces, making cosine similarity meaningless.

The `text-embedding-3-small` model maps text into a 1536-dimensional vector space where semantically similar texts have high cosine similarity (close to 1.0) and dissimilar texts have low similarity (close to 0.0). The model captures semantic meaning rather than lexical overlap — "climate change mitigation strategies" and "approaches to reducing global warming" would score highly even though they share few words.

### 2.2 Batch Embedding

During document ingestion, chunks are embedded in batches using `create_embeddings_batch()` to minimize API round-trips. A document with 50 chunks is embedded in a single API call rather than 50 individual calls.

### 2.3 Pinecone Index Configuration

| Property | Value |
|----------|-------|
| Index type | Serverless |
| Cloud | AWS |
| Region | us-east-1 |
| Dimensions | 1536 |
| Similarity metric | Cosine |

Cosine similarity was chosen over Euclidean distance or dot product because it normalizes for vector magnitude, focusing purely on directional similarity. This means a short chunk ("Climate change is real.") and a long chunk (a full paragraph about climate change) can score similarly if they point in the same semantic direction, preventing length bias in retrieval.

### 2.4 Vector Metadata Schema

Each chunk is stored as a Pinecone vector with the following metadata:

| Field | Type | Example | Purpose in Retrieval |
|-------|------|---------|---------------------|
| `id` | string | `550e8400-e29b_3` | Unique identifier: `{document_uuid}_{chunk_index}` |
| `document_id` | string | `550e8400-e29b-41d4-...` | Groups chunks back to their source document for deduplication |
| `filename` | string | `climate_paper.pdf` | Used in keyword-based filename matching (Tier 3 threshold) |
| `chunk_index` | integer | `3` | Sequential position within the document; preserves reading order |
| `content` | string | (full chunk text, ≤500 tokens) | Used in keyword content matching (Tier 2 threshold) and passed to the LLM as context |
| `content_type` | string | `paragraph` | One of `heading`, `paragraph`, `list`; indicates structural role |

The `content` field is stored as metadata (not just as the vector) because Pinecone vectors only store numerical embeddings — the original text must be stored separately to be passed to the LLM. Storing it as metadata avoids a second database lookup.

The `filename` field enables the keyword-based filename matching that bypasses semantic thresholds — if a user asks about "the Wagner paper," the system can match against filenames containing "wagner" even if the chunk embeddings don't score highly for that query.

---

## 3. Retrieval Pipeline

When a user submits a question, the retrieval pipeline executes six stages before any text reaches the LLM. Each stage progressively narrows the candidate set from a broad initial fetch to a curated set of the most relevant sources.

### 3.1 Stage 1 — Optional Filename Pre-Filtering

Before querying Pinecone, the system checks whether the user's query terms match any uploaded document filenames (`chat.py:38-84`).

**How it works:**
1. All uploaded documents are listed
2. Each document's filename is tokenized (split on separators like `_`, `-`, `.`)
3. Query terms are compared against filename tokens
4. If matches are found, the Pinecone query is restricted to those document IDs using a metadata `$in` filter

**Example:**
- Query: "What does the Probst paper say about project finance?"
- Documents: `probst_curtis_financial_markets.pdf`, `energy_transition_report.pdf`
- Match: "probst" appears in filename → Pinecone query filtered to that document only

**Why this matters:** Without this pre-filter, a query about a specific document could return chunks from other documents that happen to discuss similar topics. The filename filter ensures document-specific queries hit the right target. When no filename matches are found, the filter is not applied and all documents are searched.

A boolean flag `pre_filtered` is set when this filter is active, which affects threshold behavior in Stage 4 (all chunks from pre-filtered documents bypass the similarity threshold entirely).

### 3.2 Stage 2 — Over-Fetch from Pinecone

The user's question is embedded using the same `text-embedding-3-small` model and sent to Pinecone with an **inflated top_k**:

```python
pinecone_top_k = max(research_config.top_k × 3, 20)
```

| Research Mode | top_k | Over-Fetch (Actual Chunks Retrieved) |
|---------------|-------|--------------------------------------|
| Quick | 7 | 21 |
| Enhanced | 12 | 36 |
| Deep | 16 | 48 |

**Why 3x over-fetch?** The subsequent filtering stages (threshold, deduplication) will discard many chunks. If only `top_k` chunks were fetched, the filtering could leave too few results. The 3x multiplier ensures enough candidates survive filtering to fill the mode's target.

More importantly, entity-name queries (e.g., "Gernot Wagner") tend to score low in semantic similarity because proper nouns embed poorly — they don't carry strong semantic signal compared to conceptual queries like "climate change policy." By fetching 3x more chunks, the system increases the probability that chunks mentioning "Gernot Wagner" by name appear in the candidate set at all, even if they rank lower semantically.

The minimum of 20 ensures even Quick mode (7 × 3 = 21) has a reasonable candidate pool.

### 3.3 Stage 3 — Query Term Extraction

Meaningful terms are extracted from the user's query for use in the keyword-matching tiers of Stage 4:

```python
def _extract_query_terms(query: str) -> List[str]:
    # Returns terms that are:
    # - 3+ characters long
    # - Not in the 40+ stop word list
    # - Lowercased
```

**Stop words removed include:**
- General English: `the`, `and`, `for`, `this`, `that`, `from`, `about`, `which`, `while`, `with`, etc.
- Domain-specific: `readings`, `documents`, `document`, `syllabus`, `syllabi`, `course`, `class`, `teach`

The domain-specific stop words are important — without them, a query like "What documents discuss climate?" would match every chunk's filename (since the word "documents" appears generically), defeating the keyword matching logic.

**Example:**
- Query: "What does Gernot Wagner say about carbon pricing?"
- Extracted terms: `["gernot", "wagner", "carbon", "pricing"]`

### 3.4 Stage 4 — Tiered Threshold Filtering

This is the core relevance gate. Each chunk returned from Pinecone is evaluated against a **four-tier threshold system** that combines semantic similarity (the cosine score from Pinecone) with lexical keyword signals (from Stage 3):

| Tier | Condition | Threshold | Rationale |
|------|-----------|-----------|-----------|
| **1** | Document was pre-filtered by filename (Stage 1 matched) | `0.0` (accept all) | The document is already confirmed relevant by filename match — all its chunks should be considered |
| **2** | ALL extracted query terms found in chunk content | `0.0` (accept all) | Strong keyword evidence. Requires ALL terms to prevent false positives — "gernot" + "wagner" both in text is a strong signal, but "climate" alone in text is too generic to bypass the semantic threshold |
| **3** | Any query term found in the chunk's filename | `0.20` | The chunk comes from a likely-relevant document, so a very lenient semantic threshold is applied rather than bypassing it entirely |
| **4** | No keyword match (pure semantic similarity) | **Per-mode min_score** | The default path — chunk relevance is judged entirely by cosine similarity |

**Per-mode semantic thresholds (Tier 4):**

| Research Mode | min_score | Behavior |
|---------------|-----------|----------|
| Quick | 0.40 | Strict — only chunks with strong semantic alignment pass. Prioritizes precision over recall. |
| Enhanced | 0.30 | Moderate — allows chunks with weaker semantic alignment through. Captures peripherally relevant material that may offer contrasting perspectives or supporting evidence. |
| Deep | 0.25 | Permissive — casts the widest possible net. Even tangentially related chunks are included, enabling the LLM to construct exhaustive, multi-perspective analyses. |

**Why this tiered approach?**

Pure vector search has a well-documented weakness: entity names, proper nouns, and specific technical terms often embed poorly. A query about "Gernot Wagner" might score only 0.28 against a chunk that discusses Wagner's work extensively — below the Quick threshold of 0.40. The keyword tiers (2 and 3) provide escape hatches for these cases, ensuring that lexically exact matches are not discarded by an overly strict semantic filter.

Conversely, the Tier 2 requirement that ALL query terms appear (not just any) prevents false positives. A query about "carbon pricing in Wagner's framework" has terms `["carbon", "pricing", "wagner", "framework"]`. A chunk that mentions "carbon" but not "wagner" would not bypass the semantic threshold — it would fall through to Tier 4 and need to meet the cosine similarity bar on its own merits.

### 3.5 Stage 5 — Deduplication by Document

Chunks that survive the threshold filter are grouped by their `document_id` metadata field. This deduplication serves two purposes:

1. **Citation consolidation**: All chunks from the same document share a single citation number (e.g., `[1]`). Without this, a document with 5 matching chunks would consume 5 citation slots, leaving fewer slots for other documents and reducing source diversity.

2. **Context richness**: Although chunks are deduplicated at the citation level, ALL surviving chunks from a document are included in the LLM's context window. A document with 3 matching chunks contributes 3 chunks of text under a single `[Source N]` label, giving the LLM more material to synthesize from that source.

For each document group, the system tracks:
- **All chunks**: Concatenated into the context window
- **Best score**: The highest cosine similarity among the document's chunks (used for sorting)
- **Best chunk**: The chunk with the highest score (used for the preview displayed in the UI)
- **Filename**: Displayed alongside the citation number

### 3.6 Stage 6 — Capping to Research Mode top_k

The deduplicated document groups are sorted by best chunk score (descending) and capped to the research mode's `top_k`:

| Research Mode | Maximum Documents in Final Output |
|---------------|-----------------------------------|
| Quick | 7 |
| Enhanced | 12 |
| Deep | 16 |

This is where the "fishing net" metaphor completes. The net was cast wide in Stage 2 (3x over-fetch) and filtered in Stage 4 (per-mode thresholds), but the final output is always bounded. A user will never see more than `top_k` sources, but may see fewer if not enough chunks passed the threshold filter.

**Example flow for Enhanced mode:**
1. 36 chunks fetched from Pinecone (12 × 3)
2. 22 chunks pass the 0.30 threshold
3. 22 chunks collapse into 9 unique documents after deduplication
4. Top 9 documents returned (under the cap of 12)

---

## 4. Context Assembly

### 4.1 Context Format

The surviving documents are assembled into a structured context string that is prepended to the LLM's system prompt:

```
[Source 1 - climate_paper.pdf]:
(chunk 1 content from this document)

(chunk 2 content from this document)

---

[Source 2 - energy_report.pdf]:
(chunk 3 content from this document)

---

[Source 3 - policy_brief.pdf]:
(chunk 4 content from this document)

(chunk 5 content from this document)
```

Each source is labeled with a citation number and the original filename. Chunks within a source are joined by double newlines. Sources are separated by `---` dividers.

### 4.2 Citation Marker Sanitization

A critical preprocessing step strips existing citation markers from the source text:

```python
combined_content = _CITATION_RE.sub('', combined_content)  # removes [48], [52], etc.
combined_content = re.sub(r'  +', ' ', combined_content).strip()
```

Academic papers often contain their own reference numbers (e.g., "as shown in [48]"). If left in place, the LLM would confuse these with the system's `[Source N]` citation numbering, potentially citing `[48]` when it means `[Source 1]`. Stripping them prevents this cross-contamination.

### 4.3 No-Results Fallback

When no chunks pass the threshold filter, the context explicitly instructs the LLM not to fabricate:

```
[No relevant sources found in the knowledge base for this query.]

Guidelines:
- Do NOT fabricate or guess content that might be in the documents
- Let the user know that no matching documents were found
- Suggest they rephrase their question or check which documents are uploaded
- You may still answer from general knowledge, but clearly state you are doing so
```

This prevents hallucination — without this guard, the LLM might generate plausible-sounding but fabricated "citations" from documents it never saw.

### 4.4 Attachment Context

In addition to Pinecone-sourced RAG context, the system supports conversation-scoped file attachments. Attachment text is prepended to the Pinecone context, giving the LLM access to both user-uploaded files and the indexed knowledge base. Attachments are not indexed in Pinecone — they exist only for the duration of the conversation.

---

## 5. System Prompt Construction

The final prompt sent to the LLM is assembled from four layers:

### 5.1 Layer 1 — Base Citation Instructions

All responses include a base system prompt that instructs the LLM on citation behavior:

```
Use the following context to help answer the user's question.
Each source is numbered. When you reference information from a specific source,
add a citation marker [N] immediately after the relevant statement, where N is the source number.

[Sources for reference]
{context from Stage 4}

Guidelines:
- Add [N] citations inline where information comes from source N
- Multiple sources can be cited together like [1][2]
- Be precise — cite at the claim level, not just at the end of paragraphs
- Natural placement — citations should feel unobtrusive

Now provide an accurate and helpful response with inline citations.
```

### 5.2 Layer 2 — Research Mode Prompt Enhancement

The research mode's `prompt_enhancement` is appended to the system prompt, controlling the depth and format of the response:

**Quick:**
```
## Research Depth: Quick
Provide a focused, efficient response:
- Prioritize the most relevant and authoritative sources
- Give direct answers with key supporting evidence
- Keep synthesis concise - focus on main findings
- Use 2-4 citations for the most important claims
```

**Enhanced:**
```
Provide a thorough, well-structured response that draws from as many sources as possible.
Go beyond the surface — include supporting evidence, relevant context, and connections
between sources. Note where sources agree or diverge. Synthesize across sources to
identify patterns and build a comprehensive picture.

Use structured formatting to make the response easy to scan:
- Use bullet points or numbered lists for key findings, comparisons, or takeaways
- Use tables when comparing data, frameworks, or options across multiple dimensions
- Use bold text for important terms or conclusions
- Break the response into clear sections with descriptive subheadings

Use 4-8 citations distributed across your response.
Draw from the broadest range of provided sources — do not rely on just 2-3.
```

**Deep:**
```
Provide an exhaustive, scholarly-level response. This should read like a thorough research
briefing. Conduct a comprehensive review across all available sources. Present nuanced
analysis with multiple perspectives and competing viewpoints. Identify methodological
approaches, strengths, and limitations in the source material. Synthesize findings into
coherent themes, noting gaps and areas of uncertainty. Discuss implications for policy,
practice, or further research where relevant. Use extensive citations (8+) to ground
every major claim. Structure your response with clear thematic sections. Aim for maximum
depth and rigor.
```

### 5.3 Layer 3 — Intent-Specific Prompt

The intent classifier (`backend/app/services/intent_classifier.py`) analyzes the user's query using regex pattern matching to detect specific intent types (comparison, summary, explanation, timeline, etc.). Each intent type appends additional formatting instructions. For example, a comparison query adds instructions to use tables and side-by-side analysis.

The fallback "generalist" intent provides general-purpose formatting guidance including bullet points, tables, and bold text for key findings.

### 5.4 Layer 4 — Conversation History

The last 20 messages from the conversation are included for continuity, but assistant messages are **sanitized** to prevent stale source contamination:

- Assistant messages are truncated to 300 characters
- Old citation markers (e.g., `[1]`, `[2]`) are stripped from assistant messages
- User messages are kept intact

This prevents a dangerous failure mode: if full prior assistant responses were included, the LLM might reference facts from previous turns' sources using the current turn's citation numbers, creating misattributed citations.

---

## 6. How Research Modes Shape Output

The three research modes create fundamentally different retrieval and generation behaviors by tuning parameters across every stage of the pipeline:

| Dimension | Quick | Enhanced | Deep |
|-----------|-------|----------|------|
| **Net size** (chunks fetched from Pinecone) | 21 | 36 | 48 |
| **Semantic threshold** (Tier 4 min_score) | 0.40 | 0.30 | 0.25 |
| **Max sources in context** | 7 | 12 | 16 |
| **Typical sources returned** | 3–7 | 5–12 | 8–16 |
| **Context window usage** | Low | Medium | High |
| **Citation target** | 2–4 | 4–8 | 8+ |
| **Response format** | Concise prose | Structured (tables, bullets, subheadings) | Scholarly (thematic sections, competing viewpoints) |
| **Ideal use case** | Quick fact lookup, simple questions | Research synthesis, comparing perspectives | Literature review, comprehensive briefing |

**Quick** optimizes for precision and speed. The high semantic threshold (0.40) ensures only strongly relevant chunks pass, producing focused answers grounded in the best-matching sources. The prompt instructs brevity — direct answers with key evidence, no extraneous detail.

**Enhanced** trades precision for coverage. The lower threshold (0.30) and wider net (36 chunks) pull in peripherally relevant documents that may offer contrasting perspectives, supporting evidence, or contextual background. The prompt explicitly requests structured formatting (tables, bullet points, subheadings) and cross-source synthesis, encouraging the LLM to identify patterns and disagreements across sources rather than summarizing each in isolation.

**Deep** maximizes recall at the expense of precision. The lowest threshold (0.25) and largest net (48 chunks) capture even tangentially related sources. The prompt requests scholarly rigor — competing viewpoints, methodological critique, thematic organization, implications for practice — mimicking the depth of a literature review or research briefing. The 8+ citation target ensures the response is thoroughly grounded in source material.

---

## 7. Multi-Provider LLM Support

The assembled prompt (context + research mode instructions + intent prompt + conversation history) is sent to the user's selected LLM provider:

| Provider | Flagship Model | Question Generation Model |
|----------|---------------|--------------------------|
| OpenAI | `gpt-4.1` | `gpt-4.1-mini` |
| Anthropic | `claude-sonnet-4-5-20250929` | `claude-haiku-4-5-20251001` |
| Mistral | `mistral-large-latest` | `mistral-large-latest` |
| Cohere | `command-a-03-2025` | `command-a-03-2025` |

All providers implement the same `BaseProvider` interface with `stream_completion()` for SSE-streamed responses and `generate_suggested_questions()` for follow-up question generation. The provider abstraction ensures the RAG pipeline is model-agnostic — the same retrieval, filtering, and context assembly runs regardless of which LLM generates the final response.

Responses are streamed via Server-Sent Events (SSE) with the following event types:
- `discussion_title` — auto-generated title for new conversations
- `sources` — the list of retrieved sources with scores and previews
- `intent` — the classified intent label (e.g., "Generalist", "Comparison")
- `chunk` — individual text chunks of the streamed response
- `suggested_questions` — follow-up questions generated after the response completes
- `done` — signals the end of the stream

---

## 8. Summary Pipeline Diagram

```
User Question
    │
    ▼
┌──────────────────────────────────┐
│  1. Filename Pre-Filter          │  Match query terms against document filenames
│     (Optional — restricts        │  If matched → set pre_filtered = true
│      Pinecone to specific docs)  │  If not → search all documents
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  2. Embed Query & Over-Fetch     │  text-embedding-3-small → 1536-dim vector
│     from Pinecone                │  Fetch top_k × 3 chunks (min 20)
│                                  │  Quick: 21 │ Enhanced: 36 │ Deep: 48
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  3. Extract Query Terms          │  Remove stop words, keep 3+ char terms
│                                  │  Used for keyword matching in Stage 4
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  4. Tiered Threshold Filtering   │  Tier 1: Pre-filtered → accept all (0.0)
│                                  │  Tier 2: All terms in content → accept (0.0)
│                                  │  Tier 3: Term in filename → lenient (0.20)
│                                  │  Tier 4: Pure semantic → per-mode threshold
│                                  │    Quick: 0.40 │ Enhanced: 0.30 │ Deep: 0.25
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  5. Deduplicate by Document      │  Group chunks by document_id
│                                  │  Track best score, all chunks kept in context
│                                  │  One citation number per document
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  6. Cap to top_k Documents       │  Sort by best score (descending)
│                                  │  Quick: 7 │ Enhanced: 12 │ Deep: 16
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Context Assembly                │  [Source N - filename]: chunk text...
│  + Citation Sanitization         │  Strip old [48]-style markers
│  + Research Mode Prompt          │  Append mode-specific instructions
│  + Intent Prompt                 │  Append intent-specific formatting
│  + Conversation History          │  Last 20 messages (assistant truncated)
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  LLM Provider                    │  OpenAI / Claude / Mistral / Cohere
│  (SSE Streaming)                 │  Streamed response with inline [N] citations
└──────────────────────────────────┘
```
