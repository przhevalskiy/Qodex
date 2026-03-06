from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List

from app.models.attachment import Attachment, AttachmentSummary
from app.services.attachment_service import get_attachment_service
from app.auth import get_current_user_id

router = APIRouter(
    prefix="/api/discussions/{discussion_id}/attachments",
    tags=["attachments"],
)

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".jpg", ".jpeg", ".png", ".webp"}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("", response_model=AttachmentSummary)
async def upload_attachment(discussion_id: str, file: UploadFile = File(...), _user_id: str = Depends(get_current_user_id)):
    """Upload a file as a conversation attachment (not indexed into Pinecone)."""
    filename = file.filename or "unknown"
    extension = "." + filename.split(".")[-1].lower() if "." in filename else ""

    if file.content_type not in ALLOWED_CONTENT_TYPES and extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {ALLOWED_EXTENSIONS}",
        )

    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB")

    svc = get_attachment_service()

    try:
        attachment = await svc.add_attachment(
            discussion_id=discussion_id,
            filename=filename,
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process attachment: {e}")

    return AttachmentSummary.from_attachment(attachment)


@router.get("", response_model=List[AttachmentSummary])
async def list_attachments(discussion_id: str, _user_id: str = Depends(get_current_user_id)):
    """List all attachments for a discussion."""
    svc = get_attachment_service()
    return svc.list_attachments(discussion_id)


@router.get("/{attachment_id}")
async def get_attachment(discussion_id: str, attachment_id: str, _user_id: str = Depends(get_current_user_id)):
    """Get attachment metadata and full text content for preview."""
    svc = get_attachment_service()
    attachment = svc.get_attachment(discussion_id, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    return {
        "id": attachment.id,
        "discussion_id": attachment.discussion_id,
        "filename": attachment.filename,
        "file_content_type": attachment.file_content_type,
        "file_size": attachment.file_size,
        "chunk_count": attachment.chunk_count,
        "created_at": attachment.created_at.isoformat(),
        "is_image": attachment.is_image,
        "image_data": attachment.image_data,
        "full_text": attachment.full_text,
        "chunks": [
            {
                "id": c.id,
                "content": c.content,
                "chunk_index": c.chunk_index,
                "content_type": c.content_type,
            }
            for c in attachment.chunks
        ],
    }


@router.delete("/{attachment_id}")
async def delete_attachment(discussion_id: str, attachment_id: str, _user_id: str = Depends(get_current_user_id)):
    """Remove an attachment from a discussion."""
    svc = get_attachment_service()
    deleted = svc.delete_attachment(discussion_id, attachment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return {"status": "deleted", "id": attachment_id}
