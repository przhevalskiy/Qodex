from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid
import time
import json
import asyncio
import logging
import re

from app.core.config import get_settings
from app.core.research_modes import (
    ResearchMode,
    get_research_mode_config,
    list_research_modes as get_all_research_modes,
    DEFAULT_RESEARCH_MODE,
)
from app.models import Message, MessageRole, DocumentSource
from app.providers import ProviderRegistry
from app.services.document_service import get_document_service
from app.services.attachment_service import get_attachment_service
from app.services.discussion_service import get_discussion_service
from app.utils.streaming import create_sse_response, format_sse_event
from app.services.intent_classifier import classify_intent, INTENT_LOOKUP, CONTINUATION_INSTRUCTION
from app.auth import get_current_user_id
from app.utils.course_utils import extract_course_title_from_content

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

_CITATION_RE = re.compile(r'\[\d+\]')

# Fallback minimum cosine similarity (used only if research config lacks min_score)
_MIN_SCORE = 0.40

# Matches bullet symbols, course-code prefixes (L1, L2 …), page markers, etc.
_ARTIFACT_RE = re.compile(r'[●•▪▸◦·]\s*|^\s*[A-Z]\d+\s+', re.MULTILINE)


def _make_chunk_preview(text: str, max_len: int = 200) -> str:
    """Return a clean, sentence-complete preview of a raw chunk string."""
    # Strip bullet/course-code artifacts and normalize whitespace
    cleaned = _ARTIFACT_RE.sub('', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # Find the first complete sentence
    match = re.search(r'[.!?](\s|$)', cleaned)
    if match:
        preview = cleaned[:match.start() + 1].strip()
    else:
        # No sentence boundary — cut on a word boundary
        preview = cleaned[:max_len].rsplit(' ', 1)[0] if len(cleaned) > max_len else cleaned

    # Hard cap
    if len(preview) > max_len:
        preview = preview[:max_len].rsplit(' ', 1)[0] + '…'

    return preview


def _extract_query_terms(query: str) -> List[str]:
    """Extract meaningful terms from a query for entity-content matching.

    Returns non-stop-word terms that represent the semantic "payload" of the
    query — person names, topics, material types.  These are used to boost
    Pinecone results whose chunk content mentions the same terms.
    """
    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can",
        "had", "her", "was", "one", "our", "out", "has", "his", "how",
        "its", "may", "new", "now", "old", "see", "way", "who", "did",
        "get", "let", "say", "she", "too", "use", "what", "when", "where",
        "which", "while", "with", "this", "that", "from", "about", "some",
        "them", "then", "than", "into", "over", "such", "list", "give",
        "tell", "show", "find", "does", "other", "more", "also",
    }
    return [
        w for w in re.findall(r'[a-z]+', query.lower())
        if len(w) >= 3 and w not in stop_words
    ]


def _compute_entity_boost(content_lower: str, query_terms: List[str]) -> float:
    """Boost score for chunks that contain query terms in their content.

    When a user asks about a specific person (e.g., "bruce usher's readings"),
    the embedding similarity is weak because embeddings prioritize topical
    similarity over entity-name matching.  But the entity name IS in the chunk
    text (as instructor/author).  This function detects that overlap and returns
    a score boost so entity-matched results rank above topically-similar but
    entity-irrelevant results.

    Boost tiers:
      - ALL query terms found  → +0.30  (strong entity match)
      - ≥50% of terms found   → +0.15  (partial entity match)
      - <50% but at least one  → +0.05  (weak signal)
      - No matches             → 0.0
    """
    if not query_terms:
        return 0.0

    matches = sum(1 for t in query_terms if t in content_lower)
    if matches == 0:
        return 0.0

    ratio = matches / len(query_terms)

    if ratio >= 1.0:
        return 0.30
    elif ratio >= 0.5:
        return 0.15
    else:
        return 0.05


