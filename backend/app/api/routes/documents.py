from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from typing import List, Optional, Union
from pydantic import BaseModel
from datetime import datetime
import json
import asyncio
import logging

from app.models import Document
from app.services.document_service import get_document_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

# L1: in-memory cache — fastest path, wiped on server restart
_format_cache: dict[str, list[dict]] = {}


# ── Supabase persistence helpers (L2 cache) ───────────────────────────────────

def _get_supabase_client():
    """Return an authenticated Supabase client, or None if not configured."""
    try:
        from app.core.config import get_settings
        from supabase import create_client
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_key:
            return None
        return create_client(settings.supabase_url, settings.supabase_key)
    except Exception:
        return None


async def _get_formatted_from_db(document_id: str) -> Optional[List[dict]]:
    """
    Fetch persisted formatted chunks from Supabase for a given document.
    Returns a list of {id, content} dicts ordered by chunk_id, or None if not found.
    """
    try:
        client = _get_supabase_client()
        if not client:
            return None
        response = client.table("document_formatted_chunks") \
            .select("chunk_id, formatted_content") \
            .eq("document_id", document_id) \
            .execute()
        rows = response.data
        if not rows:
            return None
        return [{"id": row["chunk_id"], "content": row["formatted_content"]} for row in rows]
    except Exception as e:
        logger.warning("Failed to read formatted chunks from Supabase: %s", e)
        return None


async def _save_formatted_to_db(document_id: str, results: list[dict]) -> None:
    """
    Upsert formatted chunks into Supabase.
    Safe to call multiple times — unique constraint on (document_id, chunk_id).
    """
    try:
        client = _get_supabase_client()
        if not client:
            return
        rows = [
            {
                "document_id": document_id,
                "chunk_id": r["id"],
                "formatted_content": r["content"],
            }
            for r in results
        ]
        client.table("document_formatted_chunks") \
            .upsert(rows, on_conflict="document_id,chunk_id") \
            .execute()
    except Exception as e:
        logger.warning("Failed to save formatted chunks to Supabase: %s", e)

# Allowed file types
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx"}


class SearchRequest(BaseModel):
    """Request model for document search."""
    query: str
    top_k: int = 5
    document_ids: List[str] = None


class SearchResult(BaseModel):
    """Search result model."""
    id: str
    document_id: Optional[str] = None
    score: float
    content: str
    filename: str


async def _background_format_document(document_id: str) -> None:
    """
    Background task: fetch chunks from Pinecone and run format+persist pipeline.
    Fires after upload completes so the first document open is always instant.
    """
    try:
        doc_service = get_document_service()
        content = await doc_service.get_document_content(document_id)
        chunks_raw = content.get("chunks", [])
        if not chunks_raw:
            return
        chunks = [FormatChunk(id=c["id"], content=c["content"]) for c in chunks_raw]
        await _run_format_and_persist(document_id, chunks)
        logger.info("Background formatting complete for document %s (%d chunks)", document_id, len(chunks))
    except Exception as e:
        logger.warning("Background formatting failed for document %s: %s", document_id, e)


