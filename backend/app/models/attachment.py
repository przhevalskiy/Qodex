from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class AttachmentChunk(BaseModel):
    """A text chunk from an attached file, stored in-memory (not in Pinecone)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    attachment_id: str
    content: str
    chunk_index: int
    content_type: str = "paragraph"  # heading, paragraph, list


class Attachment(BaseModel):
    """A file attached to a specific discussion for conversational context.

    Unlike Documents (which are indexed into Pinecone), Attachments are
    stored in-memory and used as contextual knowledge within a discussion.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    discussion_id: str
    filename: str
    file_content_type: str  # MIME type
    file_size: int = 0
    chunk_count: int = 0
    full_text: str = ""
    chunks: List[AttachmentChunk] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_image: bool = False
    image_data: Optional[str] = None  # base64-encoded bytes for image attachments

    class Config:
        from_attributes = True


class AttachmentSummary(BaseModel):
    """Lightweight attachment info returned in list responses (no full text/chunks)."""
    id: str
    discussion_id: str
    filename: str
    file_content_type: str
    file_size: int
    chunk_count: int
    created_at: datetime
    is_image: bool = False

    @classmethod
    def from_attachment(cls, attachment: Attachment) -> "AttachmentSummary":
        return cls(
            id=attachment.id,
            discussion_id=attachment.discussion_id,
            filename=attachment.filename,
            file_content_type=attachment.file_content_type,
            file_size=attachment.file_size,
            chunk_count=attachment.chunk_count,
            created_at=attachment.created_at,
            is_image=attachment.is_image,
        )