def _extract_person_names(query: str) -> List[str]:
    """Extract instructor names by generating n-grams and validating against index.

    Strategy:
    1. Tokenize query into words (alphanumeric only)
    2. Generate all 2-word and 3-word sliding windows (n-grams)
    3. Normalize each n-gram (lowercase)
    4. Check if it exists in the instructor index (with possessive handling)
    5. Return all validated matches

    Examples:
    - "what does bruce usher teach" → ["bruce usher"]
    - "Bruce Usher readings" → ["bruce usher"]
    - "bruce ushers readings" → ["bruce usher"] (possessive handling)
    - "compare Harrison Hong and Sheila Foster" → ["harrison hong", "sheila foster"]
    - "what is ESG" → []
    """
    def _check_index(ngram: str, instructor_index: dict) -> str:
        """Check if ngram exists in index, trying possessive form if needed.

        Returns the canonical form from the index if found, None otherwise.
        """
        # Try exact match first
        if ngram in instructor_index:
            return ngram

        # Try removing possessive 's' from last word (but not 'ss' to preserve names like "James")
        words = ngram.split()
        if words[-1].endswith('s') and not words[-1].endswith('ss') and len(words[-1]) > 1:
            possessive_removed = ' '.join(words[:-1] + [words[-1][:-1]])
            if possessive_removed in instructor_index:
                return possessive_removed

        return None

    # Tokenize into words (alphanumeric only)
    tokens = re.findall(r'[a-zA-Z]+', query)
    if len(tokens) < 2:
        return []

    # Get instructor index from document service
    doc_service = get_document_service()
    instructor_index = doc_service.instructor_index
    if not instructor_index:
        return []

    found_names = set()
    used_positions = set()  # Track which positions are part of a match

    # Try 3-word combinations first (more specific matches)
    for i in range(len(tokens) - 2):
        if i in used_positions or i+1 in used_positions or i+2 in used_positions:
            continue
        ngram = ' '.join(tokens[i:i+3]).lower()
        canonical = _check_index(ngram, instructor_index)
        if canonical:
            found_names.add(canonical)
            used_positions.update([i, i+1, i+2])

    # Try 2-word combinations
    for i in range(len(tokens) - 1):
        if i in used_positions or i+1 in used_positions:
            continue
        ngram = ' '.join(tokens[i:i+2]).lower()
        canonical = _check_index(ngram, instructor_index)
        if canonical:
            found_names.add(canonical)
            used_positions.update([i, i+1])

    return list(found_names)


def _extract_course_name(query: str) -> Optional[str]:
    """Extract a specific course title from a query if one is referenced.

    Looks for patterns like:
    - "find <Course Title> and prepare/help/summarize/..."
    - "prepare me for <Course Title> week/class/session"

    The task-verb anchor prevents matching the first incidental "and" inside
    the course title itself (e.g. "Global Institutions and the Architecture...").

    Returns the extracted course title string, or None if no specific course
    is detected.  The title is returned in its original casing.
    """
    task_verbs = r'(?:prepare|help|tell|show|explain|give|summarize|map|create|find|get)'

    # Pattern: "find <Title> and <task-verb>" — anchors on the task verb so the
    # greedy match captures the full title including any "and" within it.
    m = re.search(
        r'\bfind\s+(.+?)\s+and\s+' + task_verbs + r'\b',
        query, re.IGNORECASE
    )
    if m:
        candidate = m.group(1).strip()
        words = candidate.split()
        if len(words) >= 3 and words[0][0].isupper():
            return candidate

    # Pattern: "for <Title> week|class|course|session"
    m = re.search(
        r'\bfor\s+([A-Z][^,\.?!]+?)\s+(?:week|class|course|session)\b',
        query, re.IGNORECASE
    )
    if m:
        candidate = m.group(1).strip()
        if len(candidate.split()) >= 3:
            return candidate

    return None