@router.post("/upload", response_model=Document)
async def upload_document(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    """
    Upload and process a document.

    The document will be chunked, embedded, and stored in Pinecone.
    After a successful upload, chunk formatting is queued as a background task
    so the first document preview open is always instant.
    """
    # Validate file type
    filename = file.filename or "unknown"
    extension = "." + filename.split(".")[-1].lower() if "." in filename else ""

    if file.content_type not in ALLOWED_CONTENT_TYPES and extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed types: {ALLOWED_EXTENSIONS}"
        )

    # Read file content
    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB")

    # Process document
    doc_service = get_document_service()

    try:
        document = await doc_service.process_document(
            filename=filename,
            content=content,
            content_type=file.content_type or "application/octet-stream"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process document: {str(e)}")

    # Queue background formatting so first open is instant
    if background_tasks is not None:
        background_tasks.add_task(_background_format_document, document.id)

    return document


@router.get("", response_model=List[Document])
async def list_documents():
    """List all uploaded documents."""
    doc_service = get_document_service()
    return doc_service.list_documents()


@router.get("/{document_id}", response_model=Document)
async def get_document(document_id: str):
    """Get document metadata."""
    doc_service = get_document_service()
    document = await doc_service.get_document(document_id)
    
    if not document:
        raise HTTPException(status_code=404, detail=f"Document not found: {document_id}")
    
    return document


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and its vectors."""
    doc_service = get_document_service()
    deleted = await doc_service.delete_document(document_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")

    return {"status": "deleted", "id": document_id}


@router.post("/search", response_model=List[SearchResult])
async def search_documents(request: SearchRequest):
    """Search documents by semantic similarity."""
    doc_service = get_document_service()

    results = await doc_service.pinecone.search_documents(
        query=request.query,
        top_k=request.top_k,
        document_ids=request.document_ids
    )

    return [
        SearchResult(
            id=r["id"],
            document_id=r["metadata"].get("document_id") if r.get("metadata") else None,
            score=r["score"],
            content=r["metadata"].get("content", "") if r.get("metadata") else "",
            filename=r["metadata"].get("filename", "") if r.get("metadata") else ""
        )
        for r in results
    ]


@router.get("/{document_id}/content")
async def get_document_content(document_id: str):
    """Get full document content with chunks for preview."""
    doc_service = get_document_service()
    
    try:
        content = await doc_service.get_document_content(document_id)
        return content
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get document content: {str(e)}")


@router.get("/{document_id}/chunks")
async def get_document_chunks(document_id: str):
    """Get document chunks for preview."""
    doc_service = get_document_service()
    
    try:
        chunks = await doc_service.get_document_chunks(document_id)
        return {"chunks": chunks}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get document chunks: {str(e)}")


@router.post("/bootstrap")
async def bootstrap_registry():
    """Rebuild the document registry from Pinecone.

    Discovers all documents stored in the vector DB and populates the local
    registry cache. Useful after server restarts when the registry file is
    missing or when documents were uploaded before persistence was added.
    """
    doc_service = get_document_service()
    try:
        count = await doc_service.bootstrap_registry()
        return {
            "status": "ok",
            "documents_discovered": count,
            "total_documents": len(doc_service.list_documents()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bootstrap failed: {str(e)}")


class FormatChunk(BaseModel):
    id: str
    content: str


class FormatPreviewRequest(BaseModel):
    chunks: List[FormatChunk]


FORMAT_SYSTEM_PROMPT = (
    "You are a document text reconstructor. The text below is a chunk extracted from a PDF "
    "or document file. PDF extraction often produces fragmented words, broken sentences, "
    "missing spaces, and garbled formatting.\n\n"
    "Your job: rewrite this chunk as clean, structured markdown. Rules:\n"
    "- Preserve ALL original information — do not add, summarize, or omit anything\n"
    "- Fix broken words, run-together sentences, and spacing issues\n"
    "- Identify section titles (e.g. 'COURSE DESCRIPTION', 'GRADING', 'SCHEDULE') and render them as ## headings\n"
    "- Identify subsection titles and render them as ### headings\n"
    "- If a heading is written in ALL CAPS, convert it to Title Case (e.g. 'PROFESSOR NAMES' → 'Professor Names')\n"
    "- Never output headings in ALL CAPS — always use standard Title Case\n"
    "- Render lists (dates, items, bullet points) as proper markdown `- item` lists\n"
    "- Use paragraph breaks where logical section shifts occur\n"
    "- Return only the reconstructed markdown — no commentary, no labels, no code fences"
)


async def _format_one_chunk(client, chunk: FormatChunk) -> dict:
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": FORMAT_SYSTEM_PROMPT},
                {"role": "user", "content": chunk.content},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        return {"id": chunk.id, "content": response.choices[0].message.content.strip()}
    except Exception:
        # On failure return original content unchanged
        return {"id": chunk.id, "content": chunk.content}


async def _run_format_and_persist(document_id: str, chunks: List[FormatChunk]) -> List[dict]:
    """
    Core formatting logic: call GPT-4o-mini on all chunks in parallel,
    persist results to Supabase (L2), and populate in-memory cache (L1).
    Called both from the endpoint (inline) and as a background task at upload time.
    """
    from openai import AsyncOpenAI
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.openai_api_key:
        results = [{"id": c.id, "content": c.content} for c in chunks]
        _format_cache[document_id] = results
        return results

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    sem = asyncio.Semaphore(20)

    async def bounded(chunk):
        async with sem:
            return await _format_one_chunk(client, chunk)

    results = await asyncio.gather(*[bounded(c) for c in chunks])

    # Persist to L2 (Supabase) then warm L1
    await _save_formatted_to_db(document_id, list(results))
    _format_cache[document_id] = list(results)
    return list(results)


@router.post("/{document_id}/format-preview")
async def format_document_preview(document_id: str, request: FormatPreviewRequest):
    """
    Return AI-formatted chunk content for document preview.

    Cache hierarchy:
      L1 — in-memory dict (fastest, reset on restart)
      L2 — Supabase document_formatted_chunks table (persistent across restarts)
      L3 — GPT-4o-mini live generation (fallback, result is persisted to L1+L2)
    """
    # L1: in-memory
    if document_id in _format_cache:
        return {"formatted": _format_cache[document_id]}

    # L2: Supabase persistent cache
    db_results = await _get_formatted_from_db(document_id)
    if db_results and len(db_results) == len(request.chunks):
        _format_cache[document_id] = db_results  # warm L1
        return {"formatted": db_results}

    # L3: live GPT-4o-mini generation → persists to L1 + L2
    results = await _run_format_and_persist(document_id, request.chunks)
    return {"formatted": results}


class DocumentChatRequest(BaseModel):
    """Request model for document-specific chat."""
    message: str
    provider: str
    temperature: float = 0.7
    max_tokens: int = 512


@router.post("/{document_id}/chat")
async def chat_with_document(document_id: str, request: DocumentChatRequest):
    """Chat specifically with this document context."""
    doc_service = get_document_service()
    
    try:
        # Get document content for context
        document_content = await doc_service.get_document_content(document_id)
        
        # Create a temporary discussion ID for document chat
        import uuid
        temp_discussion_id = str(uuid.uuid4())
        
        # Import chat functionality
        from app.api.routes.chat import ChatRequest
        from app.providers import ProviderRegistry
        from app.core.config import get_settings
        from app.models import Message, MessageRole
        
        # Get provider configuration
        settings = get_settings()
        provider_configs = {
            "openai": (settings.openai_api_key, settings.openai_model),
            "mistral": (settings.mistral_api_key, settings.mistral_model),
            "claude": (settings.anthropic_api_key, settings.anthropic_model),
            "cohere": (settings.cohere_api_key, settings.cohere_model),
        }
        
        if request.provider not in provider_configs:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid provider: {request.provider}"
            )
        
        api_key, model = provider_configs[request.provider]
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail=f"API key not configured for provider: {request.provider}"
            )
        
        # Get provider and stream response
        provider = ProviderRegistry.get_provider(request.provider, api_key, model)
        
        # Create user message
        user_message = Message(
            id=str(uuid.uuid4()),
            content=request.message,
            role=MessageRole.USER,
            timestamp=datetime.utcnow().isoformat()
        )
        
        # Format context with document content
        context = f"Document: {document_content['filename']}\n\n{document_content['full_content']}"
        
        brevity_prompt = (
            "\n\nIMPORTANT: Give a concise, direct answer in 2-4 sentences maximum. "
            "No lengthy explanations or excessive detail — just answer the question clearly and stop."
        )

        # Stream response
        async def generate_response():
            async for chunk in provider.stream_completion(
                messages=[user_message],
                context=context,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                intent_prompt=brevity_prompt
            ):
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
            
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            generate_response(),
            media_type="text/plain",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
        )
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to chat with document: {str(e)}")
