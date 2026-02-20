from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import json
import asyncio

from app.models import Document
from app.services.document_service import get_document_service

router = APIRouter(prefix="/api/documents", tags=["documents"])

# In-memory cache: document_id → list of {id, content} formatted chunks
_format_cache: dict[str, list[dict]] = {}

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


@router.post("/upload", response_model=Document)
async def upload_document(file: UploadFile = File(...)):
    """
    Upload and process a document.

    The document will be chunked, embedded, and stored in Pinecone.
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


@router.post("/{document_id}/format-preview")
async def format_document_preview(document_id: str, request: FormatPreviewRequest):
    """Use AI to reconstruct chunk text into clean readable prose for document preview."""
    # Return cached result immediately if available
    if document_id in _format_cache:
        return {"formatted": _format_cache[document_id]}

    from openai import AsyncOpenAI
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.openai_api_key:
        # No key — return chunks as-is so the UI still works
        return {"formatted": [{"id": c.id, "content": c.content} for c in request.chunks]}

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    # Process all chunks in parallel (up to 20 at a time to avoid rate limits)
    sem = asyncio.Semaphore(20)

    async def bounded(chunk):
        async with sem:
            return await _format_one_chunk(client, chunk)

    results = await asyncio.gather(*[bounded(c) for c in request.chunks])

    # Cache result so subsequent opens of the same document are instant
    _format_cache[document_id] = results
    return {"formatted": results}


class DocumentChatRequest(BaseModel):
    """Request model for document-specific chat."""
    message: str
    provider: str
    temperature: float = 0.7
    max_tokens: int = 4096


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
        
        # Stream response
        async def generate_response():
            async for chunk in provider.stream_completion(
                messages=[user_message],
                context=context,
                temperature=request.temperature,
                max_tokens=request.max_tokens
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