def _course_found_in_chunks(course_name: str, doc_groups: List) -> bool:
    """Check whether retrieved chunks contain the queried course title.

    Uses n-gram phrase matching rather than individual term matching.
    Generic topic words like "climate" or "finance" appear in every syllabus,
    so single-term checks produce false positives.  Instead, this function
    builds 4-word sliding windows from the course title and checks whether
    any such phrase appears verbatim in any retrieved chunk.  A specific
    4-gram like "Architecture of Global Climate" is unlikely to appear in a
    different course's material.

    Returns True if the course appears to be present, False if it looks absent.
    """
    title_words = re.findall(r'[a-zA-Z]+', course_name)
    if len(title_words) < 4:
        return True  # Title too short to discriminate reliably — don't false-positive

    # Build 4-word n-grams from the course title (lowercased for comparison)
    ngram_size = 4
    title_ngrams = [
        " ".join(title_words[i:i + ngram_size]).lower()
        for i in range(len(title_words) - ngram_size + 1)
    ]

    for _, group in doc_groups:
        combined = " ".join(group["chunks"]).lower()
        # Normalize whitespace in combined content for reliable substring search
        combined = re.sub(r'\s+', ' ', combined)
        if any(ngram in combined for ngram in title_ngrams):
            return True

    return False


def _sanitize_history_messages(messages: List[Message]) -> List[Message]:
    """Strip stale source facts from old assistant messages.

    Each turn gets its own Pinecone results with fresh citation numbers.
    If we send full old assistant responses into the context window, the AI
    conflates facts from previous sources with the current ones — causing
    hallucinations (e.g. wrong affiliations, misattributed claims).

    This function truncates assistant messages so the AI sees enough for
    conversational continuity but not enough to carry stale facts forward.
    User messages are kept intact.
    """
    MAX_CHARS = 300
    sanitized = []
    for msg in messages:
        if msg.role == MessageRole.ASSISTANT:
            # Strip old citation markers — they reference different sources
            content = _CITATION_RE.sub('', msg.content).strip()
            # Collapse runs of whitespace left by stripped citations
            content = re.sub(r'  +', ' ', content)
            if len(content) > MAX_CHARS:
                content = content[:MAX_CHARS].rsplit(' ', 1)[0] + " [earlier response truncated]"
            sanitized.append(Message(
                id=msg.id,
                content=content,
                role=msg.role,
                timestamp=msg.timestamp,
            ))
        else:
            sanitized.append(msg)
    return sanitized


async def _rewrite_search_query(
    current_message: str,
    context_messages: List[Message],
    settings,
) -> str:
    """Rewrite a follow-up into a standalone search query using conversation context.

    For the first message in a conversation (no prior user messages),
    returns the message unchanged.  For follow-ups, uses a fast LLM to
    resolve pronouns and implicit references so Pinecone retrieves the
    right documents.
    """
    # Only rewrite when there is prior conversation context
    prior_user_msgs = [m for m in context_messages if m.role == MessageRole.USER]
    if not prior_user_msgs:
        return current_message

    # Require Mistral key for the fast rewrite model
    if not settings.mistral_api_key:
        return current_message

    try:
        from mistralai import Mistral

        client = Mistral(api_key=settings.mistral_api_key)

        # Compact history: last few user messages (excluding the current one,
        # which was already added to the DB before context_messages was fetched)
        recent = [m.content for m in prior_user_msgs[-3:]]
        history_lines = "\n".join(f"- {msg}" for msg in recent)

        response = await client.chat.complete_async(
            model="mistral-small-latest",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a search query rewriter. Given prior questions and a follow-up, "
                        "rewrite the follow-up into a standalone search query.\n\n"
                        "Rules:\n"
                        "- Resolve pronouns (he, she, it, they, this, that) using context\n"
                        "- If the follow-up already names a specific person/topic, return it unchanged\n"
                        "- If the follow-up is a completely new topic, return it unchanged\n"
                        "- Keep the rewritten query concise and natural\n"
                        "- Return ONLY the rewritten query, nothing else"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Previous questions:\n{history_lines}\n\n"
                        f"Follow-up: {current_message}\n\n"
                        "Rewritten query:"
                    ),
                },
            ],
            temperature=0.0,
            max_tokens=100,
        )

        rewritten = response.choices[0].message.content.strip().strip('"')
        if rewritten:
            logger.info(f"Query rewritten: '{current_message}' -> '{rewritten}'")
            return rewritten
        return current_message
    except Exception as e:
        logger.warning(f"Query rewrite failed, using original: {e}")
        return current_message


class ChatRequest(BaseModel):
    """Request model for chat endpoint."""
    discussion_id: str
    message: str
    provider: str  # mistral, claude
    document_ids: Optional[List[str]] = None
    attachment_ids: Optional[List[str]] = None  # conversation-scoped attachments
    temperature: float = 0.1
    max_tokens: int = 8192
    research_mode: ResearchMode = DEFAULT_RESEARCH_MODE
    force_truncate: bool = False  # DEV ONLY: cap max_tokens to 150 to test truncation detection


class ChatResponse(BaseModel):
    """Response model for non-streaming chat."""
    content: str
    provider: str
    response_time_ms: int


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Stream a chat response using SSE.

    This endpoint streams the AI response in chunks, formatted as SSE events.
    """
    settings = get_settings()
    disc_service = get_discussion_service()

    # Validate discussion exists and belongs to user
    discussion = disc_service.get_discussion(request.discussion_id, user_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get provider configuration
    provider_configs = {
        "mistral": (settings.mistral_api_key, settings.mistral_model),
        "claude": (settings.anthropic_api_key, settings.anthropic_model),
    }

    valid_providers = set(provider_configs.keys()) | {"auto"}
    if request.provider not in valid_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider: {request.provider}. Valid providers: {sorted(valid_providers)}"
        )

    # For explicit providers, validate key upfront. For "auto", defer until after intent classification.
    if request.provider != "auto":
        api_key, model = provider_configs[request.provider]
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail=f"API key not configured for provider: {request.provider}"
            )
    else:
        api_key, model = None, None  # resolved after intent classification

    # Add user message to discussion
    user_message = Message(
        id=str(uuid.uuid4()),
        content=request.message,
        role=MessageRole.USER,
        timestamp=datetime.utcnow()
    )
    disc_service.add_message(request.discussion_id, user_message)

    # Auto-generate title from first user message if still default
    title_updated = False
    if discussion.title == "New Chat":
        new_title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        disc_service.update_discussion(request.discussion_id, user_id, title=new_title)
        discussion.title = new_title
        title_updated = True

    # Check if the discussion has attachments (needed for intent routing)
    attachment_service = get_attachment_service()
    has_attachments = len(attachment_service.list_attachments(request.discussion_id)) > 0

    # Classify user intent for structured output (zero-latency regex matching)
    # When attachments exist, also determines if Pinecone should be queried
    intent_result = classify_intent(request.message, has_attachments=has_attachments)

    # Continuation resolution:
    # If the user is resuming a truncated response, find the last assistant message,
    # recover its primary intent, and build a combined prompt:
    #   CONTINUATION_INSTRUCTION + primary intent's prompt_suffix
    # Invariant: if no prior assistant message exists, or it has no intent field,
    # fall back to generalist silently — never error.
    primary_intent_key: Optional[str] = None
    if intent_result.intent == "continuation":
        raw_history = disc_service.get_context_messages(request.discussion_id, limit=20)
        last_assistant = next(
            (m for m in reversed(raw_history) if m.role == MessageRole.ASSISTANT),
            None,
        )
        if last_assistant and last_assistant.intent and last_assistant.intent in INTENT_LOOKUP:
            primary_intent_key = last_assistant.intent
            primary_defn = INTENT_LOOKUP[primary_intent_key]
            # Inherit provider and token budget from primary intent
            if intent_result.preferred_provider is None:
                intent_result.preferred_provider = primary_defn.get("preferred_provider")
            if not intent_result.max_tokens:
                intent_result.max_tokens = primary_defn.get("max_tokens") or 12000
            # Use ONLY the continuation instruction — appending the primary intent's
            # prompt_suffix causes the model to restart the full response structure
            # instead of picking up from the exact cut-off point.
            intent_result.prompt_suffix = CONTINUATION_INSTRUCTION
        else:
            # No recoverable prior intent — treat as generalist continuation
            primary_intent_key = "generalist"
            intent_result.prompt_suffix = CONTINUATION_INSTRUCTION
            intent_result.max_tokens = intent_result.max_tokens or 12000

    # Resolve effective provider:
    # - "auto": use intent's preferred_provider if its key is configured, else fall back to first configured
    # - explicit (mistral/claude): always use the user's selection, no override
    if request.provider == "auto":
        preferred = intent_result.preferred_provider
        if preferred and provider_configs.get(preferred, (None, None))[0]:
            effective_provider = preferred
        else:
            # Fall back to first configured provider
            effective_provider = next(
                (name for name, (key, _) in provider_configs.items() if key), None
            )
        if not effective_provider:
            raise HTTPException(status_code=400, detail="No AI provider is configured")
        api_key, model = provider_configs[effective_provider]
        logger.info(f"Auto mode: intent '{intent_result.intent}' → provider '{effective_provider}'")
    else:
        effective_provider = request.provider

    # Get research mode configuration
    research_config = get_research_mode_config(request.research_mode)

    # Get conversation context early — needed for query rewriting AND
    # later passed to the provider.  Sanitized to prevent stale source
    # facts from bleeding into the current RAG turn.
    raw_messages = disc_service.get_context_messages(request.discussion_id, limit=20)
    context_messages = _sanitize_history_messages(raw_messages)

    # For continuation: replace the sanitized last assistant message with its full
    # raw content so the model can see exactly where it left off and resume from there.
    # Without this, the 300-char sanitization cap hides the cut-off point.
    if intent_result.intent == "continuation":
        last_raw_assistant = next(
            (m for m in reversed(raw_messages) if m.role == MessageRole.ASSISTANT),
            None,
        )
        if last_raw_assistant:
            context_messages = [
                last_raw_assistant if (m.role == MessageRole.ASSISTANT and m.id == last_raw_assistant.id)
                else m
                for m in context_messages
            ]

    # Rewrite the follow-up query so Pinecone retrieves documents relevant
    # to the conversational context (resolves pronouns, implicit refs).
    search_query = await _rewrite_search_query(
        request.message, context_messages, settings
    )

    # Start RAG search in parallel with provider setup — but only when the
    # intent classifier says the knowledge base is needed.
    doc_service = get_document_service()
    rag_task = None
    search_doc_ids = request.document_ids if request.document_ids else None
    if intent_result.use_knowledge_base:
        # Entity-first filtering: detect instructor names and restrict search
        # to their documents BEFORE semantic search.  This solves the problem
        # where Pinecone's semantic search returns topically similar but entity-
        # irrelevant documents (e.g., other professors' syllabi when asking about
        # "Bruce Usher's readings").
        if not search_doc_ids:
            person_names = _extract_person_names(search_query)
            if person_names:
                # Try to find documents by the first detected person (primary entity)
                instructor_docs = doc_service.get_documents_by_instructor(person_names[0])
                if instructor_docs:
                    logger.info(f"Entity-filtered search: detected {person_names}, "
                               f"restricting to {len(instructor_docs)} docs by {person_names[0]}")
                    search_doc_ids = instructor_docs
                else:
                    logger.debug(f"Instructor '{person_names[0]}' not found in index, using full corpus")
            else:
                logger.debug(f"No person names detected in query: {search_query}")

        # Over-fetch from Pinecone so entity-boosted re-ranking has enough
        # candidates.  Entity-name queries ("bruce usher") score low
        # semantically; retrieving more chunks increases the chance the
        # relevant ones appear at all.  The re-ranking + threshold logic
        # below trims the set back down before building context.
        pinecone_top_k = max(research_config.top_k * 3, 20)

        rag_task = asyncio.create_task(
            doc_service.pinecone.search_documents(
                query=search_query,
                top_k=pinecone_top_k,
                document_ids=search_doc_ids,  # Now includes entity-filtered IDs
            )
        )

    # Get the provider (runs in parallel with RAG search)
    try:
        provider = ProviderRegistry.get_provider(
            name=effective_provider,
            api_key=api_key,
            model=model
        )
    except ValueError as e:
        if rag_task is not None:
            rag_task.cancel()  # Cancel pending RAG if provider fails
        raise HTTPException(status_code=400, detail=str(e))

    # Now await the RAG results (if Pinecone was queried)
    context = None
    sources: List[DocumentSource] = []
    pre_filtered = search_doc_ids is not None
    if rag_task is not None:
        try:
            search_results = await rag_task

            # Extract query terms for entity-content boosting
            query_terms = _extract_query_terms(search_query)

            # Deduplicate by document: group chunks, assign ONE citation per document.
            # All chunks still go into context (for AI thoroughness), but share a citation number.
            # The source entry uses the highest effective score and best chunk from each document.
            doc_groups: dict = {}  # doc_id -> { chunks, best_score, best_chunk_id, best_preview, filename }
            min_score = getattr(research_config, 'min_score', _MIN_SCORE)

            for result in search_results:
                metadata = result.get("metadata")
                score = result.get("score", 0)

                if not metadata:
                    continue

                content_lower = metadata.get("content", "").lower()

                # Entity-aware re-ranking: boost chunks whose content
                # mentions the queried entity (person name, topic, etc.)
                # so they rank above topically-similar but entity-irrelevant
                # results.  e.g. a chunk at cosine 0.33 that mentions
                # "Bruce Usher" gets boosted to 0.63, outranking an
                # unrelated syllabus at 0.48.
                entity_boost = _compute_entity_boost(content_lower, query_terms)
                effective_score = score + entity_boost

                # Threshold: entity-matched chunks always pass;
                # pre-filtered (caller-supplied doc_ids) always pass;
                # everything else must meet the research-mode min_score.
                if pre_filtered:
                    threshold = 0.0
                elif entity_boost > 0:
                    threshold = 0.0
                else:
                    threshold = min_score

                if effective_score > threshold:
                    doc_id = metadata.get("document_id", result["id"])
                    chunk_id = result.get("id")
                    filename = metadata.get("filename", "Unknown")
                    content = metadata.get("content", "")

                    if doc_id not in doc_groups:
                        doc_groups[doc_id] = {
                            "filename": filename,
                            "chunks": [],
                            "best_score": effective_score,
                            "best_chunk_id": chunk_id,
                            "best_preview": _make_chunk_preview(content),
                        }

                    group = doc_groups[doc_id]
                    group["chunks"].append(content)
                    if effective_score > group["best_score"]:
                        group["best_score"] = effective_score
                        group["best_chunk_id"] = chunk_id
                        group["best_preview"] = _make_chunk_preview(content)

            # Deduplicate by filename: if the same physical file was ingested
            # multiple times (e.g. via --force without clearing Pinecone first),
            # it will appear under different document_ids.  Merge those entries,
            # keeping the highest-score group for each unique filename.
            seen_filenames: dict = {}  # filename -> doc_id of best group
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

            # Cap to research_config.top_k documents (over-fetch was for
            # casting a wider net; now trim back to the requested depth).
            sorted_groups = sorted(
                doc_groups.items(),
                key=lambda item: item[1]["best_score"],
                reverse=True,
            )[:research_config.top_k]

            # Build context and sources from deduplicated groups
            context_parts = []
            citation_number = 1

            for doc_id, group in sorted_groups:
                combined_content = "\n\n".join(group["chunks"])
                # Strip bracketed reference numbers from source text (e.g. [48], [52])
                # so the AI doesn't confuse them with our [Source N] citation numbers
                combined_content = _CITATION_RE.sub('', combined_content)
                combined_content = re.sub(r'  +', ' ', combined_content).strip()
                context_parts.append(f"[Source {citation_number} - {group['filename']}]:\n{combined_content}")

                sources.append(DocumentSource(
                    id=doc_id,
                    filename=group["filename"],
                    score=round(group["best_score"], 3),
                    chunk_preview=group["best_preview"],
                    citation_number=citation_number,
                    chunk_id=group["best_chunk_id"],
                ))
                citation_number += 1

            if context_parts:
                context = "\n\n---\n\n".join(context_parts)

                # Course mismatch check: if the user asked about a specific named
                # course but none of the retrieved chunks contain that course title,
                # the course isn't in the dataset.  Surface this explicitly rather
                # than silently synthesizing from unrelated material.
                detected_course = _extract_course_name(request.message)
                course_not_found_response = None
                if detected_course and not _course_found_in_chunks(detected_course, sorted_groups):
                    course_not_found_response = detected_course
                    # Force Claude for this response — it follows stop instructions reliably
                    effective_provider = "claude"
                    claude_key, claude_model = provider_configs.get("claude", (None, None))
                    if claude_key:
                        provider = ProviderRegistry.get_provider("claude", claude_key, claude_model)
                    context = (
                        f"[SYSTEM NOTE: The user asked about '{detected_course}' "
                        f"but this course was not found in the dataset.]\n\n"
                        "STRICT RESPONSE RULES — follow exactly:\n"
                        "1. In one sentence, tell the user the specific course was not found\n"
                        f"2. List the available related courses as bullets, citing each with its [Source N] number\n"
                        "3. Ask ONE brief question: would they like help using one of these instead?\n"
                        "4. Your response ends immediately after that question — nothing else\n"
                        "5. Do NOT add notes, summaries, outlines, readings, or any analysis"
                    )
            else:
                # Knowledge base was queried but nothing scored high enough.
                # Tell the AI explicitly so it doesn't fabricate from thin air.
                context = (
                    "[No relevant sources found in the knowledge base for this query.]\n\n"
                    "Guidelines:\n"
                    "- Do NOT fabricate or guess content that might be in the documents\n"
                    "- Let the user know that no matching documents were found\n"
                    "- Suggest they rephrase their question or check which documents are uploaded\n"
                    "- You may still answer from general knowledge, but clearly state you are doing so"
                )
        except asyncio.CancelledError:
            pass  # RAG was cancelled
        except Exception as e:
            logger.warning(f"Pinecone search failed: {e}")
            # If the knowledge base is unavailable (e.g. embedding quota
            # exceeded), abort with a user-facing message instead of
            # silently returning an answer without sources.
            error_msg = (
                "The knowledge base is temporarily unavailable. "
                "Please try again later or contact "
                "openclimatecurriculum@gsb.columbia.edu for assistance."
            )
            async def _error_stream():
                yield f"data: {json.dumps({'type': 'error', 'error': error_msg, 'provider': effective_provider})}\n\n"
            return StreamingResponse(
                _error_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )

    # Inject conversation-scoped attachment context (never touches Pinecone)
    attachment_context = attachment_service.get_context_for_chat(
        discussion_id=request.discussion_id,
        attachment_ids=request.attachment_ids,
    )
    if attachment_context:
        if context:
            context = (
                attachment_context
                + "\n\n===\n\n"
                + context
            )
        else:
            context = attachment_context

    # Collect image attachments for vision API injection
    image_attachments = attachment_service.get_image_attachments_for_chat(
        discussion_id=request.discussion_id,
        attachment_ids=request.attachment_ids,
    )

    # Create streaming response
    async def generate():
        """Generate SSE events from provider stream."""
        full_response = []
        start_time = time.time()

        # Emit title update event first if title was updated
        if title_updated:
            title_data = {
                "type": "discussion_title",
                "discussion_id": request.discussion_id,
                "title": discussion.title
            }
            yield f"data: {json.dumps(title_data)}\n\n"

        # Emit sources event (if any)
        if sources:
            sources_data = {
                "type": "sources",
                "sources": [s.model_dump() for s in sources],
                "provider": effective_provider
            }
            yield f"data: {json.dumps(sources_data)}\n\n"

        # Emit intent event(s).
        # For continuation: emit the primary intent first, then the continuation
        # marker so the frontend can render both chips side by side.
        if intent_result.intent == "continuation" and primary_intent_key:
            primary_label = INTENT_LOOKUP.get(primary_intent_key, {}).get("label", primary_intent_key)
            yield f"data: {json.dumps({'type': 'intent', 'intent': primary_intent_key, 'label': primary_label})}\n\n"
            yield f"data: {json.dumps({'type': 'intent', 'intent': 'continuation', 'label': 'Continuing Response', 'is_continuation': True})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'intent', 'intent': intent_result.intent, 'label': intent_result.label})}\n\n"

        # Resolve effective token budget:
        # intent_result.max_tokens overrides the request default when the intent
        # requires long-form generation (e.g. builder needs 12000).
        # Invariant: intent override only raises the cap, never lowers it —
        # take the max so an explicit high request.max_tokens is always honoured.
        effective_max_tokens = max(
            request.max_tokens,
            intent_result.max_tokens or 0,
        )

        # DEV: force_truncate overrides the token budget to a tiny value so
        # truncation detection can be tested without needing a genuinely long response.
        if request.force_truncate and intent_result.intent != "continuation":
            effective_max_tokens = 150

        # Mutable dict populated by the provider with stop_reason after stream ends.
        stream_metadata: dict = {}

        # Wrap the provider stream to collect raw chunks before SSE serialization,
        # avoiding the cost of re-parsing our own JSON output.
        async def _collect_and_stream():
            async for chunk in provider.stream_completion(
                messages=context_messages,
                context=context,
                temperature=request.temperature,
                max_tokens=effective_max_tokens,
                intent_prompt=intent_result.prompt_suffix,
                research_prompt=research_config.prompt_enhancement,
                image_attachments=image_attachments or None,
                stream_metadata=stream_metadata,
            ):
                full_response.append(chunk)
                yield chunk

        async for sse_event in create_sse_response(
            _collect_and_stream(),
            provider=effective_provider,
            send_done=False,
        ):
            yield sse_event

        # Save assistant response to discussion after streaming completes
        response_time = int((time.time() - start_time) * 1000)
        full_response_text = "".join(full_response)
        # Clean up stray space-before-punctuation artifacts (Mistral citation omission pattern)
        full_response_text = re.sub(r' +([.!?])', r'\1', full_response_text)
        # Remove [AI] (pure general knowledge) immediately following a numeric [N] citation —
        # semantically contradictory. [N] means a source IS connected; [AI] means NO source.
        # Grounded citation wins. Does NOT touch [AI:N,M] (valid attributed inference).
        full_response_text = re.sub(r'(\[\d+(?:,\s*\d+)*\])\s*\[AI\]', r'\1', full_response_text)

        assistant_message = Message(
            id=str(uuid.uuid4()),
            content=full_response_text,
            role=MessageRole.ASSISTANT,
            provider=effective_provider,
            timestamp=datetime.utcnow(),
            response_time_ms=response_time,
            sources=sources if sources else None,
            # For continuation responses, persist the primary intent so future
            # continuations can chain correctly (not "continuation" of "continuation").
            intent=primary_intent_key if intent_result.intent == "continuation" and primary_intent_key else intent_result.intent,
            research_mode=request.research_mode.value,
        )

        # Generate suggested questions
        try:
            # Build conversation history for context
            conversation_history = [
                {"role": msg.role.value, "content": msg.content}
                for msg in context_messages
            ]

            # Generate questions using the provider
            suggested_questions = await provider.generate_suggested_questions(
                conversation_history=conversation_history,
                last_response=full_response_text,
                count=4
            )

            # Send suggested questions event if any generated
            if suggested_questions:
                yield format_sse_event(
                    "suggested_questions",
                    {"questions": suggested_questions}
                )

                # Store in message object
                assistant_message.suggested_questions = suggested_questions

        except Exception as e:
            logger.warning(f"Failed to generate suggested questions: {e}")
            # Don't fail the whole request if question generation fails

        # Determine if the response was truncated by the token limit
        truncated = stream_metadata.get('stop_reason') == 'max_tokens'

        # Send done event after suggested questions
        yield format_sse_event("done", {"provider": effective_provider, "truncated": truncated})

        # Persist truncation flag on the message so future sessions can detect it
        assistant_message.is_truncated = truncated

        disc_service.add_message(request.discussion_id, assistant_message)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/providers")
async def list_providers():
    """List available AI providers and their status."""
    settings = get_settings()

    providers = [
        {
            "name": "mistral",
            "display_name": "Mistral",
            "model": settings.mistral_model,
            "configured": bool(settings.mistral_api_key),
        },
        {
            "name": "claude",
            "display_name": "Claude",
            "model": settings.anthropic_model,
            "configured": bool(settings.anthropic_api_key),
        },
    ]

    return {"providers": providers}


@router.get("/research-modes")
async def list_research_modes():
    """List available research modes and their configurations."""
    return {
        "modes": get_all_research_modes(),
        "default": DEFAULT_RESEARCH_MODE.value
    }
